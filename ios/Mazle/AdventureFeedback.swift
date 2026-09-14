import AVFoundation
import Combine
import UIKit

/// Short, local-only feedback for Adventure. Ambient audio deliberately obeys the
/// silent switch and is never configured as background audio.
@MainActor
final class AdventureFeedback: NSObject, ObservableObject {
    enum Cue: Hashable, Sendable {
        case step
        case slide
        case bump
        case win
        case fail
        case star
    }

    static let shared = AdventureFeedback()

    private static let soundKey = "mazle.adventure.feedback.sound-enabled.v1"
    private static let hapticsKey = "mazle.adventure.feedback.haptics-enabled.v1"

    @Published var soundEnabled: Bool {
        didSet {
            defaults.set(soundEnabled, forKey: Self.soundKey)
            if !soundEnabled { stopAudio() }
        }
    }

    @Published var hapticsEnabled: Bool {
        didSet { defaults.set(hapticsEnabled, forKey: Self.hapticsKey) }
    }

    private let defaults: UserDefaults
    private var player: AVAudioPlayer?
    private var isInterrupted = false
    private var isApplicationActive = UIApplication.shared.applicationState == .active
    private var sessionConfigured = false
    private var cueData: [Cue: Data] = [:]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        soundEnabled = defaults.object(forKey: Self.soundKey) as? Bool ?? true
        hapticsEnabled = defaults.object(forKey: Self.hapticsKey) as? Bool ?? true
        super.init()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleApplicationBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleApplicationBackground),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleApplicationActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func play(_ cue: Cue) {
        guard isApplicationActive else { return }
        switch cue {
        case .step: haptic(.move(sliding: false)); playTone(for: .step, frequencies: [520], duration: 0.055, volume: 0.20)
        case .slide: haptic(.move(sliding: true)); playTone(for: .slide, frequencies: [330, 440], duration: 0.12, volume: 0.22)
        case .bump: haptic(.bump); playTone(for: .bump, frequencies: [135], duration: 0.075, volume: 0.18)
        case .win: haptic(.success); playTone(for: .win, frequencies: [523, 659, 784], duration: 0.24, volume: 0.24)
        case .fail: haptic(.failure); playTone(for: .fail, frequencies: [240, 180], duration: 0.20, volume: 0.20)
        case .star: haptic(.confirm); playTone(for: .star, frequencies: [784, 988], duration: 0.11, volume: 0.20)
        }
    }

    private func haptic(_ action: HapticAction) {
        guard hapticsEnabled else { return }
        switch action {
        case .move(let sliding): MazleHaptics.shared.move(sliding: sliding)
        case .bump: MazleHaptics.shared.bump()
        case .confirm: MazleHaptics.shared.confirm()
        case .success: MazleHaptics.shared.success()
        case .failure: MazleHaptics.shared.failure()
        }
    }

    private func playTone(for cue: Cue, frequencies: [Double], duration: Double, volume: Float) {
        guard soundEnabled, !isInterrupted, isApplicationActive else { return }

        do {
            let session = AVAudioSession.sharedInstance()
            // .ambient follows the hardware silent switch and does not claim
            // background playback. This is intentionally not .playback.
            if !sessionConfigured {
                try session.setCategory(.ambient, mode: .default, options: [])
                sessionConfigured = true
            }
            try session.setActive(true, options: [])
            let data = cueData[cue] ?? Self.wavData(frequencies: frequencies, duration: duration)
            cueData[cue] = data
            player?.stop()
            let player = try AVAudioPlayer(data: data)
            player.volume = volume
            player.prepareToPlay()
            player.play()
            self.player = player
        } catch {
            // Feedback is best effort; gameplay must remain usable without audio.
        }
    }

    func stopAudio() {
        player?.stop()
        player = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    @objc private func handleApplicationBackground() {
        isApplicationActive = false
        stopAudio()
    }

    @objc private func handleApplicationActive() {
        isApplicationActive = true
        isInterrupted = false
    }

    @objc private func handleAudioInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let rawType = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
        switch type {
        case .began:
            isInterrupted = true
            player?.stop()
        case .ended:
            isInterrupted = !isApplicationActive
        @unknown default:
            isInterrupted = true
            player?.stop()
        }
    }

    private enum HapticAction {
        case move(sliding: Bool)
        case bump
        case confirm
        case success
        case failure
    }

    static func wavData(frequencies: [Double], duration: Double, sampleRate: Int = 22_050) -> Data {
        let frameCount = max(1, Int(duration * Double(sampleRate)))
        var samples = [Int16]()
        samples.reserveCapacity(frameCount)
        for frame in 0..<frameCount {
            let progress = Double(frame) / Double(frameCount)
            let envelope = min(1, progress * 16) * min(1, (1 - progress) * 12)
            let time = Double(frame) / Double(sampleRate)
            let value = frequencies.enumerated().reduce(0.0) { partial, entry in
                partial + sin(2 * Double.pi * entry.element * time) / Double(frequencies.count)
            }
            samples.append(Int16(max(-1, min(1, value * envelope * 0.7)) * Double(Int16.max)))
        }

        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
        }
        let byteCount = samples.count * MemoryLayout<Int16>.size
        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + byteCount))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2))
        append(UInt16(2))
        append(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(byteCount))
        for sample in samples { append(sample) }
        return data
    }
}
