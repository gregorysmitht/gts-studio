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
                    // The edit pencil's gate: subscribed/holiday calendars
                    // read fine but refuse writes.
                    "editable": cal?.allowsContentModifications ?? false,
                ]
            }
    }

    /// The wall can put things on the family calendar too.
    func add(title: String, start: Date, end: Date, allDay: Bool,
             calendarId: String?, location: String?, notes: String?) throws -> [String: Any] {
        try requireAccess()
        let event = EKEvent(eventStore: store)
        event.calendar = calendar(withId: calendarId) ?? store.defaultCalendarForNewEvents
        guard let cal = event.calendar, cal.allowsContentModifications else {
            throw BridgeError.upstream("That calendar cannot be written to")
        }
        event.title = title
        event.startDate = start
        event.endDate = max(start, end)
        event.isAllDay = allDay
        if let location, !location.isEmpty { event.location = location }
        if let notes, !notes.isEmpty { event.notes = notes }
        try store.save(event, span: .thisEvent, commit: true)
        return ["ok": true, "uid": event.eventIdentifier ?? ""]
    }

    func update(uid: String, occurrenceStart: Date, span: EKSpan,
                changes: [String: Any]) throws -> [String: Any] {
        try requireAccess()
        guard let event = locate(uid: uid, occurrenceStart: occurrenceStart) else {
            throw BridgeError.upstream("That event no longer exists")
        }
        guard event.calendar?.allowsContentModifications == true else {
            throw BridgeError.upstream("That calendar cannot be written to")
        }
        if let title = changes["title"] as? String, !title.isEmpty { event.title = title }
        if let ms = changes["start"] as? Double {
            event.startDate = Date(timeIntervalSince1970: ms / 1000)
        }
        if let ms = changes["end"] as? Double {
            event.endDate = Date(timeIntervalSince1970: ms / 1000)
        }
        if let allDay = changes["allDay"] as? Bool { event.isAllDay = allDay }
        if let location = changes["location"] as? String {
            event.location = location.isEmpty ? nil : location
        }
        if let notes = changes["notes"] as? String {
            event.notes = notes.isEmpty ? nil : notes
        }
        if let calId = changes["calendarId"] as? String, let cal = calendar(withId: calId) {
            guard cal.allowsContentModifications else {
                throw BridgeError.upstream("That calendar cannot be written to")
            }
            event.calendar = cal
        }
        try store.save(event, span: span, commit: true)
        return ["ok": true]
    }

    func remove(uid: String, occurrenceStart: Date, span: EKSpan) throws -> [String: Any] {
        try requireAccess()
        guard let event = locate(uid: uid, occurrenceStart: occurrenceStart) else {
            throw BridgeError.upstream("That event no longer exists")
        }
        try store.remove(event, span: span, commit: true)
        return ["ok": true]
    }

    /// A repeating event's identifier names the whole series, so the
    /// occurrence is picked out by its start time; single events resolve
    /// directly by identifier.
    private func locate(uid: String, occurrenceStart: Date) -> EKEvent? {
        if let event = store.event(withIdentifier: uid), !event.hasRecurrenceRules {
            return event
        }
        let window = store.predicateForEvents(
            withStart: occurrenceStart.addingTimeInterval(-36 * 3600),
            end: occurrenceStart.addingTimeInterval(36 * 3600),
            calendars: nil
        )
        return store.events(matching: window).first {
            $0.eventIdentifier == uid
                && abs(($0.startDate ?? .distantPast).timeIntervalSince(occurrenceStart)) < 1
        } ?? store.event(withIdentifier: uid)
    }

    private func calendar(withId id: String?) -> EKCalendar? {
        guard let id else { return nil }
        return store.calendars(for: .event).first { $0.calendarIdentifier == id }
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
