import Foundation

/// Network access on behalf of the web layer.
///
/// A URLSession request has no origin, so CORS never applies. That means
/// the app needs no server-side proxy at all: the hosts the browser
/// build routes through a Netlify function — nhc.noaa.gov, calendar
/// feeds — are reached directly here.
///
/// The same guards as netlify/functions/proxy.js still apply, because
/// the URL still originates from page script: https only, no embedded
/// credentials, bounded size and time.
final class NetBridge {

    private static let maxBytes = 8 * 1024 * 1024
    private static let timeout: TimeInterval = 20

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = Self.timeout
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpAdditionalHeaders = [
            // weather.gov asks for a descriptive agent and rate-limits
            // generic ones; this is the reason the browser build needs a
            // proxy for it at all.
            "User-Agent": "HomeHub/1.0 (family wall display)",
            "Accept": "application/geo+json, application/json, text/calendar, text/plain, */*",
        ]
        return URLSession(configuration: config)
    }()

    func text(_ urlString: String) async throws -> [String: Any] {
        guard
            let url = URL(string: urlString),
            url.scheme?.lowercased() == "https",
            url.user == nil, url.password == nil
        else {
            throw BridgeError.badParams("Only https URLs without credentials are allowed")
        }

        let (data, response) = try await session.data(from: url)

        guard data.count <= Self.maxBytes else {
            throw BridgeError.upstream("Response too large")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200

        // Calendar feeds are not always valid UTF-8; fall back rather
        // than failing the whole refresh over one mis-encoded byte.
        let body = String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .isoLatin1)
            ?? ""

        return ["status": status, "body": body]
    }
}
