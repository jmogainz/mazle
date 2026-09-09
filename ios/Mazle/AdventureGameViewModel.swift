import Foundation
import SwiftUI

struct AdventureMoveAnimation: Equatable, Identifiable, Sendable {
    let id: UUID
    let path: [GridPosition]

    /// A slide stays legible without making long ice runs hold the game hostage.
    /// The view consumes this same value, so input unlock and rendering finish
    /// together for every path length.
    var duration: TimeInterval { Self.duration(forPathCount: path.count) }
    var stepDuration: TimeInterval {
        guard !path.isEmpty else { return 0 }
        return duration / Double(path.count)
    }

    static func duration(forPathCount count: Int) -> TimeInterval {
        guard count > 0 else { return 0 }
        return min(0.45, max(0.12, Double(count) * 0.055))
    }
}

enum AdventurePlayPhase: Equatable {
    case preparing
    case playing
    case won(AdventureLevelResult)
    case failed
}

@MainActor
final class AdventureGameViewModel: ObservableObject {
    let level: AdventureLevel
    let progressStore: AdventureProgressStore

    @Published private(set) var position: GridPosition
    @Published private(set) var moves = 0
    @Published private(set) var phase: AdventurePlayPhase = .preparing
    @Published private(set) var moveAnimation: AdventureMoveAnimation?
    @Published private(set) var isAnimatingMove = false
    @Published var errorMessage: String?

    private var startedAt = Date()
    private var activeMovementID: UUID?
    private var attemptHasSettled = false

    init(level: AdventureLevel, progressStore: AdventureProgressStore) {
        self.level = level
        self.progressStore = progressStore
        position = level.start
    }

    var movesRemaining: Int { max(0, level.moveLimit - moves) }
    var elapsedMilliseconds: Int { max(0, Int(Date().timeIntervalSince(startedAt) * 1000)) }
    var isFinished: Bool {
        switch phase {
        case .won, .failed: return true
        case .preparing, .playing: return false
        }
    }

    func prepare() async {
        guard phase == .preparing else { return }
        do {
            let snapshot = try await progressStore.begin(level)
            position = snapshot.position
            moves = snapshot.moves
            startedAt = snapshot.startedAt
            attemptHasSettled = false

            // A process can be suspended after the logical move is persisted
            // but before its animation settles. Resume terminal attempts here
            // so they cannot remain indefinitely in the playing state.
            if snapshot.position == level.goal {
                attemptHasSettled = true
                let result = await progressStore.complete(
                    level: level,
                    moves: snapshot.moves,
                    timeMs: max(0, Int(Date().timeIntervalSince(snapshot.startedAt) * 1000))
                )
                guard !Task.isCancelled else { return }
                phase = .won(result)
                AdventureFeedback.shared.play(.win)
                return
            }
            if snapshot.moves >= level.moveLimit {
                attemptHasSettled = true
                _ = await progressStore.failActiveAttempt(
                    level: level,
                    moves: snapshot.moves,
                    timeMs: max(0, Int(Date().timeIntervalSince(snapshot.startedAt) * 1000)),
                    outcome: .failed
                )
                guard !Task.isCancelled else { return }
                phase = .failed
                AdventureFeedback.shared.play(.fail)
                return
            }
            phase = .playing
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func move(_ direction: Direction) async {
        guard phase == .playing, !isAnimatingMove, !attemptHasSettled else { return }
        let result = MazeEngine.simulateMove(from: position, direction: direction, in: level.puzzle)
        guard result.valid else {
            AdventureFeedback.shared.play(.bump)
            return
        }

        isAnimatingMove = true
        let movementID = UUID()
        activeMovementID = movementID
        let animation = AdventureMoveAnimation(id: movementID, path: result.path)
        moveAnimation = animation
        position = result.position
        moves += 1
        AdventureFeedback.shared.play(result.path.count > 1 ? .slide : .step)
        // Persist the logical move before its visual delay. If the scene is
        // interrupted mid-slide, the attempt still resumes at the right tile.
        progressStore.updateActiveAttempt(position: position, moves: moves)

        do {
            try await Task.sleep(nanoseconds: UInt64(animation.duration * 1_000_000_000))
        } catch {
            if activeMovementID == movementID { cancelMovement() }
            return
        }
        guard !Task.isCancelled, activeMovementID == movementID else {
            if activeMovementID == movementID { cancelMovement() }
            return
        }

        // Clear the animation before settlement. A second callback can now only
        // observe the terminal attempt state, never complete it a second time.
        moveAnimation = nil

        if position == level.goal {
            attemptHasSettled = true
            let finalResult = await progressStore.complete(
                level: level,
                moves: moves,
                timeMs: elapsedMilliseconds
            )
            guard !Task.isCancelled, activeMovementID == movementID else {
                if activeMovementID == movementID { cancelMovement() }
                return
            }
            activeMovementID = nil
            isAnimatingMove = false
            phase = .won(finalResult)
            AdventureFeedback.shared.play(.win)
        } else if moves >= level.moveLimit {
            attemptHasSettled = true
            _ = await progressStore.failActiveAttempt(
                level: level,
                moves: moves,
                timeMs: elapsedMilliseconds,
                outcome: .failed
            )
            guard !Task.isCancelled, activeMovementID == movementID else {
                if activeMovementID == movementID { cancelMovement() }
                return
            }
            activeMovementID = nil
            isAnimatingMove = false
            phase = .failed
            AdventureFeedback.shared.play(.fail)
        } else {
            activeMovementID = nil
            isAnimatingMove = false
            progressStore.updateActiveAttempt(position: position, moves: moves)
        }
    }

    func handleSwipe(_ translation: CGSize) async {
        guard max(abs(translation.width), abs(translation.height)) >= 18 else { return }
        if abs(translation.width) > abs(translation.height) {
            await move(translation.width > 0 ? .right : .left)
        } else {
            await move(translation.height > 0 ? .down : .up)
        }
    }

    func restart() async {
        cancelMovement()
        if phase == .playing, !attemptHasSettled {
            attemptHasSettled = true
            _ = await progressStore.failActiveAttempt(
                level: level,
                moves: moves,
                timeMs: elapsedMilliseconds,
                outcome: .abandoned
            )
        }
        position = level.start
        moves = 0
        phase = .preparing
        moveAnimation = nil
        await prepare()
    }

    /// Invalidates an in-flight animation. The logical move is already known,
    /// but no completion/failure callback may run after this point.
    func cancelMovement() {
        activeMovementID = nil
        moveAnimation = nil
        isAnimatingMove = false
    }

    func abandon() async {
        cancelMovement()
        guard phase == .playing, !attemptHasSettled else { return }
        attemptHasSettled = true
        _ = await progressStore.failActiveAttempt(
            level: level,
            moves: moves,
            timeMs: elapsedMilliseconds,
            outcome: .abandoned
        )
    }
}
