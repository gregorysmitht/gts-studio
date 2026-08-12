import Foundation
import MusicKit
import MediaPlayer

/// Apple Music, via MusicKit.
///
/// Playback is entirely native: `ApplicationMusicPlayer` is the system
/// player, so what the hub starts also appears in Control Center, on the
/// lock screen, and on any HomePod the iPad is playing to. The web layer
/// never touches audio — it renders the snapshot this file produces and
/// sends transport commands back.
///
/// MusicKit JS was the alternative and was rejected: it needs a
/// server-signed developer token, plays through the web view's own audio
/// session, and would have been invisible to the rest of the system.
///
/// Two things flow the other way. Every command replies with a fresh
/// snapshot, *and* the player's own state is observed — so a track
/// ending, or someone skipping from their phone, pushes to the web view
/// without the hub asking.
@MainActor
final class MusicBridge {

    /// Called with a snapshot whenever playback changes on its own.
    var onChange: (([String: Any]) -> Void)?

    private let player = ApplicationMusicPlayer.shared
    private var observers: [Task<Void, Never>] = []

    // MARK: - Authorisation

    /// Mirrors the strings js/core/native.js expects.
    static func authorizationStatus() -> String {
        switch MusicAuthorization.currentStatus {
        case .notDetermined: return "notDetermined"
        case .denied, .restricted: return "denied"
        case .authorized: return "granted"
        @unknown default: return "denied"
        }
    }

    func requestAccess() async -> String {
        _ = await MusicAuthorization.request()
        return Self.authorizationStatus()
    }

    private func requireAccess() throws {
        guard Self.authorizationStatus() == "granted" else {
            throw BridgeError.notAuthorized("HomeHub does not have Apple Music access yet")
        }
    }

    /// Permission granted is not the same as being able to play anything.
    ///
    /// Catalog requests — search, recently played, most of the library —
    /// need an active Apple Music subscription on this Apple ID. Without
    /// one MusicKit authorises perfectly happily and then fails every
    /// request with a bare `MusicDataRequest.Error`, which tells the
    /// family nothing. Asking MusicSubscription directly turns that into
    /// a sentence they can act on.
    static func subscription() async -> [String: Any] {
        do {
            for try await sub in MusicSubscription.subscriptionUpdates {
                return [
                    "known": true,
                    "canPlayCatalog": sub.canPlayCatalogContent,
                    "canSubscribe": sub.canBecomeSubscriber,
                ]
            }
        } catch { /* fall through — unknown is honest here */ }
        return ["known": false, "canPlayCatalog": false, "canSubscribe": false]
    }

    // MARK: - Change observation

    /// Watches the system player so the wall stays truthful about music it
    /// did not start. Both publishers fire on the main actor already.
    func startObserving() {
        stopObserving()

        observers.append(Task { [weak self] in
            for await _ in ApplicationMusicPlayer.shared.state.objectWillChange.values {
                guard let self else { return }
                self.onChange?(self.snapshot())
            }
        })

        observers.append(Task { [weak self] in
            for await _ in ApplicationMusicPlayer.shared.queue.objectWillChange.values {
                guard let self else { return }
                self.onChange?(self.snapshot())
            }
        })
    }

    func stopObserving() {
        observers.forEach { $0.cancel() }
        observers = []
    }

    // MARK: - Transport

    func play() async throws -> [String: Any] {
        try requireAccess()
        try await player.play()
        return snapshot()
    }

    func pause() throws -> [String: Any] {
        try requireAccess()
        player.pause()
        return snapshot()
    }

    func next() async throws -> [String: Any] {
        try requireAccess()
        try await player.skipToNextEntry()
        return snapshot()
    }

    /// Matches the Music app: restart the track unless you're near the top.
    func previous() async throws -> [String: Any] {
        try requireAccess()
        if player.playbackTime > 4 {
            player.playbackTime = 0
        } else {
            try await player.skipToPreviousEntry()
        }
        return snapshot()
    }

    func seek(to seconds: Double) throws -> [String: Any] {
        try requireAccess()
        player.playbackTime = max(0, seconds)
        return snapshot()
    }

    func setShuffle(_ on: Bool) throws -> [String: Any] {
        try requireAccess()
        player.state.shuffleMode = on ? .songs : .off
        return snapshot()
    }

    func setRepeat(_ mode: String) throws -> [String: Any] {
        try requireAccess()
        switch mode {
        case "one": player.state.repeatMode = .one
        case "all": player.state.repeatMode = .all
        // Spelled out: repeatMode is optional, so a bare `.none` would be
        // read as Optional.none and silently mean "unset" instead of "off".
        default:    player.state.repeatMode = MusicPlayer.RepeatMode.none
        }
        return snapshot()
    }

    // MARK: - Snapshot

    /// The shape js/data/music.js applies to its `player` object.
    /// `position` is a measurement, not a subscription: the web side
    /// extrapolates from it so the scrubber runs at 60fps without asking
    /// again.
    func snapshot() -> [String: Any] {
        var out: [String: Any] = [
            "state": stateName,
            "position": player.playbackTime,
            "shuffle": player.state.shuffleMode == .songs,
            "repeat": repeatName,
            "auth": Self.authorizationStatus(),
        ]

        if let entry = player.queue.currentEntry {
            out["track"] = track(from: entry)
        } else {
            out["track"] = NSNull()
        }

        /* Only what fits on screen; the rest of the queue is not shown.
           Written out with an index rather than a drop/dropFirst/prefix
           chain — the collection slicing was harder to read than it was
           worth, and this is the same three entries. */
        let entries = Array(player.queue.entries)
        let currentId = player.queue.currentEntry?.id
        let start = entries.firstIndex { $0.id == currentId }.map { $0 + 1 } ?? 0
        out["queue"] = entries[start..<min(start + 3, entries.count)]
            .map { entry -> [String: Any] in
                [
                    // Every id crosses into JavaScript, so it has to be a
                    // String: JSONSerialization rejects anything else and
                    // the push would silently vanish.
                    "id": String(describing: entry.id),
                    "type": "song",
                    "title": entry.title,
                    "subtitle": entry.subtitle ?? "",
                    "artworkUrl": artworkURL(entry.artwork, size: 200),
                ]
            }

        return out
    }

    private var stateName: String {
        switch player.state.playbackStatus {
        case .playing, .seekingForward, .seekingBackward: return "playing"
        case .paused, .interrupted: return "paused"
        case .stopped: return "stopped"
        @unknown default: return "stopped"
        }
    }

    private var repeatName: String {
        switch player.state.repeatMode {
        case .one: return "one"
        case .all: return "all"
        default:   return "off"
        }
    }

    private func track(from entry: ApplicationMusicPlayer.Queue.Entry) -> [String: Any] {
        var album = ""
        var duration: Any = NSNull()

        /* The queue entry only carries display strings; the underlying item
           is where the album title and duration live. The `?` matters —
           `item` is optional, and matching a non-optional pattern against
           it does not compile. */
        if case let .song(song)? = entry.item {
            album = song.albumTitle ?? ""
            if let seconds = song.duration { duration = seconds }
        }

        return [
            "id": String(describing: entry.id),
            "title": entry.title,
            "artist": entry.subtitle ?? "",
            "album": album,
            "artworkUrl": artworkURL(entry.artwork, size: 1200),
            "duration": duration,
        ]
    }

    /// MusicKit renders artwork at whatever size is asked for, so the wall
    /// gets a large square and the mini player a small one.
    private func artworkURL(_ artwork: Artwork?, size: Int) -> Any {
        guard let artwork else { return NSNull() }
        /* Not every size is served for every item — playlist artwork in
           particular is fussier than song and album artwork — so fall
           back through a couple of common ones before giving up. */
        let url = artwork.url(width: size, height: size)
            ?? artwork.url(width: 600, height: 600)
            ?? artwork.url(width: 300, height: 300)
        guard let url else { return NSNull() }
        /* Library items — especially the smart playlists inherited from an
           old iTunes library — come back with private schemes a web view
           cannot fetch, which renders as a broken-image glyph. Nothing is
           friendlier than that, so say there is no artwork and let the UI
           draw its own placeholder. */
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            return NSNull()
        }
        return url.absoluteString
    }

    // MARK: - Browsing

    func search(term: String, limit: Int) async throws -> [String: Any] {
        try requireAccess()

        var request = MusicCatalogSearchRequest(
            term: term,
            types: [Song.self, Album.self, Playlist.self]
        )
        request.limit = limit
        let response = try await request.response()

        return [
            "songs": response.songs.map { song in
                item(id: song.id.rawValue, type: "song", title: song.title,
                     subtitle: song.artistName, artwork: song.artwork)
            },
            "albums": response.albums.map { album in
                item(id: album.id.rawValue, type: "album", title: album.title,
                     subtitle: album.artistName, artwork: album.artwork)
            },
            "playlists": response.playlists.map { list in
                item(id: list.id.rawValue, type: "playlist", title: list.name,
                     subtitle: list.curatorName ?? "Playlist", artwork: list.artwork)
            },
        ]
    }

    func playlists(limit: Int = 40) async throws -> [[String: Any]] {
        try requireAccess()

        var request = MusicLibraryRequest<Playlist>()
        request.limit = limit
        let response = try await request.response()

        return response.items.map { list in
            item(id: list.id.rawValue, type: "playlist", title: list.name,
                 subtitle: list.curatorName ?? "Playlist", artwork: list.artwork)
        }
    }

    func recentlyPlayed(limit: Int = 20) async throws -> [[String: Any]] {
        try requireAccess()

        var request = MusicRecentlyPlayedContainerRequest()
        request.limit = limit
        let response = try await request.response()

        return response.items.compactMap { container in
            switch container {
            case .album(let album):
                return item(id: album.id.rawValue, type: "album", title: album.title,
                            subtitle: album.artistName, artwork: album.artwork)
            case .playlist(let list):
                return item(id: list.id.rawValue, type: "playlist", title: list.name,
                            subtitle: list.curatorName ?? "Playlist", artwork: list.artwork)
            case .station(let station):
                return item(id: station.id.rawValue, type: "station", title: station.name,
                            subtitle: "Station", artwork: station.artwork)
            @unknown default:
                return nil
            }
        }
    }

    /// One shape for every browsable thing, so the shelves in
    /// js/ui/music-panel.js don't branch on type to render a tile.
    private func item(id: String, type: String, title: String,
                      subtitle: String, artwork: Artwork?) -> [String: Any] {
        [
            "id": id,
            "type": type,
            "title": title,
            "subtitle": subtitle,
            "artworkUrl": artworkURL(artwork, size: 400),
        ]
    }

    // MARK: - Starting playback

    /// A song plays on its own; an album, playlist or station replaces the
    /// queue and starts at the top — the same thing tapping it in Music does.
    func playItem(type: String, id: String) async throws -> [String: Any] {
        try requireAccess()

        let musicId = MusicItemID(id)

        /* All four go through Queue(for:startingAt:) and nothing else.

           The album- and playlist-specific initialisers look like the
           obvious choice and are a trap twice over. They do not take what
           you would expect — Queue(playlist:startingAt:) wants a
           Playlist.Entry, not a Track — and when the argument type is
           wrong Swift resolves to a different overload and reports
           "Missing argument for parameter 'startingAt'", which sends you
           looking at the one thing on the line that is definitely fine.

           Queue(for:) takes any sequence of PlayableMusicItem, so the
           same call shape covers all four cases. Albums and playlists
           load their track lists first and queue the *tracks*: a queue
           holding an album entry rather than tracks compiles, then fails
           at play() with MPMusicPlayerControllerErrorDomain 6. */

        /* Deliberately longhand rather than one generic `resolve<T>`.
           Constraining a type to be both MusicCatalogResourceRequestable
           and MusicLibraryRequestable — while Station is only the former —
           is the kind of generic puzzle that costs an hour and buys three
           saved lines. Each case below reads as exactly what it does.

           Catalog first, then the library: something the family added to
           their own library is not always reachable by catalog id, and a
           playlist they made themselves exists *only* in the library. */
        switch type {

        case "song":
            var song = try? await MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: musicId)
                .response().items.first
            if song == nil {
                var request = MusicLibraryRequest<Song>()
                request.filter(matching: \.id, equalTo: musicId)
                song = try? await request.response().items.first
            }
            guard let song else { throw notFound }
            player.queue = ApplicationMusicPlayer.Queue(for: [song], startingAt: song)

        case "album":
            var album = try? await MusicCatalogResourceRequest<Album>(matching: \.id, equalTo: musicId)
                .response().items.first
            if album == nil {
                var request = MusicLibraryRequest<Album>()
                request.filter(matching: \.id, equalTo: musicId)
                album = try? await request.response().items.first
            }
            guard let album else { throw notFound }
            /* A queue "for" a single album entry looks reasonable and then
               fails at play() with MPMusicPlayerControllerErrorDomain 6:
               nothing in it is an actual track. Load the track list and
               queue the tracks themselves, which is what tapping an album
               in Music does. */
            guard let tracks = try await album.with(.tracks).tracks, let first = tracks.first else {
                throw BridgeError.upstream("That album has no tracks to play")
            }
            player.queue = ApplicationMusicPlayer.Queue(for: tracks, startingAt: first)

        case "playlist":
            var list = try? await MusicCatalogResourceRequest<Playlist>(matching: \.id, equalTo: musicId)
                .response().items.first
            if list == nil {
                var request = MusicLibraryRequest<Playlist>()
                request.filter(matching: \.id, equalTo: musicId)
                list = try? await request.response().items.first
            }
            guard let list else { throw notFound }
            guard let tracks = try await list.with(.tracks).tracks, let first = tracks.first else {
                throw BridgeError.upstream("That playlist is empty")
            }
            player.queue = ApplicationMusicPlayer.Queue(for: tracks, startingAt: first)

        case "station":
            // Stations live only in the catalog; there is no library to
            // fall back to.
            let station = try await MusicCatalogResourceRequest<Station>(matching: \.id, equalTo: musicId)
                .response().items.first
            guard let station else { throw notFound }
            player.queue = ApplicationMusicPlayer.Queue(for: [station], startingAt: station)

        default:
            throw BridgeError.badParams("Unknown music item type: \(type)")
        }

        try await player.play()
        return snapshot()
    }

    private var notFound: BridgeError {
        .upstream("Could not find that in Apple Music")
    }
}
