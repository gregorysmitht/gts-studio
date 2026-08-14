import AppIntents

/// Siri and Shortcuts, pointed at the wall.
///
/// The reminders and calendar side of Siri needs none of this — those
/// land in the shared EventKit stores and the change-push repaints the
/// hub. This file covers the other half: asking the hub itself to show
/// something. "Show the radar on Home Hub", "Start the Home Hub
/// screensaver" — one intent, one enum of destinations, relayed into
/// the web app over the existing push channel.

enum HubDestination: String, AppEnum {
    case radar, weather, calendar, chores, lists, music, screensaver, home

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Hub Screen")
    static let caseDisplayRepresentations: [HubDestination: DisplayRepresentation] = [
        .radar: "Radar",
        .weather: "Weather",
        .calendar: "Calendar",
        .chores: "Chores",
        .lists: "Lists",
        .music: "Music",
        .screensaver: "Screensaver",
        .home: "Home",
    ]
}

/// Siri can fire before the web view exists (cold launch), so the relay
/// holds the last ask until the bridge registers its handler.
@MainActor
final class IntentRelay {
    static let shared = IntentRelay()

    var handler: ((String) -> Void)? {
        didSet {
            if let pending, let handler {
                handler(pending)
                self.pending = nil
            }
        }
    }
    private var pending: String?

    func send(_ action: String) {
        if let handler {
            handler(action)
        } else {
            pending = action
        }
    }
}

struct OpenHubIntent: AppIntent {
    static let title: LocalizedStringResource = "Show a Home Hub screen"
    static let description = IntentDescription("Opens the wall display on a chosen screen.")
    static let openAppWhenRun = true

    @Parameter(title: "Screen")
    var destination: HubDestination

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentRelay.shared.send(destination.rawValue)
        return .result()
    }
}

/// Playback, spoken. The intent rides the same relay: the page's router
/// resumes the system player, or reaches for the family's first
/// playlist when nothing is queued anywhere — the catalog logic lives
/// in JS, so the intent stays a one-liner.
struct PlayHubMusicIntent: AppIntent {
    static let title: LocalizedStringResource = "Play music on Home Hub"
    static let description = IntentDescription(
        "Resumes the music, or starts a playlist when nothing is queued.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentRelay.shared.send("music-play")
        return .result()
    }
}

struct PauseHubMusicIntent: AppIntent {
    static let title: LocalizedStringResource = "Pause music on Home Hub"
    static let description = IntentDescription("Pauses whatever is playing.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentRelay.shared.send("music-pause")
        return .result()
    }
}

/// Registered phrases work with zero setup — but every one must carry
/// the app's name, per Apple. The destination slot makes each screen
/// speakable: "Show chores on Home Hub."
struct HubShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenHubIntent(),
            phrases: [
                "Show \(\.$destination) on \(.applicationName)",
                "Show the \(\.$destination) on \(.applicationName)",
                "Open \(\.$destination) on \(.applicationName)",
                "Start the \(\.$destination) on \(.applicationName)",
            ]
        )
        AppShortcut(
            intent: PlayHubMusicIntent(),
            phrases: [
                "Play music on \(.applicationName)",
                "Play some music on \(.applicationName)",
                "Resume music on \(.applicationName)",
                "Put some music on \(.applicationName)",
            ]
        )
        AppShortcut(
            intent: PauseHubMusicIntent(),
            phrases: [
                "Pause the music on \(.applicationName)",
                "Pause music on \(.applicationName)",
                "Stop the music on \(.applicationName)",
            ]
        )
    }
}
