import SwiftUI

@main
struct HomeHubApp: App {
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            HubWebView()
                // The hub paints its own sky edge to edge; the status bar
                // and home indicator would only interrupt it.
                .ignoresSafeArea()
                .statusBarHidden()
                .persistentSystemOverlays(.hidden)
                .preferredColorScheme(.dark)
        }
        .onChange(of: scenePhase) { phase in
            // Leaving the iPad on a brightness the hub chose for 2am would
            // be a rude thing to do to whoever picks it up next.
            if phase == .background {
                Task { @MainActor in DisplayBridge.shared.restoreBrightness() }
            }
        }
    }
}
