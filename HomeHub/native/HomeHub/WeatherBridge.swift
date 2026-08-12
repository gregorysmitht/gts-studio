import Foundation
import WeatherKit
import CoreLocation

/// WeatherKit, normalised into the hub's own model.
///
/// The web app stores weather canonically in °F / mph / inches and uses
/// a small fixed condition vocabulary, so everything is converted here
/// rather than in JavaScript — the views cannot tell WeatherKit from
/// the National Weather Service.
///
/// Apple requires visible attribution wherever this data appears; the
/// payload carries the logo and legal URLs, and the weather panel shows
/// them in its source line.
final class WeatherBridge {

    private let service = WeatherService.shared

    func forecast(latitude: Double, longitude: Double) async throws -> [String: Any] {
        let location = CLLocation(latitude: latitude, longitude: longitude)

        let (current, hourly, daily, alerts) = try await service.weather(
            for: location,
            including: .current, .hourly, .daily, .alerts
        )
        let attribution = try await service.attribution

        let now = Date()
        let hours = hourly
            .filter { $0.date > now.addingTimeInterval(-3600) }
            .prefix(72)
            .map(Self.hour)

        return [
            "source": "weatherkit",
            "updated": current.date.timeIntervalSince1970 * 1000,
            "current": Self.current(current),
            "hourly": Array(hours),
            "daily": daily.forecast.prefix(10).map(Self.day),
            "alerts": (alerts ?? []).map(Self.alert),
            "attribution": [
                "name": "Apple Weather",
                "legalUrl": attribution.legalPageURL.absoluteString,
                "markUrl": attribution.combinedMarkDarkURL.absoluteString,
            ],
        ]
    }

    // MARK: - Unit conversion

    private static func f(_ t: Measurement<UnitTemperature>) -> Double {
        t.converted(to: .fahrenheit).value
    }
    private static func mph(_ s: Measurement<UnitSpeed>) -> Double {
        s.converted(to: .milesPerHour).value
    }
    private static func inches(_ l: Measurement<UnitLength>) -> Double {
        l.converted(to: .inches).value
    }
    private static func ms(_ d: Date) -> Double { d.timeIntervalSince1970 * 1000 }

    // MARK: - Shapes

    private static func current(_ c: CurrentWeather) -> [String: Any] {
        [
            "time": ms(c.date),
            "temp": f(c.temperature),
            "feelsLike": f(c.apparentTemperature),
            "condition": condition(c.condition, precipitation: c.precipitationIntensity.value),
            "summary": c.condition.description,
            "precipChance": 0,
            "precipAmount": 0,
            "thunderChance": 0,
            "lightning": 0,
            "cloudCover": c.cloudCover * 100,
            "humidity": c.humidity * 100,
            "dewPoint": f(c.dewPoint),
            "windSpeed": mph(c.wind.speed),
            "windGust": c.wind.gust.map(mph) ?? NSNull(),
            "windDir": c.wind.direction.value,
            "pressure": c.pressure.converted(to: .hectopascals).value,
            "visibility": c.visibility.converted(to: .miles).value,
            "night": !c.isDaylight,
        ]
    }

    private static func hour(_ h: HourWeather) -> [String: Any] {
        [
            "time": ms(h.date),
            "temp": f(h.temperature),
            "feelsLike": f(h.apparentTemperature),
            "condition": condition(h.condition, precipitation: h.precipitationAmount.value),
            "summary": h.condition.description,
            "precipChance": h.precipitationChance * 100,
            "precipAmount": inches(h.precipitationAmount),
            // WeatherKit has no thunder probability; its condition enum is
            // the only signal, so mirror what the NWS path reports for a
            // "thunderstorms" hour rather than inventing a number.
            "thunderChance": isThunder(h.condition) ? 60 : 0,
            "lightning": isThunder(h.condition) ? 3 : 0,
            "cloudCover": h.cloudCover * 100,
            "humidity": h.humidity * 100,
            "dewPoint": f(h.dewPoint),
            "windSpeed": mph(h.wind.speed),
            "windGust": h.wind.gust.map(mph) ?? NSNull(),
            "windDir": h.wind.direction.value,
            "night": !h.isDaylight,
        ]
    }

    private static func day(_ d: DayWeather) -> [String: Any] {
        [
            "date": ms(Calendar.current.startOfDay(for: d.date)),
            "hi": f(d.highTemperature),
            "lo": f(d.lowTemperature),
            "condition": condition(d.condition, precipitation: d.precipitationAmount.value),
            "summary": d.condition.description,
            "detail": d.condition.description,
            "precipChance": d.precipitationChance * 100,
            "precipAmount": inches(d.precipitationAmount),
            "thunderChance": isThunder(d.condition) ? 50 : 0,
            "windSpeed": mph(d.wind.speed),
            "uvMax": Double(d.uvIndex.value),
            "sunrise": d.sun.sunrise.map(ms) ?? NSNull(),
            "sunset": d.sun.sunset.map(ms) ?? NSNull(),
        ]
    }

    private static func alert(_ a: WeatherAlert) -> [String: Any] {
        let event = a.summary
        return [
            "id": a.detailsURL.absoluteString,
            "event": event,
            "severity": severity(a.severity),
            "headline": event,
            "description": a.summary,
            "instruction": "",
            "areaDesc": a.region ?? "",
            "sender": a.source,
            "onset": ms(a.metadata.date),
            "ends": a.metadata.expirationDate.timeIntervalSince1970 * 1000,
            "geometry": NSNull(),
            "isThunder": event.localizedCaseInsensitiveContains("thunder")
                || event.localizedCaseInsensitiveContains("tornado"),
            "isTropical": event.localizedCaseInsensitiveContains("hurricane")
                || event.localizedCaseInsensitiveContains("tropical"),
        ]
    }

    private static func severity(_ s: WeatherSeverity) -> String {
        switch s {
        case .extreme: return "Extreme"
        case .severe: return "Severe"
        case .moderate: return "Moderate"
        case .minor: return "Minor"
        case .unknown: return "Unknown"
        @unknown default: return "Unknown"
        }
    }

    private static func isThunder(_ c: WeatherCondition) -> Bool {
        switch c {
        case .thunderstorms, .strongStorms, .isolatedThunderstorms,
             .scatteredThunderstorms, .tropicalStorm, .hurricane:
            return true
        default:
            return false
        }
    }

    /// WeatherKit's condition enum → the hub's vocabulary
    /// (js/data/conditions.js). Anything unmapped falls back to cloud
    /// cover on the JS side, so the default here is deliberately plain.
    private static func condition(_ c: WeatherCondition, precipitation: Double) -> String {
        switch c {
        case .clear, .mostlyClear, .hot:
            return "clear"
        case .partlyCloudy, .mostlyCloudy:
            return "partly"
        case .cloudy:
            return "cloudy"
        case .haze, .smoky, .blowingDust:
            return "haze"
        case .foggy:
            return "fog"
        case .drizzle, .sunShowers:
            return "drizzle"
        case .rain, .heavyRain, .freezingRain, .freezingDrizzle:
            return c == .heavyRain ? "heavy-rain" : "rain"
        case .hail:
            return "hail"
        case .thunderstorms, .strongStorms, .isolatedThunderstorms,
             .scatteredThunderstorms:
            return "thunder"
        case .tropicalStorm, .hurricane:
            return "heavy-rain"
        case .sleet, .wintryMix:
            return "sleet"
        case .snow, .heavySnow, .flurries, .blizzard, .blowingSnow,
             .sunFlurries, .frigid:
            return "snow"
        case .windy, .breezy:
            return "wind"
        @unknown default:
            return precipitation > 0 ? "rain" : "cloudy"
        }
    }
}
