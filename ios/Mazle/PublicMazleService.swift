import Foundation

struct PublicLeaderboardEntry: Codable, Equatable, Identifiable, Sendable {
    let rank: Int
    let displayName: String
    let timeMs: Int
    let attemptsUsed: Int
    let isMe: Bool?

    var id: String { "\(rank)-\(displayName)" }
}

struct PublicLeaderboardPodiumEntry: Codable, Equatable, Sendable {
    let rank: Int
    let displayName: String
    let timeMs: Int
    let attemptsUsed: Int
    let characterId: String
    let skinId: String
    let isMe: Bool?
}

struct PublicLeaderboardResponse: Codable, Equatable, Sendable {
    let date: String
    let entries: [PublicLeaderboardEntry]
    let podium: [PublicLeaderboardPodiumEntry]?
    let total: Int?
    let nextOffset: Int?
}

struct PublicLeaderboardMeResponse: Codable, Equatable, Sendable {
    let date: String
    let rank: Int
    let displayName: String
    let timeMs: Int
    let attemptsUsed: Int
}

struct PublicHallOfFameResponse: Codable, Equatable, Sendable {
    let date: String
    let podium: [PublicLeaderboardPodiumEntry]
}

struct PublicEntitlements: Codable, Equatable, Sendable {
    let archiveAccess: Bool
    let adsRemoved: Bool
    let unlockedSkins: [String]
}

struct PublicProfile: Codable, Equatable, Sendable {
    let characterId: String?
    let skinId: String?
}

struct PublicUserSettings: Codable, Equatable, Sendable {
    let theme: String
    let leaderboardAutoSubmit: Bool
}

struct PublicUserStats: Codable, Equatable, Sendable {
    let playedStreak: Int
    let winStreak: Int
    let maxPlayedStreak: Int
    let totalPlayed: Int
    let totalWins: Int
    let avgSolveTimeMs: Int?
    let goldCount: Int
    let silverCount: Int
    let bronzeCount: Int
}

struct PublicMeResponse: Codable, Equatable, Sendable {
    let mode: String
    let userId: String?
    let displayName: String
    let entitlements: PublicEntitlements
    let profile: PublicProfile?
    let settings: PublicUserSettings?
    let stats: PublicUserStats?
    let provider: String?
}

private struct PublicFeedbackPayload: Encodable, Sendable {
    let message: String
    let puzzleLabel: String
    let failed: Bool
    let attempts: Int
    let timeMs: Int
    let optimalMoves: Int
    let attemptScores: [Int]
    let rating: Int?
}

struct PublicMazleService: Sendable {
    static let live = PublicMazleService(baseURL: MazleRuntimeConfiguration.apiBaseURL)

    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    func leaderboardTop(date: String, limit: Int = 200, offset: Int = 0) async throws -> PublicLeaderboardResponse {
        try await request(
            path: ["api", "leaderboard", "top"],
            queryItems: [
                URLQueryItem(name: "date", value: date),
                URLQueryItem(name: "limit", value: String(limit)),
                URLQueryItem(name: "offset", value: String(offset))
            ]
        )
    }

    func leaderboardMe(date: String) async throws -> PublicLeaderboardMeResponse? {
        try await request(
            path: ["api", "leaderboard", "me"],
            queryItems: [URLQueryItem(name: "date", value: date)]
        )
    }

    func hallOfFame(date: String) async throws -> PublicHallOfFameResponse {
        try await request(
            path: ["api", "hall-of-fame", "podium"],
            queryItems: [URLQueryItem(name: "date", value: date)]
        )
    }

    func me() async throws -> PublicMeResponse {
        try await request(path: ["api", "me"])
    }

    func submitFeedback(
        message: String,
        puzzleLabel: String,
        failed: Bool,
        attempts: Int,
        timeMs: Int,
        optimalMoves: Int,
        attemptScores: [Int],
        rating: Int?
    ) async throws {
        let url = baseURL.appendingPathComponent("api/feedback")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(
            PublicFeedbackPayload(
                message: message,
                puzzleLabel: puzzleLabel,
                failed: failed,
                attempts: attempts,
                timeMs: timeMs,
                optimalMoves: optimalMoves,
                attemptScores: attemptScores,
                rating: rating
            )
        )

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PublicMazleServiceError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw PublicMazleServiceError.httpStatus(httpResponse.statusCode)
        }
    }

    private func request<Response: Decodable>(
        path: [String],
        queryItems: [URLQueryItem] = []
    ) async throws -> Response {
        var url = baseURL
        for component in path {
            url.appendPathComponent(component)
        }

        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw PublicMazleServiceError.invalidURL
        }
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let requestURL = components.url else {
            throw PublicMazleServiceError.invalidURL
        }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PublicMazleServiceError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw PublicMazleServiceError.httpStatus(httpResponse.statusCode)
        }

        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw PublicMazleServiceError.decoding
        }
    }
}

enum PublicMazleServiceError: LocalizedError, Sendable {
    case invalidURL
    case invalidResponse
    case httpStatus(Int)
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The Mazle server URL is invalid."
        case .invalidResponse:
            return "The Mazle server returned an invalid response."
        case .httpStatus(let status):
            return "The Mazle server returned HTTP \(status)."
        case .decoding:
            return "The Mazle server returned data this build could not read."
        }
    }
}
