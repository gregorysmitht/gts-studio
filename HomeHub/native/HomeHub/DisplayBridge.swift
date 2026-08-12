import UIKit

/// Screen control — the small stuff that separates an appliance from a
/// browser tab left open.
///
/// `UIScreen.brightness` is the one that matters. A web page can only
/// lay a black overlay over itself at night, which leaves the backlight
/// running and reads as a grey rectangle in a dark hallway. This dims
/// the panel for real.
@MainActor
final class DisplayBridge {

    /// Shared, because the saved brightness has to survive between the
    /// bridge that sets it and the scene-phase handler that restores it.
    static let shared = DisplayBridge()

    /// Brightness before the hub first touched it, restored on the way out.
    private var original: CGFloat?

    var brightness: Double {
        Double(UIScreen.main.brightness)
    }

    func setBrightness(_ level: Double) {
        if original == nil { original = UIScreen.main.brightness }
        UIScreen.main.brightness = CGFloat(max(0.01, min(1, level)))
    }

    func restoreBrightness() {
        if let original { UIScreen.main.brightness = original }
        original = nil
    }

    /// More dependable than the Wake Lock API, which Safari may revoke.
    func setKeepAwake(_ on: Bool) {
        UIApplication.shared.isIdleTimerDisabled = on
    }
}
