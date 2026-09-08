import Foundation

struct AdventureRemoteLevelResult: Codable, Equatable, Sendable {
    let levelId: Int
    let stars: Int
    let bestMoves: Int
    let bestTimeMs: Int
    let completedAt: Date

    var local: AdventureLevelResult {
        AdventureLevelResult(
            levelId: levelId,
            stars: stars,
            bestMoves: bestMoves,
            bestTimeMs: bestTimeMs,
            completedAt: completedAt
        )
    }
}

struct AdventureRemoteProgress: Codable, Equatable, Sendable {
    let catalogVersion: String
    let currentLevel: Int
    let unlockedLevel: Int
    let completedLevels: Int
    let totalStars: Int
    let completedAll: Bool
    let levels: [AdventureRemoteLevelResult]

    func local(maximumLevel: Int) -> AdventureProgress {
        AdventureProgress(
            catalogVersion: catalogVersion,
            highestUnlockedLevel: min(maximumLevel, max(1, unlockedLevel)),
            levelResults: Dictionary(uniqueKeysWithValues: levels.map { ($0.levelId, $0.local) })
        )
    }
}

struct AdventureRemoteEnergy: Codable, Equatable, Sendable {
    let hearts: Int
    let maxHearts: Int
    let nextHeartAt: Date?
    let refillTickets: Int
    let dailyRefillAvailable: Bool
    let serverNow: Date

    var local: AdventureEnergy {
        AdventureEnergy(
            hearts: min(maxHearts, max(0, hearts)),
            maximumHearts: maxHearts,
            nextHeartAt: nextHeartAt,
            refillTickets: max(0, refillTickets)
        )
    }
}

struct AdventureRemoteAttempt: Codable, Equatable, Sendable {
    let attemptId: UUID
    let levelId: Int
    let startedAt: Date
    let energyReserved: Bool
}

struct AdventureStateResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let progress: AdventureRemoteProgress
    let energy: AdventureRemoteEnergy
    let activeAttempt: AdventureRemoteAttempt?
    let accountRequiredForPurchases: Bool
}

struct AdventureStartResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let attempt: AdventureRemoteAttempt
    let energy: AdventureRemoteEnergy
}

struct AdventureCompleteResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let level: AdventureRemoteLevelResult
    let progress: AdventureRemoteProgress
    let energy: AdventureRemoteEnergy
}

struct AdventureFailResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let energy: AdventureRemoteEnergy
}

struct AdventureRefillResponse: Codable, Equatable, Sendable {
    let ok: Bool
    let energy: AdventureRemoteEnergy
}

enum AdventureAttemptOutcome: String, Codable, Sendable {
    case failed
    case abandoned
}

enum AdventureRefillSource: String, Codable, Sendable {
    case daily
    case ticket
}

private struct AdventureStartPayload: Encodable {
    let levelId: Int
    let catalogVersion: String
    let idempotencyKey: UUID
}

private struct AdventureCompletePayload: Encodable {
    let attemptId: UUID
    let moves: Int
    let timeMs: Int
    let catalogVersion: String
    let idempotencyKey: UUID
}

private struct AdventureFailPayload: Encodable {
    let attemptId: UUID
    let moves: Int
    let timeMs: Int
    let outcome: AdventureAttemptOutcome
    let idempotencyKey: UUID
}

private struct AdventureSyncLevelPayload: Encodable {
    let levelId: Int
    let bestMoves: Int
    let bestTimeMs: Int
    let completedAt: Date
}

private struct AdventureSyncPayload: Encodable {
    let catalogVersion: String
    let idempotencyKey: UUID
    let levels: [AdventureSyncLevelPayload]
}

private struct AdventureRefillPayload: Encodable {
    let source: AdventureRefillSource
    let idempotencyKey: UUID
}

private struct AdventureAppleRefillPayload: Encodable {
    let signedTransaction: String
}

enum AdventureServiceError: LocalizedError {
    case invalidResponse
    case httpStatus(status: Int, code: String?, message: String?)
    case decoding

    var permitsOfflineStart: Bool {
        guard case .httpStatus(let status, _, _) = self else { return false }
        return status >= 500
    }

    var isTerminalAppleClaimFailure: Bool {
        guard case .httpStatus(let status, _, _) = self else { return false }
        return (400..<500).contains(status) && status != 401 && status != 429
    }

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The Adventure server returned an invalid response."
        case .httpStatus(let status, let code, let message):
            return message ?? code.map { "Adventure sync failed: \($0)." } ?? "Adventure sync failed (\(status))."
        case .decoding:
            return "The Adventure server response could not be read."
        }
    }
}

struct AdventureService {
    let baseURL: URL
    let session: MazleAuthSession

    init(baseURL: URL = URL(string: "https://mazle.io")!, session: MazleAuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func state() async throws -> AdventureStateResponse {
        try await request(path: ["api", "adventure", "state"])
    }

    func start(levelId: Int, catalogVersion: String, idempotencyKey: UUID) async throws -> AdventureStartResponse {
        try await request(
            path: ["api", "adventure", "start"],
            body: AdventureStartPayload(
                levelId: levelId,
                catalogVersion: catalogVersion,
                idempotencyKey: idempotencyKey
            )
        )
    }

    func complete(
        attemptId: UUID,
        moves: Int,
        timeMs: Int,
        catalogVersion: String,
        idempotencyKey: UUID
    ) async throws -> AdventureCompleteResponse {
        try await request(
            path: ["api", "adventure", "complete"],
            body: AdventureCompletePayload(
                attemptId: attemptId,
                moves: moves,
                timeMs: timeMs,
                catalogVersion: catalogVersion,
                idempotencyKey: idempotencyKey
            )
        )
    }

    func fail(
        attemptId: UUID,
        moves: Int,
        timeMs: Int,
        outcome: AdventureAttemptOutcome,
        idempotencyKey: UUID
    ) async throws -> AdventureFailResponse {
        try await request(
            path: ["api", "adventure", "fail"],
            body: AdventureFailPayload(
                attemptId: attemptId,
                moves: moves,
                timeMs: timeMs,
                outcome: outcome,
                idempotencyKey: idempotencyKey
            )
        )
    }

    func sync(progress: AdventureProgress, idempotencyKey: UUID) async throws -> AdventureStateResponse {
        let levels = progress.levelResults.values
            .sorted { $0.levelId < $1.levelId }
            .map {
                AdventureSyncLevelPayload(
                    levelId: $0.levelId,
                    bestMoves: $0.bestMoves,
                    bestTimeMs: $0.bestTimeMs,
                    completedAt: $0.completedAt
                )
            }
        return try await request(
            path: ["api", "adventure", "sync"],
            body: AdventureSyncPayload(
                catalogVersion: progress.catalogVersion,
                idempotencyKey: idempotencyKey,
                levels: levels
            )
        )
    }

    func useRefill(source: AdventureRefillSource, idempotencyKey: UUID) async throws -> AdventureRefillResponse {
        try await request(
            path: ["api", "adventure", "refills", "use"],
            body: AdventureRefillPayload(source: source, idempotencyKey: idempotencyKey)
        )
    }

    func grantAppleRefill(signedTransaction: String) async throws -> AdventureRefillResponse {
        try await request(
            path: ["api", "adventure", "refills", "apple"],
            body: AdventureAppleRefillPayload(signedTransaction: signedTransaction)
        )
    }

    private func request<Response: Decodable>(path: [String]) async throws -> Response {
        try await perform(path: path, body: Optional<Int>.none)
    }

    private func request<Response: Decodable, Body: Encodable>(path: [String], body: Body) async throws -> Response {
        try await perform(path: path, body: body)
    }

    private func perform<Response: Decodable, Body: Encodable>(path: [String], body: Body?) async throws -> Response {
        var url = baseURL
        for component in path {
            url.appendPathComponent(component)
        }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try Self.encoder.encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AdventureServiceError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONDecoder().decode(AdventureServerErrorBody.self, from: data)
            throw AdventureServiceError.httpStatus(
                status: http.statusCode,
                code: body?.errorCode,
                message: body?.message
            )
        }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw AdventureServiceError.decoding
        }
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            let standard = ISO8601DateFormatter()
            standard.formatOptions = [.withInternetDateTime]
            if let date = standard.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Invalid ISO-8601 date"
            )
        }
        return decoder
    }()
}

struct AdventureServerErrorBody: Decodable, Equatable {
    let errorCode: String?
    let message: String?
}
