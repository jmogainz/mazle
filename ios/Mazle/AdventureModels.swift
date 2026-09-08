import Foundation

enum AdventureDifficulty: String, Codable, CaseIterable, Sendable {
    case tutorial
    case easy
    case normal
    case hard
    case superHard = "super-hard"

    var label: String {
        switch self {
        case .tutorial: return "Tutorial"
        case .easy: return "Easy"
        case .normal: return "Normal"
        case .hard: return "Hard"
        case .superHard: return "Super Hard"
        }
    }
}

enum AdventureMechanic: String, Codable, CaseIterable, Sendable {
    case ground
    case ice
    case ledge

    var label: String {
        switch self {
        case .ground: return "Step tiles"
        case .ice: return "Ice slides"
        case .ledge: return "One-way ledges"
        }
    }

    var systemImage: String {
        switch self {
        case .ground: return "figure.walk"
        case .ice: return "snowflake"
        case .ledge: return "arrowshape.right.fill"
        }
    }
}

struct AdventureStarThresholds: Codable, Equatable, Sendable {
    let three: Int
    let two: Int
    let one: Int

    func stars(for moves: Int) -> Int {
        guard moves <= one else { return 0 }
        if moves <= three { return 3 }
        if moves <= two { return 2 }
        return 1
    }
}

struct AdventureChapter: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let index: Int
    let title: String
    let subtitle: String

    private enum CodingKeys: String, CodingKey {
        case id
        case index
        case title
        case subtitle
    }

    init(id: String, index: Int, title: String, subtitle: String) {
        self.id = id
        self.index = index
        self.title = title
        self.subtitle = subtitle
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        index = try container.decode(Int.self, forKey: .index)
        title = try container.decode(String.self, forKey: .title)
        subtitle = try container.decodeIfPresent(String.self, forKey: .subtitle) ?? ""
    }
}

struct AdventureLevel: Decodable, Equatable, Identifiable, Sendable {
    let id: Int
    let key: String
    let chapterId: String
    let chapterIndex: Int
    let levelInChapter: Int
    let title: String
    let difficulty: AdventureDifficulty
    let seed: String
    let width: Int
    let height: Int
    let tiles: [[TileType]]
    let start: GridPosition
    let goal: GridPosition
    let mechanics: [AdventureMechanic]
    let optimalMoves: Int
    let solution: [Direction]
    let solutionStops: [GridPosition]
    let moveLimit: Int
    let thresholds: AdventureStarThresholds

    var puzzle: Puzzle {
        Puzzle(
            width: width,
            height: height,
            tiles: tiles,
            start: start,
            goal: goal,
            optimalMoves: optimalMoves,
            solutionPath: solutionStops,
            difficultyScore: nil
        )
    }

    var isProtectedFromEnergyLoss: Bool { id <= 5 }

    private enum CodingKeys: String, CodingKey {
        case id
        case key
        case chapterId
        case chapterIndex
        case levelInChapter
        case title
        case difficulty
        case seed
        case rows
        case mechanics
        case optimalMoves
        case solution
        case moveLimit
        case starThresholds
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        key = try container.decode(String.self, forKey: .key)
        chapterId = try container.decode(String.self, forKey: .chapterId)
        chapterIndex = try container.decode(Int.self, forKey: .chapterIndex)
        levelInChapter = try container.decode(Int.self, forKey: .levelInChapter)
        title = try container.decode(String.self, forKey: .title)
        difficulty = try container.decode(AdventureDifficulty.self, forKey: .difficulty)
        seed = try container.decode(String.self, forKey: .seed)
        mechanics = try container.decode([AdventureMechanic].self, forKey: .mechanics)
        optimalMoves = try container.decode(Int.self, forKey: .optimalMoves)
        moveLimit = try container.decode(Int.self, forKey: .moveLimit)
        thresholds = try container.decode(AdventureStarThresholds.self, forKey: .starThresholds)

        let rows = try container.decode([String].self, forKey: .rows)
        height = rows.count
        width = rows.first?.count ?? 0
        var parsedTiles: [[TileType]] = []
        var parsedStart: GridPosition?
        var parsedGoal: GridPosition?
        for (y, row) in rows.enumerated() {
            let characters = Array(row)
            guard characters.count == width else {
                throw AdventureCatalogError.malformed("level \(id) contains rows with different widths")
            }
            var tileRow: [TileType] = []
            for (x, character) in characters.enumerated() {
                let tile: TileType
                switch character {
                case "#": tile = .wall
                case ".": tile = .ground
                case "S":
                    tile = .start
                    parsedStart = GridPosition(x: x, y: y)
                case "G":
                    tile = .goal
                    parsedGoal = GridPosition(x: x, y: y)
                case "~": tile = .ice
                case "^": tile = .ledgeUp
                case "v": tile = .ledgeDown
                case "<": tile = .ledgeLeft
                case ">": tile = .ledgeRight
                default:
                    throw AdventureCatalogError.malformed("level \(id) contains unknown tile '\(character)'")
                }
                tileRow.append(tile)
            }
            parsedTiles.append(tileRow)
        }
        guard let parsedStart, let parsedGoal else {
            throw AdventureCatalogError.malformed("level \(id) must contain one start and one goal")
        }
        tiles = parsedTiles
        start = parsedStart
        goal = parsedGoal

        let rawSolution = try container.decode(String.self, forKey: .solution)
        let decodedLevelID = id
        solution = try rawSolution.map { character in
            switch character {
            case "U": return .up
            case "D": return .down
            case "L": return .left
            case "R": return .right
            default:
                throw AdventureCatalogError.malformed("level \(decodedLevelID) contains unknown solution move '\(character)'")
            }
        }

        let localPuzzle = Puzzle(
            width: width,
            height: height,
            tiles: tiles,
            start: start,
            goal: goal,
            optimalMoves: optimalMoves,
            solutionPath: nil
        )
        var current = start
        var stops: [GridPosition] = [start]
        for direction in solution {
            let result = MazeEngine.simulateMove(from: current, direction: direction, in: localPuzzle)
            guard result.valid else {
                throw AdventureCatalogError.malformed("level \(id) contains an invalid solution move")
            }
            current = result.position
            stops.append(current)
        }
        solutionStops = stops
    }
}

struct AdventureCatalog: Decodable, Equatable, Sendable {
    let schemaVersion: Int
    let contentVersion: String
    let chapters: [AdventureChapter]
    let levels: [AdventureLevel]

    func level(id: Int) -> AdventureLevel? {
        levels.first { $0.id == id }
    }

    func levels(in chapter: AdventureChapter) -> [AdventureLevel] {
        levels.filter { $0.chapterId == chapter.id }.sorted { $0.id < $1.id }
    }
}

enum AdventureCatalogError: LocalizedError, Equatable {
    case missingResource
    case unsupportedSchema(Int)
    case malformed(String)

    var errorDescription: String? {
        switch self {
        case .missingResource:
            return "Adventure levels are missing from this build."
        case .unsupportedSchema(let version):
            return "Adventure level format \(version) is not supported."
        case .malformed(let reason):
            return "Adventure levels could not be loaded: \(reason)"
        }
    }
}

enum AdventureCatalogLoader {
    static let resourceName = "adventure-levels-v1"

    static func load(bundle: Bundle = .main) throws -> AdventureCatalog {
        guard let url = bundle.url(forResource: resourceName, withExtension: "json") else {
            throw AdventureCatalogError.missingResource
        }
        do {
            let data = try Data(contentsOf: url)
            let catalog = try JSONDecoder().decode(AdventureCatalog.self, from: data)
            guard catalog.schemaVersion == 1 else {
                throw AdventureCatalogError.unsupportedSchema(catalog.schemaVersion)
            }
            try AdventureCatalogValidator.validate(catalog)
            return catalog
        } catch let error as AdventureCatalogError {
            throw error
        } catch {
            throw AdventureCatalogError.malformed(error.localizedDescription)
        }
    }
}

enum AdventureCatalogValidator {
    static func validate(_ catalog: AdventureCatalog) throws {
        guard catalog.levels.count == 50 else {
            throw AdventureCatalogError.malformed("expected 50 levels, found \(catalog.levels.count)")
        }
        guard catalog.chapters.count == 5 else {
            throw AdventureCatalogError.malformed("expected 5 chapters, found \(catalog.chapters.count)")
        }
        guard catalog.levels.map(\.id).sorted() == Array(1...50) else {
            throw AdventureCatalogError.malformed("level IDs must be contiguous from 1 through 50")
        }

        for level in catalog.levels {
            guard level.width > 0,
                  level.height > 0,
                  level.tiles.count == level.height,
                  level.tiles.allSatisfy({ $0.count == level.width }) else {
                throw AdventureCatalogError.malformed("level \(level.id) has invalid dimensions")
            }
            guard level.thresholds.three == level.optimalMoves,
                  level.thresholds.three <= level.thresholds.two,
                  level.thresholds.two <= level.thresholds.one,
                  level.thresholds.one == level.moveLimit else {
                throw AdventureCatalogError.malformed("level \(level.id) has invalid star thresholds")
            }
            guard level.solution.count == level.optimalMoves,
                  level.solutionStops.count == level.optimalMoves + 1 else {
                throw AdventureCatalogError.malformed("level \(level.id) solution does not match optimal moves")
            }

            var position = level.start
            for (index, direction) in level.solution.enumerated() {
                let result = MazeEngine.simulateMove(from: position, direction: direction, in: level.puzzle)
                guard result.valid else {
                    throw AdventureCatalogError.malformed("level \(level.id) has an invalid solution move at \(index + 1)")
                }
                position = result.position
                guard position == level.solutionStops[index + 1] else {
                    throw AdventureCatalogError.malformed("level \(level.id) solution stop \(index + 1) is incorrect")
                }
            }
            guard position == level.goal else {
                throw AdventureCatalogError.malformed("level \(level.id) solution does not reach the goal")
            }
        }
    }
}

struct AdventureLevelResult: Codable, Equatable, Identifiable, Sendable {
    let levelId: Int
    var stars: Int
    var bestMoves: Int
    var bestTimeMs: Int
    var completedAt: Date

    var id: Int { levelId }

    mutating func merge(_ other: AdventureLevelResult) {
        stars = max(stars, other.stars)
        bestMoves = min(bestMoves, other.bestMoves)
        bestTimeMs = min(bestTimeMs, other.bestTimeMs)
        completedAt = min(completedAt, other.completedAt)
    }
}

struct AdventureProgress: Codable, Equatable, Sendable {
    var catalogVersion: String
    var highestUnlockedLevel: Int
    var levelResults: [Int: AdventureLevelResult]

    static func fresh(catalogVersion: String) -> Self {
        Self(catalogVersion: catalogVersion, highestUnlockedLevel: 1, levelResults: [:])
    }

    var totalStars: Int { levelResults.values.reduce(0) { $0 + $1.stars } }
    var completedLevels: Int { levelResults.count }

    mutating func record(_ result: AdventureLevelResult, maximumLevel: Int) {
        if var existing = levelResults[result.levelId] {
            existing.merge(result)
            levelResults[result.levelId] = existing
        } else {
            levelResults[result.levelId] = result
        }
        highestUnlockedLevel = min(maximumLevel, max(highestUnlockedLevel, result.levelId + 1))
    }

    mutating func merge(_ other: AdventureProgress, maximumLevel: Int) {
        for result in other.levelResults.values {
            record(result, maximumLevel: maximumLevel)
        }
        highestUnlockedLevel = min(maximumLevel, max(highestUnlockedLevel, other.highestUnlockedLevel))
    }
}

struct AdventureEnergy: Codable, Equatable, Sendable {
    static let baseMaximumHearts = 3
    static let regenerationInterval: TimeInterval = 30 * 60

    var hearts: Int
    var maximumHearts: Int
    var nextHeartAt: Date?
    var refillTickets: Int

    init(
        hearts: Int,
        maximumHearts: Int = baseMaximumHearts,
        nextHeartAt: Date?,
        refillTickets: Int
    ) {
        self.hearts = hearts
        self.maximumHearts = max(Self.baseMaximumHearts, maximumHearts)
        self.nextHeartAt = nextHeartAt
        self.refillTickets = refillTickets
    }

    static let full = Self(
        hearts: baseMaximumHearts,
        maximumHearts: baseMaximumHearts,
        nextHeartAt: nil,
        refillTickets: 0
    )

    mutating func refresh(at now: Date) {
        maximumHearts = max(Self.baseMaximumHearts, maximumHearts)
        hearts = min(max(0, hearts), maximumHearts)
        refillTickets = max(0, refillTickets)

        guard hearts < maximumHearts else {
            nextHeartAt = nil
            return
        }
        guard var next = nextHeartAt else {
            nextHeartAt = now.addingTimeInterval(Self.regenerationInterval)
            return
        }
        while hearts < maximumHearts, next <= now {
            hearts += 1
            next = next.addingTimeInterval(Self.regenerationInterval)
        }
        nextHeartAt = hearts < maximumHearts ? next : nil
    }

    @discardableResult
    mutating func consume(at now: Date) -> Bool {
        refresh(at: now)
        guard hearts > 0 else { return false }
        let wasFull = hearts == maximumHearts
        hearts -= 1
        if wasFull || nextHeartAt == nil {
            nextHeartAt = now.addingTimeInterval(Self.regenerationInterval)
        }
        return true
    }

    @discardableResult
    mutating func useRefillTicket() -> Bool {
        guard refillTickets > 0, hearts < maximumHearts else { return false }
        refillTickets -= 1
        hearts = maximumHearts
        nextHeartAt = nil
        return true
    }

    mutating func grantTickets(_ count: Int) {
        refillTickets = max(0, refillTickets + max(0, count))
    }
}

struct AdventureAttemptSnapshot: Codable, Equatable, Sendable {
    let attemptId: UUID
    let catalogVersion: String
    let levelId: Int
    let position: GridPosition
    let moves: Int
    let startedAt: Date
    let serverAuthorized: Bool
}

struct AdventureLocalState: Codable, Equatable, Sendable {
    var progress: AdventureProgress
    var energy: AdventureEnergy
    var activeAttempt: AdventureAttemptSnapshot?
    var processedStoreTransactionIDs: Set<UInt64>
    var rejectedStoreTransactionIDs: Set<UInt64>
    var pendingCompletions: [AdventurePendingCompletion]
    var pendingAppleGrants: [AdventurePendingAppleGrant]

    init(
        progress: AdventureProgress,
        energy: AdventureEnergy,
        activeAttempt: AdventureAttemptSnapshot?,
        processedStoreTransactionIDs: Set<UInt64>,
        rejectedStoreTransactionIDs: Set<UInt64> = [],
        pendingCompletions: [AdventurePendingCompletion],
        pendingAppleGrants: [AdventurePendingAppleGrant]
    ) {
        self.progress = progress
        self.energy = energy
        self.activeAttempt = activeAttempt
        self.processedStoreTransactionIDs = processedStoreTransactionIDs
        self.rejectedStoreTransactionIDs = rejectedStoreTransactionIDs
        self.pendingCompletions = pendingCompletions
        self.pendingAppleGrants = pendingAppleGrants
    }

    private enum CodingKeys: String, CodingKey {
        case progress
        case energy
        case activeAttempt
        case processedStoreTransactionIDs
        case rejectedStoreTransactionIDs
        case pendingCompletions
        case pendingAppleGrants
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        progress = try container.decode(AdventureProgress.self, forKey: .progress)
        energy = try container.decode(AdventureEnergy.self, forKey: .energy)
        activeAttempt = try container.decodeIfPresent(AdventureAttemptSnapshot.self, forKey: .activeAttempt)
        processedStoreTransactionIDs = try container.decodeIfPresent(
            Set<UInt64>.self,
            forKey: .processedStoreTransactionIDs
        ) ?? []
        rejectedStoreTransactionIDs = try container.decodeIfPresent(
            Set<UInt64>.self,
            forKey: .rejectedStoreTransactionIDs
        ) ?? []
        pendingCompletions = try container.decodeIfPresent(
            [AdventurePendingCompletion].self,
            forKey: .pendingCompletions
        ) ?? []
        pendingAppleGrants = try container.decodeIfPresent(
            [AdventurePendingAppleGrant].self,
            forKey: .pendingAppleGrants
        ) ?? []
    }
}

struct AdventurePendingCompletion: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let levelId: Int
    let attemptId: UUID
    let moves: Int
    let timeMs: Int
    let won: Bool
    let stars: Int
    let catalogVersion: String
    let completedAt: Date
}

struct AdventurePendingAppleGrant: Codable, Equatable, Identifiable, Sendable {
    let id: UInt64
    let signedTransaction: String
}
