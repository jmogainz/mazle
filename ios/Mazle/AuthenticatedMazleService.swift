import Foundation

struct AppleEntitlementSyncResponse: Codable, Equatable, Sendable {
    let archiveAccess: Bool
    let adsRemoved: Bool
    let productId: String
    let transactionId: String
    let expiresAt: Date?
}

struct AuthenticatedResultAttempt: Codable, Equatable, Sendable {
    let moveCount: Int
    let correctMoves: Int?
    let deviationIndex: Int?
    let failedAt: GridPosition?
    let path: [GridPosition]?

    init(
        moveCount: Int,
        correctMoves: Int? = nil,
        deviationIndex: Int? = nil,
        failedAt: GridPosition? = nil,
        path: [GridPosition]? = nil
    ) {
        self.moveCount = moveCount
        self.correctMoves = correctMoves
        self.deviationIndex = deviationIndex
        self.failedAt = failedAt
        self.path = path
    }

    init(_ attempt: AttemptRecord) {
        self.init(moveCount: attempt.moveCount, failedAt: attempt.failedAt, path: attempt.path)
    }
}

struct AuthenticatedResultResponse: Codable, Equatable, Sendable {
    let date: String
    let completed: Bool
    let timeMs: Int?
    let attemptsUsed: Int?
    let attemptScores: [Int]?
    let attempts: [AuthenticatedResultAttempt]?
}

struct AuthenticatedResultsDayResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let result: AuthenticatedResultResponse?
}

struct AuthenticatedResultsHistoryRow: Codable, Equatable, Identifiable, Sendable {
    let date: String
    let completed: Bool
    let timeMs: Int?
    let attemptsUsed: Int?
    let attemptScores: [Int]?
    let isRecent: Bool

    var id: String { date }
}

struct AuthenticatedResultsHistoryResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let history: [AuthenticatedResultsHistoryRow]
}

struct AuthenticatedResultsImportRow: Codable, Equatable, Sendable {
    let date: String
    let completed: Bool
    let timeMs: Int?
    let attemptsUsed: Int?
    let attemptScores: [Int]?
    let attempts: [AuthenticatedResultAttempt]?
    let isRecent: Bool?
}

struct AuthenticatedResultsImportResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let imported: Int
    let skipped: Int
}

struct AuthenticatedResultsRecordResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let created: Bool
    let result: AuthenticatedResultResponse
}

struct AuthenticatedLeaderboardSubmitResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let rank: Int?
    let updated: Bool
}

private struct ProfileUpdatePayload: Encodable, Sendable {
    let characterId: String?
    let skinId: String?
}

private struct SettingsUpdatePayload: Encodable, Sendable {
    let theme: String?
    let leaderboardAutoSubmit: Bool?
}

private struct AppleEntitlementSyncPayload: Encodable, Sendable {
    let signedTransaction: String
}

private struct ClaimNamePayload: Encodable, Sendable {
    let displayName: String
}

private struct ResultRecordPayload: Encodable, Sendable {
    let date: String
    let completed: Bool
    let timeMs: Int?
    let attemptsUsed: Int?
    let attemptScores: [Int]?
    let attempts: [AuthenticatedResultAttempt]?
    let isRecent: Bool?
}

private struct ResultsImportPayload: Encodable, Sendable {
    let history: [AuthenticatedResultsImportRow]
}

struct AuthenticatedMazleService: Sendable {
    let baseURL: URL
    let session: MazleAuthSession

    init(baseURL: URL = URL(string: "https://mazle.io")!, session: MazleAuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func me() async throws -> PublicMeResponse {
        try await request(path: ["api", "me"])
    }

    func updateProfile(characterId: String?, skinId: String?) async throws -> PublicProfile {
        let response: ProfileUpdateResponse = try await request(
            path: ["api", "profile"],
            method: "PATCH",
            body: ProfileUpdatePayload(characterId: characterId, skinId: skinId)
        )
        return response.profile
    }

    func updateSettings(theme: String?, leaderboardAutoSubmit: Bool?) async throws -> PublicUserSettings {
        let response: SettingsUpdateResponse = try await request(
            path: ["api", "settings"],
            method: "PATCH",
            body: SettingsUpdatePayload(theme: theme, leaderboardAutoSubmit: leaderboardAutoSubmit)
        )
        return response.settings
    }

    func syncAppleTransaction(jwsRepresentation: String) async throws -> AppleEntitlementSyncResponse {
        try await request(
            path: ["api", "apple", "entitlements"],
            method: "POST",
            body: AppleEntitlementSyncPayload(signedTransaction: jwsRepresentation)
        )
    }

    func claimDisplayName(_ displayName: String) async throws -> String {
        let response: ClaimNameResponse = try await request(
            path: ["api", "claim"],
            method: "POST",
            body: ClaimNamePayload(displayName: displayName)
        )
        return response.displayName
    }

    func recordResult(
        date: String,
        completed: Bool,
        timeMs: Int?,
        attemptsUsed: Int?,
        attemptScores: [Int]?,
        attempts: [AuthenticatedResultAttempt]?,
        isRecent: Bool = false
    ) async throws -> AuthenticatedResultsRecordResponse {
        try await request(
            path: ["api", "results", "record"],
            method: "POST",
            body: ResultRecordPayload(
                date: date,
                completed: completed,
                timeMs: timeMs,
                attemptsUsed: attemptsUsed,
                attemptScores: attemptScores,
                attempts: attempts,
                isRecent: isRecent ? true : nil
            )
        )
    }

    func resultsDay(date: String) async throws -> AuthenticatedResultsDayResponse {
        try await request(
            path: ["api", "results", "day"],
            queryItems: [URLQueryItem(name: "date", value: date)]
        )
    }

    func resultsHistory() async throws -> AuthenticatedResultsHistoryResponse {
        try await request(path: ["api", "results", "history"])
    }

    func importHistory(_ entries: [LocalHistoryEntry]) async throws -> AuthenticatedResultsImportResponse {
        let rows = entries.map {
            AuthenticatedResultsImportRow(
                date: $0.date,
                completed: $0.completed,
                timeMs: $0.timeSeconds.map { $0 * 1000 },
                attemptsUsed: $0.attemptsUsed,
                attemptScores: nil,
                attempts: nil,
                isRecent: (DailyDate.daysBetween($0.date, and: DailyDate.todayString()) ?? 0) >= 2
            )
        }
        return try await request(
            path: ["api", "results", "import"],
            method: "POST",
            body: ResultsImportPayload(history: rows)
        )
    }

    func leaderboardSubmit(date: String) async throws -> AuthenticatedLeaderboardSubmitResponse {
        try await request(
            path: ["api", "leaderboard", "submit"],
            method: "POST",
            body: ["date": date]
        )
    }

    func leaderboardAround(date: String, rank: Int, window: Int = 5) async throws -> PublicLeaderboardResponse {
        try await request(
            path: ["api", "leaderboard", "around"],
            queryItems: [
                URLQueryItem(name: "date", value: date),
                URLQueryItem(name: "rank", value: String(rank)),
                URLQueryItem(name: "window", value: String(window)),
            ]
        )
    }

    private func request<Response: Decodable>(
        path: [String],
        queryItems: [URLQueryItem] = [],
        method: String = "GET",
        bodyData: Data? = nil
    ) async throws -> Response {
        let data = try await perform(path: path, queryItems: queryItems, method: method, bodyData: bodyData)
        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw PublicMazleServiceError.decoding
        }
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: [String],
        method: String,
        body: Body
    ) async throws -> Response {
        let bodyData = try JSONEncoder().encode(body)
        return try await request(path: path, method: method, bodyData: bodyData)
    }

    private func perform(
        path: [String],
        queryItems: [URLQueryItem],
        method: String,
        bodyData: Data?
    ) async throws -> Data {
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
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        if bodyData != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PublicMazleServiceError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw PublicMazleServiceError.httpStatus(httpResponse.statusCode)
        }
        return data
    }
}

private struct ClaimNameResponse: Decodable {
    let displayName: String
}

private struct ProfileUpdateResponse: Decodable {
    let profile: PublicProfile
}

private struct SettingsUpdateResponse: Decodable {
    let settings: PublicUserSettings
}
