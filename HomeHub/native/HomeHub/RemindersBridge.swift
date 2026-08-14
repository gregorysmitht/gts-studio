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
                    "recurring": reminder.hasRecurrenceRules,
                    "repeatText": Self.repeatLabel(reminder.recurrenceRules?.first),
                ]
            }
    }

    /// "Daily", "Weekdays", "Every Tue" — the short phrase a chore row can
    /// wear. EventKit rules can be arbitrarily baroque; anything past the
    /// household vocabulary just says "Repeats".
    static func repeatLabel(_ rule: EKRecurrenceRule?) -> String {
        guard let rule else { return "" }
        let days = rule.daysOfTheWeek ?? []
        switch (rule.frequency, rule.interval) {
        case (.daily, 1):
            return "Daily"
        case (.weekly, 1) where days.count == 5
            && !days.contains(where: { $0.dayOfTheWeek == .saturday || $0.dayOfTheWeek == .sunday }):
            return "Weekdays"
        case (.weekly, 1) where days.count <= 1:
            if let day = days.first {
                let names: [EKWeekday: String] = [
                    .sunday: "Sun", .monday: "Mon", .tuesday: "Tue", .wednesday: "Wed",
                    .thursday: "Thu", .friday: "Fri", .saturday: "Sat",
                ]
                return "Every \(names[day.dayOfTheWeek] ?? "week")"
            }
            return "Weekly"
        case (.weekly, 2):
            return "Every 2 weeks"
        case (.monthly, 1):
            return "Monthly"
        case (.yearly, 1):
            return "Yearly"
        default:
            return "Repeats"
        }
    }

    /// A grocery typed on the wall should land on every phone.
    ///
    /// No due date on purpose: things added from the hub's list keyboard
    /// are "get this sometime soon" items, and an artificial date would
    /// drag them into the agenda views.
    func add(listId: String, title: String) throws -> [String: Any] {
        try requireAccess()
        guard let list = store.calendars(for: .reminder)
            .first(where: { $0.calendarIdentifier == listId }) else {
            throw BridgeError.upstream("That Reminders list no longer exists")
        }
        let reminder = EKReminder(eventStore: store)
        reminder.calendar = list
        reminder.title = title
        try store.save(reminder, commit: true)
        return ["ok": true, "id": reminder.calendarItemIdentifier]
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

    /// Editing from the wall: rename, reschedule, change the repeat.
    /// The repeat vocabulary is the hub's six choices, not full RRULE —
    /// anything fancier is set in the Reminders app and left alone.
    func update(id: String, changes: [String: Any]) throws -> [String: Any] {
        try requireAccess()
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
            throw BridgeError.upstream("That reminder no longer exists")
        }
        if let title = changes["title"] as? String, !title.isEmpty { reminder.title = title }
        if changes.keys.contains("due") {
            if let ms = changes["due"] as? Double {
                let dueDate = Date(timeIntervalSince1970: ms / 1000)
                let hasTime = changes["hasTime"] as? Bool ?? true
                var parts: Set<Calendar.Component> = [.year, .month, .day]
                if hasTime { parts.formUnion([.hour, .minute]) }
                reminder.dueDateComponents = Calendar.current.dateComponents(parts, from: dueDate)
            } else {
                reminder.dueDateComponents = nil
            }
        }
        if let notes = changes["notes"] as? String {
            reminder.notes = notes.isEmpty ? nil : notes
        }
        if let repeatId = changes["repeat"] as? String {
            reminder.recurrenceRules = Self.rule(for: repeatId).map { [$0] }
        }
        try store.save(reminder, commit: true)
        return ["ok": true]
    }

    /// Deleting is offered from the edit sheet only — a deliberate step
    /// past completing, never a stray tap on a row.
    func remove(id: String) throws -> [String: Any] {
        try requireAccess()
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
            throw BridgeError.upstream("That reminder no longer exists")
        }
        try store.remove(reminder, commit: true)
        return ["ok": true]
    }

    static func rule(for id: String) -> EKRecurrenceRule? {
        let weekdays: [EKRecurrenceDayOfWeek] = [
            EKRecurrenceDayOfWeek(.monday), EKRecurrenceDayOfWeek(.tuesday),
            EKRecurrenceDayOfWeek(.wednesday), EKRecurrenceDayOfWeek(.thursday),
            EKRecurrenceDayOfWeek(.friday),
        ]
        switch id {
        case "daily":
            return EKRecurrenceRule(recurrenceWith: .daily, interval: 1, end: nil)
        case "weekdays":
            return EKRecurrenceRule(
                recurrenceWith: .weekly, interval: 1,
                daysOfTheWeek: weekdays, daysOfTheMonth: nil, monthsOfTheYear: nil,
                weeksOfTheYear: nil, daysOfTheYear: nil, setPositions: nil, end: nil)
        case "weekly":
            return EKRecurrenceRule(recurrenceWith: .weekly, interval: 1, end: nil)
        case "biweekly":
            return EKRecurrenceRule(recurrenceWith: .weekly, interval: 2, end: nil)
        case "monthly":
            return EKRecurrenceRule(recurrenceWith: .monthly, interval: 1, end: nil)
        default:
            return nil   // "none"
        }
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
