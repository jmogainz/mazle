import Foundation

struct DailyPuzzleService: Sendable {
    static let live = DailyPuzzleService(baseURL: MazleRuntimeConfiguration.apiBaseURL)

    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    func fetchToday(date: String) async throws -> DailyPuzzleResponse {
        try await fetch(date: date)
    }

    func fetch(date: String) async throws -> DailyPuzzleResponse {
        if MazleRuntimeConfiguration.isOfflineBuild {
            return try offlineResponse(for: date)
        }

        let today = DailyDate.todayString()

        if date == today {
            do {
                let response = try await request(path: ["api", "daily"], queryItems: [URLQueryItem(name: "d", value: date)])
                guard response.date == date else {
                    throw DailyPuzzleServiceError.dateMismatch(expected: date, actual: response.date)
                }
                return response
            } catch {
                // Preserve the existing archive fallback for a daily cache miss.
                return try await request(path: ["api", "archive", date])
            }
        }

        // The web deliberately exposes the recent window separately from the
        // entitlement-gated archive route. Try it first for every non-today
        // date; dates outside the free window fall through to /api/archive.
        do {
            let response = try await request(path: ["api", "recent", date])
            guard response.date == date else {
                throw DailyPuzzleServiceError.dateMismatch(expected: date, actual: response.date)
            }
            return response
        } catch {
            return try await request(path: ["api", "archive", date])
        }
    }

    private func offlineResponse(for date: String) throws -> DailyPuzzleResponse {
        let bundle: Bundle
        if Bundle.main.url(forResource: AdventureCatalogLoader.resourceName, withExtension: "json") != nil {
            bundle = .main
        } else {
            bundle = Bundle(for: AdventureProgressStore.self)
        }
        let catalog = try AdventureCatalogLoader.load(bundle: bundle)
        guard let level = catalog.level(id: 1) else {
            throw DailyPuzzleServiceError.missingPuzzle
        }
        return DailyPuzzleResponse(
            puzzle: level.puzzle,
            puzzleNumber: 1,
            date: date,
            seed: level.seed,
            source: "offline-testflight"
        )
    }

    private func request(path: [String], queryItems: [URLQueryItem] = []) async throws -> DailyPuzzleResponse {
        guard !MazleRuntimeConfiguration.isOfflineBuild else {
            throw MazleRuntimeError.offlineOnlyBuild
        }
        var url = baseURL
        for component in path {
            url.appendPathComponent(component)
        }

        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw DailyPuzzleServiceError.invalidURL
        }
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let requestURL = components.url else {
            throw DailyPuzzleServiceError.invalidURL
        }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DailyPuzzleServiceError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw DailyPuzzleServiceError.httpStatus(httpResponse.statusCode)
        }

        let decoded = try JSONDecoder().decode(DailyPuzzleResponse.self, from: data)
        guard decoded.puzzle != nil else {
            throw DailyPuzzleServiceError.missingPuzzle
        }
        return decoded
    }
}

enum DailyPuzzleServiceError: LocalizedError, Sendable {
    case invalidURL
    case invalidResponse
    case httpStatus(Int)
    case missingPuzzle
    case dateMismatch(expected: String, actual: String)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "The Mazle server URL is invalid."
        case .invalidResponse: return "The Mazle server returned an invalid response."
        case .httpStatus(let status): return "The Mazle server returned HTTP \(status)."
        case .missingPuzzle: return "Today's puzzle was not included in the response."
        case .dateMismatch(let expected, let actual): return "The server returned \(actual) instead of the requested puzzle date \(expected)."
        case .decoding: return "Today's puzzle could not be decoded."
        }
    }
}
