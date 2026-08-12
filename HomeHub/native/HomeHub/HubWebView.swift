import SwiftUI
import WebKit

/// The web view that hosts the hub.
///
/// The bundled app is served through a custom URL scheme rather than
/// `file://`. A file origin is opaque, which would block every request
/// to api.weather.gov and friends; a custom scheme gives the page a real
/// origin. Network still goes through NetBridge, but tiles load directly
/// as images and need a sane origin to do it.
struct HubWebView: UIViewRepresentable {

    /// Anything but http/https/file/about/data, which WebKit reserves.
    static let scheme = "homehub"
    static let origin = "\(scheme)://app"

    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: Self.scheme)
        config.userContentController.addUserScript(Bridge.installScript)
        config.userContentController.addScriptMessageHandler(
            context.coordinator, contentWorld: .page, name: Bridge.name
        )

        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // The hub is one page; there is nothing to navigate to.
        config.suppressesIncrementalRendering = false

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        // A wall panel should not rubber-band or zoom.
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        if #available(iOS 16.4, *) {
            // Lets Safari's Web Inspector attach over USB while building.
            webView.isInspectable = true
        }

        // The bridge needs a way back into the page to push music changes.
        context.coordinator.webView = webView

        webView.load(URLRequest(url: URL(string: "\(Self.origin)/index.html")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}

/// Serves the bundled `Web/` directory over the custom scheme.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {

    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "ico": "image/x-icon",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard
            let url = task.request.url,
            let root = Bundle.main.url(forResource: "Web", withExtension: nil)
        else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        var relative = url.path
        if relative.isEmpty || relative == "/" { relative = "/index.html" }

        // Refuse to escape the bundled directory.
        let candidate = root.appendingPathComponent(String(relative.dropFirst())).standardized
        guard candidate.path.hasPrefix(root.standardized.path) else {
            task.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        guard let data = try? Data(contentsOf: candidate) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let type = Self.types[candidate.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": type, "Cache-Control": "no-cache"]
        )!

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
