import UIKit

@MainActor
final class MazleHaptics {
    static let shared = MazleHaptics()

    private init() {}

    func move(sliding: Bool) {
        let generator = UIImpactFeedbackGenerator(style: sliding ? .medium : .light)
        generator.prepare()
        generator.impactOccurred()
    }

    func bump() {
        let generator = UIImpactFeedbackGenerator(style: .rigid)
        generator.prepare()
        generator.impactOccurred(intensity: 0.7)
    }

    func confirm() {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        generator.impactOccurred(intensity: 0.45)
    }

    func lifeLost() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.warning)
    }

    func success() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
    }

    func failure() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.error)
    }
}
