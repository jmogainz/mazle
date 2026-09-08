import Foundation
import SwiftUI

struct AdventureMoveAnimation: Equatable, Identifiable, Sendable {
    let id: UUID
    let path: [GridPosition]
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
            phase = .playing
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func move(_ direction: Direction) async {
        guard phase == .playing, !isAnimatingMove else { return }
        let result = MazeEngine.simulateMove(from: position, direction: direction, in: level.puzzle)
        guard result.valid else {
            MazleHaptics.shared.bump()
            return
        }

        isAnimatingMove = true
        moveAnimation = AdventureMoveAnimation(id: UUID(), path: result.path)
        position = result.position
        moves += 1
        MazleHaptics.shared.move(sliding: result.path.count > 1)

        let animationNanoseconds = UInt64(max(1, min(result.path.count, 8))) * 72_000_000
        try? await Task.sleep(nanoseconds: animationNanoseconds)

        if position == level.goal {
            let finalResult = await progressStore.complete(
                level: level,
                moves: moves,
                timeMs: elapsedMilliseconds
            )
            phase = .won(finalResult)
            MazleHaptics.shared.success()
        } else if moves >= level.moveLimit {
            _ = await progressStore.failActiveAttempt(
                level: level,
                moves: moves,
                timeMs: elapsedMilliseconds,
                outcome: .failed
            )
            phase = .failed
            MazleHaptics.shared.failure()
        } else {
            progressStore.updateActiveAttempt(position: position, moves: moves)
        }
        isAnimatingMove = false
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
        guard !isAnimatingMove else { return }
        if phase == .playing {
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

    func abandon() async {
        guard phase == .playing else { return }
        _ = await progressStore.failActiveAttempt(
            level: level,
            moves: moves,
            timeMs: elapsedMilliseconds,
            outcome: .abandoned
        )
    }
}
