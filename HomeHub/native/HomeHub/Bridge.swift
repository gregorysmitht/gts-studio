import Foundation
import WebKit

/// Routes `window.HomeHubNative.call(method, params)` to native code.
///
/// Uses `WKScriptMessageHandlerWithReply`, so a JS call is a plain
/// `await` on both sides — no callback ids, no correlation table. Every
/// method resolves to a JSON-compatible dictionary; thrown errors come
/// back as a rejected promise carrying the message.
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {

    static let name = "hub"

    /// Advertised to the web app, which uses it to decide what to enable.
    /// Keep in sync with `nativeHas()` in js/core/native.js.
    static let capabilities = ["calendar", "reminders", "weather", "display", "fetch", "music"]
    static let version = 1

    private let calendar = CalendarBridge()
    private let reminders = RemindersBridge()
    private let weather = WeatherBridge()
    private let display = DisplayBridge.shared
    private let net = NetBridge()
    private let music = MusicBridge()

    /// Set by HubWebView once the view exists, so events can be pushed the
    /// other way. Weak: the bridge outlives nothing, but the web view owns
    /// the configuration that owns this handler.
    weak var webView: WKWebView? {
        didSet { installPush() }
    }

    /// Injected before any page script runs, so `main.js` can branch on
    /// the bridge's presence during its very first render.
    static var installScript: WKUserScript {
        let caps = (try? JSONSerialization.data(withJSONObject: capabilities))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        let source = """
        window.HomeHubNative = {
          version: \(version),
          capabilities: \(caps),
          call(method, params) {
            return window.webkit.messageHandlers.\(name).postMessage({
              method: method, params: params || {}
            });
          }
        };
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard
            let body = message.body as? [String: Any],
            let method = body["method"] as? String
        else {
            replyHandler(nil, "Malformed bridge message")
            return
        }
        let params = body["params"] as? [String: Any] ?? [:]

        Task {
            do {
                let result = try await dispatch(method, params)
                replyHandler(result, nil)
            } catch {
                replyHandler(nil, Self.describe(error, method: method))
            }
        }
    }

    /// Frameworks routinely throw NSErrors whose localizedDescription is
    /// the useless "The operation couldn't be completed." The domain and
    /// code are the part that identifies the actual problem, and this is
    /// the only place they can be captured — everything downstream is
    /// JavaScript, which never sees the NSError. So carry them across.
    private static func describe(_ error: Error, method: String) -> String {
        let ns = error as NSError
        var parts = [ns.localizedDescription]
        if let reason = ns.localizedFailureReason, !reason.isEmpty { parts.append(reason) }
        if let suggestion = ns.localizedRecoverySuggestion, !suggestion.isEmpty {
            parts.append(suggestion)
        }
        parts.append("[\(method) · \(ns.domain) \(ns.code)]")
        let message = parts.joined(separator: " — ")
        NSLog("[HomeHub] bridge %@ failed: %@ %@", method, message, ns.userInfo.description)
        return message
    }

    private func dispatch(_ method: String, _ p: [String: Any]) async throws -> [String: Any] {
        switch method {

        case "calendar.status":
            return ["status": CalendarBridge.authorizationStatus()]
        case "calendar.request":
            return ["status": try await calendar.requestAccess()]
        case "calendar.list":
            return ["calendars": try calendar.calendars()]
        case "calendar.events":
            return ["events": try calendar.events(
                from: date(p["from"]),
                to: date(p["to"]),
                calendarIds: p["calendarIds"] as? [String]
            )]

        case "reminders.status":
            return ["status": RemindersBridge.authorizationStatus()]
        case "reminders.request":
            return ["status": try await reminders.requestAccess()]
        case "reminders.lists":
            return ["lists": try reminders.lists()]
        case "reminders.items":
            return ["reminders": try await reminders.reminders(
                to: date(p["to"]),
                listIds: p["listIds"] as? [String]
            )]
        case "reminders.complete":
            guard let id = p["id"] as? String else {
                throw BridgeError.badParams("reminders.complete needs an id")
            }
            return try reminders.complete(id: id, done: p["done"] as? Bool ?? true)

        case "weather.forecast":
            guard let lat = p["lat"] as? Double, let lon = p["lon"] as? Double else {
                throw BridgeError.badParams("weather.forecast needs lat and lon")
            }
            return try await weather.forecast(latitude: lat, longitude: lon)

        case "display.brightness":
            return ["level": await display.brightness]
        case "display.setBrightness":
            await display.setBrightness(p["level"] as? Double ?? 1)
            return ["ok": true]
        case "display.keepAwake":
            await display.setKeepAwake(p["on"] as? Bool ?? true)
            return ["ok": true]

        case "fetch.text":
            guard let url = p["url"] as? String else {
                throw BridgeError.badParams("fetch.text needs a url")
            }
            return try await net.text(url)

        case "music.status":
            var out: [String: Any] = ["status": MusicBridge.authorizationStatus()]
            // Only worth asking once permission exists; before that the
            // answer is always "no" for the uninteresting reason.
            if MusicBridge.authorizationStatus() == "granted" {
                out["subscription"] = await MusicBridge.subscription()
            }
            return out
        case "music.request":
            return ["status": await music.requestAccess()]
        case "music.now":
            return await music.snapshot()
        case "music.play":
            return try await music.play()
        case "music.pause":
            return try await music.pause()
        case "music.next":
            return try await music.next()
        case "music.previous":
            return try await music.previous()
        case "music.seek":
            return try await music.seek(to: p["seconds"] as? Double ?? 0)
        case "music.shuffle":
            return try await music.setShuffle(p["on"] as? Bool ?? false)
        case "music.repeat":
            return try await music.setRepeat(p["mode"] as? String ?? "off")
        case "music.search":
            guard let term = p["term"] as? String else {
                throw BridgeError.badParams("music.search needs a term")
            }
            return try await music.search(term: term, limit: p["limit"] as? Int ?? 12)
        case "music.playlists":
            return ["playlists": try await music.playlists()]
        case "music.recent":
            return ["items": try await music.recentlyPlayed()]
        case "music.playItem":
            guard let type = p["type"] as? String, let id = p["id"] as? String else {
                throw BridgeError.badParams("music.playItem needs a type and an id")
            }
            return try await music.playItem(type: type, id: id)

        default:
            throw BridgeError.unknownMethod(method)
        }
    }

    /// JS sends epoch milliseconds; Date wants seconds.
    private func date(_ value: Any?) -> Date {
        let ms = (value as? Double) ?? 0
        return Date(timeIntervalSince1970: ms / 1000)
    }

    // MARK: - Pushing the other way

    /// Most bridge traffic is the page asking a question. Music is the one
    /// thing that changes on its own — a track ends, someone skips from a
    /// phone — so it calls into the page instead of waiting to be asked.
    private func installPush() {
        Task { @MainActor in
            music.onChange = { [weak self] snapshot in
                self?.push(topic: "music", payload: snapshot)
            }
            music.startObserving()
        }
    }

    @MainActor
    private func push(topic: String, payload: [String: Any]) {
        guard
            let webView,
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else { return }

        // Guarded: onEvent is assigned by js/core/native.js on load, so a
        // push that lands before the page is ready must be a no-op, not a
        // TypeError in the console.
        webView.evaluateJavaScript(
            "window.HomeHubNative && window.HomeHubNative.onEvent && "
            + "window.HomeHubNative.onEvent(\"\(topic)\", \(json));"
        )
    }
}

enum BridgeError: LocalizedError {
    case unknownMethod(String)
    case badParams(String)
    case notAuthorized(String)
    case upstream(String)

    var errorDescription: String? {
        switch self {
        case .unknownMethod(let m): return "Unknown bridge method: \(m)"
        case .badParams(let m): return m
        case .notAuthorized(let m): return m
        case .upstream(let m): return m
        }
    }
}
