import Combine
import Foundation
import SwiftUI

@MainActor
final class GameViewModel: ObservableObject {
    static let maxLives = 5
    static let penaltySecondsPerLife = 30

    let service: DailyPuzzleService

    @Published private(set) var puzzle: Puzzle?
    @Published private(set) var dailyDate = DailyDate.todayString()
    @Published private(set) var puzzleNumber = DailyDate.puzzleNumber(for: DailyDate.todayString())
    @Published private(set) var position = GridPosition(x: 0, y: 0)
    @Published private(set) var totalMoves = 0
    @Published private(set) var currentAttemptMoves = 0
    @Published private(set) var lives = GameViewModel.maxLives
    @Published private(set) var penaltySeconds = 0
    @Published private(set) var attempts: [AttemptRecord] = []
    private(set) var currentAttemptPath: [GridPosition] = []
    @Published private(set) var completed = false
    @Published private(set) var won = false
    @Published private(set) var isLoading = false
    @Published private(set) var isUsingCachedPuzzle = false
    @Published var errorMessage: String?
    @Published var statusMessage: String?

    private(set) var startedAt: Date?
    private(set) var finishedAt: Date?
    private var loadedDate: String?
    private var didSyncCompletedResult = false

    init(service: DailyPuzzleService = .live) {
        self.service = service
    }

    var elapsedSeconds: Int {
        guard let startedAt else { return 0 }
        let end = finishedAt ?? Date()
        return max(0, Int(end.timeIntervalSince(startedAt))) + penaltySeconds
    }

    var attemptsUsed: Int {
        if completed {
            return won ? attempts.count + 1 : attempts.count
        }
        return attempts.count + 1
    }

    var shareText: String {
        let mapKind: ResultShareMapKind =
            puzzle?.tiles.flatMap { $0 }.contains(.ice) == true ? .ice : .ground
        return ResultShareFormatter.text(
            puzzleNumber: puzzleNumber,
            formattedTime: formattedElapsedTime,
            optimalMoves: puzzle?.optimalMoves ?? 10,
            attempts: attempts,
            won: won,
            mapKind: mapKind,
            maxLives: Self.maxLives
        )
    }

    var formattedElapsedTime: String {
        let minutes = elapsedSeconds / 60
        let seconds = elapsedSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    func loadToday() async {
        await load(date: DailyDate.todayString())
    }

    func load(date requestedDate: String) async {
        if loadedDate == requestedDate, puzzle != nil { return }

        isLoading = true
        errorMessage = nil
        statusMessage = nil
        defer { isLoading = false }

        do {
            let response = try await service.fetch(date: requestedDate)
            guard let puzzle = response.puzzle else { throw DailyPuzzleServiceError.missingPuzzle }
            install(puzzle: puzzle, date: response.date, puzzleNumber: response.puzzleNumber)
            isUsingCachedPuzzle = false
        } catch {
            if let cachedPuzzle = LocalCache.loadPuzzle(date: requestedDate) {
                install(puzzle: cachedPuzzle, date: requestedDate, puzzleNumber: DailyDate.puzzleNumber(for: requestedDate))
                isUsingCachedPuzzle = true
                statusMessage = requestedDate == DailyDate.todayString()
                    ? "Offline mode — showing the cached daily puzzle."
                    : "Offline mode — showing the cached archive puzzle."
            } else {
                errorMessage = requestedDate == DailyDate.todayString()
                    ? "Could not load today's puzzle. Check your connection and try again."
                    : "This day is locked. Unlock the archive to play past puzzles."
            }
        }
    }

    func beginPlaying() {
        guard !completed, startedAt == nil else { return }
        startedAt = Date()
        if currentAttemptPath.isEmpty {
            currentAttemptPath = [position]
        }
        persistSnapshot()
    }

    func move(_ direction: Direction) {
        guard let puzzle, !completed else { return }

        let result = MazeEngine.simulateMove(from: position, direction: direction, in: puzzle)
        guard result.valid else {
            MazleHaptics.shared.bump()
            return
        }

        position = result.position
        totalMoves += 1
        currentAttemptMoves += 1
        if currentAttemptPath.isEmpty {
            currentAttemptPath = [puzzle.start]
        }
        currentAttemptPath.append(result.position)
        MazleHaptics.shared.move(sliding: result.path.count > 1)

        if position == puzzle.goal {
            completed = true
            won = true
            finishedAt = Date()
            MazleHaptics.shared.success()
            persistSnapshot()
            return
        }

        // This mirrors GameScene.updateGameStateAndCheckLives(): reaching the
        // optimal move budget without the goal consumes one life.
        if currentAttemptMoves >= max(1, puzzle.optimalMoves) {
            loseLife(at: position)
        } else {
            persistSnapshot()
        }
    }

    func handleSwipe(_ translation: CGSize) {
        guard max(abs(translation.width), abs(translation.height)) >= 18 else { return }
        if abs(translation.width) > abs(translation.height) {
            move(translation.width > 0 ? .right : .left)
        } else {
            move(translation.height > 0 ? .down : .up)
        }
    }

    func resetForReplay() {
        guard let puzzle else { return }
        LocalCache.removeSnapshot(date: dailyDate)
        position = puzzle.start
        totalMoves = 0
        currentAttemptMoves = 0
        currentAttemptPath = [puzzle.start]
        lives = Self.maxLives
        penaltySeconds = 0
        attempts = []
        completed = false
        won = false
        startedAt = nil
        finishedAt = nil
        didSyncCompletedResult = false
        statusMessage = nil
    }

    func enableDailyReminder() {
        Task {
            do {
                try await ReminderManager.scheduleDailyReminder()
                statusMessage = "Daily reminder scheduled for 9:00 AM."
            } catch {
                statusMessage = error.localizedDescription
            }
        }
    }

    private func install(puzzle: Puzzle, date: String, puzzleNumber: Int?) {
        self.puzzle = puzzle
        dailyDate = date
        self.puzzleNumber = puzzleNumber ?? DailyDate.puzzleNumber(for: date)
        loadedDate = date
        LocalCache.savePuzzle(puzzle, date: date)

        if let snapshot = LocalCache.loadSnapshot(date: date) {
            restore(snapshot)
        } else {
            resetState(for: puzzle)
        }
    }

    #if DEBUG
    /// Test-only seam: install a puzzle and reset state without touching the network
    /// or the local cache, so unit tests can drive the life-loss contract directly.
    func installForTesting(puzzle: Puzzle, date: String, puzzleNumber: Int?) {
        self.puzzle = puzzle
        dailyDate = date
        self.puzzleNumber = puzzleNumber ?? DailyDate.puzzleNumber(for: date)
        loadedDate = date
        resetState(for: puzzle)
    }
    #endif

    private func resetState(for puzzle: Puzzle) {
        position = puzzle.start
        totalMoves = 0
        currentAttemptMoves = 0
        currentAttemptPath = [puzzle.start]
        lives = Self.maxLives
        penaltySeconds = 0
        attempts = []
        completed = false
        won = false
        startedAt = nil
        finishedAt = nil
        didSyncCompletedResult = false
    }

    private func restore(_ snapshot: GameSnapshot) {
        position = snapshot.position
        totalMoves = snapshot.totalMoves
        currentAttemptMoves = snapshot.currentAttemptMoves
        lives = snapshot.lives
        penaltySeconds = snapshot.penaltySeconds
        attempts = snapshot.attempts
        currentAttemptPath = snapshot.currentAttemptPath ?? fallbackAttemptPath(for: snapshot.position)
        completed = snapshot.completed
        won = snapshot.won
        startedAt = snapshot.startedAt
        finishedAt = snapshot.completed ? snapshot.startedAt.map { $0.addingTimeInterval(TimeInterval(elapsedSeconds)) } : nil
        didSyncCompletedResult = false
    }

    private func fallbackAttemptPath(for position: GridPosition) -> [GridPosition] {
        guard let start = puzzle?.start else { return [position] }
        return start == position ? [start] : [start, position]
    }

    private func loseLife(at finalPosition: GridPosition) {
        lives -= 1
        penaltySeconds += Self.penaltySecondsPerLife
        attempts.append(
            AttemptRecord(
                moveCount: currentAttemptMoves,
                path: currentAttemptPath,
                failedAt: finalPosition
            )
        )

        if lives <= 0 {
            completed = true
            won = false
            finishedAt = Date()
            MazleHaptics.shared.failure()
        } else {
            position = puzzle?.start ?? position
            currentAttemptMoves = 0
            if let start = puzzle?.start {
                currentAttemptPath = [start]
            }
            MazleHaptics.shared.lifeLost()
        }
        persistSnapshot()
    }

    private func persistSnapshot() {
        let snapshot = GameSnapshot(
            date: dailyDate,
            position: position,
            totalMoves: totalMoves,
            currentAttemptMoves: currentAttemptMoves,
            lives: lives,
            penaltySeconds: penaltySeconds,
            startedAt: startedAt,
            completed: completed,
            won: won,
            attempts: attempts,
            currentAttemptPath: currentAttemptPath
        )
        LocalCache.saveSnapshot(snapshot)

        if completed {
            LocalHistoryStore.record(
                LocalHistoryEntry(
                    date: dailyDate,
                    puzzleNumber: puzzleNumber,
                    completed: true,
                    won: won,
                    timeSeconds: won ? elapsedSeconds : nil,
                    attemptsUsed: attemptsUsed,
                    totalMoves: totalMoves
                )
            )
            syncCompletedResultIfNeeded()
        }
    }

    private func syncCompletedResultIfNeeded() {
        guard !MazleRuntimeConfiguration.isOfflineMode else { return }
        guard completed, !didSyncCompletedResult else { return }
        guard let session = MazleSessionStore.shared.session, !session.isExpired else { return }

        didSyncCompletedResult = true
        let service = AuthenticatedMazleService(session: session)
        let resultAttempts = attempts.map(AuthenticatedResultAttempt.init)
        let attemptScores = attempts.map(\.moveCount) + (won ? [currentAttemptMoves] : [])
        let recent = (DailyDate.daysBetween(dailyDate, and: DailyDate.todayString()) ?? 0) >= 2
        let resultDate = dailyDate
        let resultTimeMs = elapsedSeconds * 1000
        let resultAttemptsUsed = attemptsUsed
        let resultWon = won
        let shouldSubmitLeaderboard = UserDefaults.standard.bool(forKey: "mazle.leaderboardAutoSubmit")

        Task { @MainActor [weak self] in
            do {
                _ = try await service.recordResult(
                    date: resultDate,
                    completed: true,
                    timeMs: resultTimeMs,
                    attemptsUsed: resultAttemptsUsed,
                    attemptScores: attemptScores,
                    attempts: resultAttempts,
                    isRecent: recent
                )
                if shouldSubmitLeaderboard && !recent && resultWon {
                    _ = try await service.leaderboardSubmit(date: resultDate)
                }
                self?.statusMessage = "Result synced to your account."
            } catch {
                self?.didSyncCompletedResult = false
                self?.statusMessage = "Result saved locally; account sync will retry when connected."
            }
        }
    }
}
