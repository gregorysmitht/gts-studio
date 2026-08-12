import Foundation
import EventKit

/// The iPad's own Calendar app, via EventKit.
///
/// This is the reason the native shell exists. EventKit expands
/// recurrence itself, so the RRULE engine in js/data/ics.js is unused on
/// this path — `events(matching:)` already returns one entry per
/// occurrence, with per-instance edits and cancellations applied.
///
/// Everything returned here matches the shape js/data/ics.js produces,
/// so the calendar views never learn which source they're looking at.
final class CalendarBridge {

    private let store = EKEventStore()

    /// Mirrors the strings js/core/native.js expects.
    static func authorizationStatus() -> String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .notDetermined:
            return "notDetermined"
        case .restricted, .denied:
            return "denied"
        case .authorized:
            return "granted"
        case .fullAccess:
            return "granted"
        case .writeOnly:
            // Write-only can create events but cannot read them, which is
            // useless to a display. Treat it as not usable.
            return "denied"
        @unknown default:
            return "denied"
        }
    }

    func requestAccess() async throws -> String {
        if #available(iOS 17.0, *) {
            _ = try await store.requestFullAccessToEvents()
        } else {
            _ = try await store.requestAccess(to: .event)
        }
        return Self.authorizationStatus()
    }

    func calendars() throws -> [[String: Any]] {
        try requireAccess()
        return store.calendars(for: .event).map { cal in
            [
                "id": cal.calendarIdentifier,
                "name": cal.title,
                "color": Self.hex(from: cal.cgColor),
                "source": cal.source?.title ?? "",
                "editable": cal.allowsContentModifications,
            ]
        }
    }

    func events(from: Date, to: Date, calendarIds: [String]?) throws -> [[String: Any]] {
        try requireAccess()

        let all = store.calendars(for: .event)
        let selected: [EKCalendar]? = {
            guard let ids = calendarIds, !ids.isEmpty else { return nil }   // nil means all
            return all.filter { ids.contains($0.calendarIdentifier) }
        }()

        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: selected)

        return store.events(matching: predicate)
            .filter { $0.status != .canceled }
            .sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
            .map { event in
                let cal = event.calendar
                // An occurrence of a repeating event shares its UID with
                // every sibling, so the start time makes the id unique —
                // the same scheme the ICS parser uses.
                let uid = event.eventIdentifier ?? UUID().uuidString
                let start = event.startDate ?? Date()
                return [
                    "id": "\(uid)-\(Int(start.timeIntervalSince1970))",
                    "uid": uid,
                    "title": event.title ?? "(No title)",
                    "start": start.timeIntervalSince1970 * 1000,
                    "end": (event.endDate ?? start).timeIntervalSince1970 * 1000,
                    "allDay": event.isAllDay,
                    "location": event.location ?? "",
                    "description": event.notes ?? "",
                    "url": event.url?.absoluteString ?? "",
                    "organizer": event.organizer?.name ?? "",
                    "attendees": (event.attendees ?? []).compactMap { $0.name },
                    "calendarId": cal?.calendarIdentifier ?? "",
                    "calendarName": cal?.title ?? "",
                    "color": Self.hex(from: cal?.cgColor),
                    "recurring": event.hasRecurrenceRules,
                ]
            }
    }

    private func requireAccess() throws {
        guard Self.authorizationStatus() == "granted" else {
            throw BridgeError.notAuthorized("HomeHub does not have calendar access yet")
        }
    }

    /// EKCalendar colours arrive as CGColor in whatever space the source
    /// used; convert through sRGB so the hex matches what Calendar shows.
    static func hex(from color: CGColor?) -> String {
        guard
            let color,
            let srgb = CGColorSpace(name: CGColorSpace.sRGB),
            let converted = color.converted(to: srgb, intent: .defaultIntent, options: nil),
            let parts = converted.components, parts.count >= 3
        else { return "#8FB0C4" }

        let channel = { (v: CGFloat) in Int(max(0, min(1, v)) * 255 + 0.5) }
        return String(format: "#%02X%02X%02X", channel(parts[0]), channel(parts[1]), channel(parts[2]))
    }
}
