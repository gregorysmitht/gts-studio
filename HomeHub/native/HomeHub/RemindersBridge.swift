import Foundation
import EventKit

/// Apple Reminders, via EventKit.
///
/// Same framework as the calendar and a separate permission — iPadOS
/// treats events and reminders as different grants, so a family can hand
/// over one without the other. That is why this is its own bridge with
/// its own status rather than a flag on CalendarBridge.
///
/// The shapes here deliberately echo CalendarBridge's: a list looks like
/// a calendar, a reminder looks enough like an event that the same rows
/// and the same colour dots render both.
final class RemindersBridge {

    private let store = EKEventStore()

    /// Mirrors the strings js/core/native.js expects.
    static func authorizationStatus() -> String {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .notDetermined:
            return "notDetermined"
        case .restricted, .denied:
            return "denied"
        case .authorized, .fullAccess:
            return "granted"
        case .writeOnly:
            // Write-only cannot read anything back, which is useless to a
            // display. Same call CalendarBridge makes.
            return "denied"
        @unknown default:
            return "denied"
        }
    }

    func requestAccess() async throws -> String {
        if #available(iOS 17.0, *) {
            _ = try await store.requestFullAccessToReminders()
        } else {
            _ = try await store.requestAccess(to: .reminder)
        }
        return Self.authorizationStatus()
    }

    /// The lists themselves, so Settings can offer one switch each.
    func lists() throws -> [[String: Any]] {
        try requireAccess()
        return store.calendars(for: .reminder).map { list in
            [
                "id": list.calendarIdentifier,
                "name": list.title,
                "color": CalendarBridge.hex(from: list.cgColor),
                "source": list.source?.title ?? "",
            ]
        }
    }

    /// Incomplete reminders, oldest due first, undated ones last.
    ///
    /// `to` bounds the *due* date, not the creation date: the hub only
    /// shows what is coming up. Reminders with no due date are included
    /// once, at the end, because "buy a new hose" still belongs on the
    /// board even though it is not due on any particular Tuesday.
    func reminders(to: Date, listIds: [String]?) async throws -> [[String: Any]] {
        try requireAccess()

        let all = store.calendars(for: .reminder)
        let selected: [EKCalendar]? = {
            guard let ids = listIds, !ids.isEmpty else { return nil }   // nil means all
            return all.filter { ids.contains($0.calendarIdentifier) }
        }()

        let predicate = store.predicateForIncompleteReminders(
            withDueDateStarting: nil, ending: to, calendars: selected
        )

        // EventKit's reminder fetch is callback-based even on iOS 17.
        let items: [EKReminder] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { found in
                continuation.resume(returning: found ?? [])
            }
        }

        return items
            .filter { !$0.isCompleted }
            .sorted { due($0) ?? .distantFuture < due($1) ?? .distantFuture }
            .map { reminder in
                let list = reminder.calendar
                let dueDate = due(reminder)
                return [
                    "id": reminder.calendarItemIdentifier,
                    "title": reminder.title ?? "(No title)",
                    // Milliseconds, like every other date crossing the bridge.
                    "due": dueDate.map { $0.timeIntervalSince1970 * 1000 } ?? NSNull(),
                    // A reminder due "today" with no time is an all-day thing.
                    "hasTime": (reminder.dueDateComponents?.hour != nil),
                    "notes": reminder.notes ?? "",
                    "priority": reminder.priority,
                    "flagged": reminder.priority > 0 && reminder.priority <= 4,
                    "listId": list?.calendarIdentifier ?? "",
                    "listName": list?.title ?? "",
                    "color": CalendarBridge.hex(from: list?.cgColor),
                    "completed": reminder.isCompleted,
                ]
            }
    }

    /// Ticking one off the wall should tick it off everywhere.
    func complete(id: String, done: Bool) throws -> [String: Any] {
        try requireAccess()
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
            throw BridgeError.upstream("That reminder no longer exists")
        }
        reminder.isCompleted = done
        try store.save(reminder, commit: true)
        return ["ok": true, "completed": reminder.isCompleted]
    }

    private func due(_ reminder: EKReminder) -> Date? {
        reminder.dueDateComponents?.date
    }

    private func requireAccess() throws {
        guard Self.authorizationStatus() == "granted" else {
            throw BridgeError.notAuthorized("HomeHub does not have Reminders access yet")
        }
    }
}
