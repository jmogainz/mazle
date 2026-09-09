import StoreKit
import SwiftUI

private enum AdventureFont {
    static func regular(_ size: CGFloat) -> Font { .custom("Nunito-Regular", size: size) }
    static func semibold(_ size: CGFloat) -> Font { .custom("Nunito-SemiBold", size: size) }
    static func bold(_ size: CGFloat) -> Font { .custom("Nunito-Bold", size: size) }
    static func extraBold(_ size: CGFloat) -> Font { .custom("Nunito-ExtraBold", size: size) }
    static func black(_ size: CGFloat) -> Font { .custom("Nunito-Black", size: size) }
}

private enum AdventurePalette {
    static let ink = Color(red: 0.08, green: 0.14, blue: 0.24)
    static let blue = Color(red: 0.18, green: 0.48, blue: 0.88)
    static let deepBlue = Color(red: 0.08, green: 0.27, blue: 0.63)
    static let aqua = Color(red: 0.29, green: 0.83, blue: 0.91)
    static let mint = Color(red: 0.34, green: 0.78, blue: 0.60)
    static let gold = Color(red: 1.0, green: 0.76, blue: 0.18)
    static let orange = Color(red: 1.0, green: 0.50, blue: 0.22)
    static let coral = Color(red: 0.96, green: 0.28, blue: 0.34)
    static let purple = Color(red: 0.52, green: 0.36, blue: 0.88)
    static let snow = Color(red: 0.96, green: 0.99, blue: 1.0)

    static func chapter(_ index: Int) -> [Color] {
        switch index {
        case 1: return [Color(red: 0.91, green: 0.97, blue: 1.0), Color(red: 0.71, green: 0.89, blue: 0.98)]
        case 2: return [Color(red: 0.88, green: 0.98, blue: 0.96), Color(red: 0.70, green: 0.91, blue: 0.86)]
        case 3: return [Color(red: 0.94, green: 0.94, blue: 1.0), Color(red: 0.80, green: 0.83, blue: 0.98)]
        case 4: return [Color(red: 1.0, green: 0.94, blue: 0.91), Color(red: 0.98, green: 0.81, blue: 0.77)]
        default: return [Color(red: 0.92, green: 0.91, blue: 0.99), Color(red: 0.73, green: 0.72, blue: 0.91)]
        }
    }
}

private enum AdventureLaunchConfiguration {
    static var requestedLevelID: Int? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let flag = arguments.firstIndex(of: "-AdventureLevel"),
              arguments.indices.contains(flag + 1),
              let levelID = Int(arguments[flag + 1]),
              (1...50).contains(levelID) else { return nil }
        return levelID
    }
}

struct AdventureRootView: View {
    @EnvironmentObject private var progressStore: AdventureProgressStore
    @EnvironmentObject private var storeKit: StoreKitManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let onDaily: () -> Void

    @State private var selectedLevel: AdventureLevel?
    @State private var playingLevelId: Int? = AdventureLaunchConfiguration.requestedLevelID
    @State private var showingEnergy = false
    @State private var showingSettings = false

    var body: some View {
        ZStack {
            AdventureBackdrop()

            if let playingLevelId,
               let level = progressStore.catalog?.level(id: playingLevelId) {
                AdventurePlayScreen(
                    level: level,
                    progressStore: progressStore,
                    onMap: { self.playingLevelId = nil },
                    onNext: { self.playingLevelId = $0 },
                    onEnergy: { showingEnergy = true }
                )
                .id(level.id)
                .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .opacity))
            } else {
                AdventureMapScreen(
                    progressStore: progressStore,
                    onDaily: onDaily,
                    onLevel: { selectedLevel = $0 },
                    onEnergy: { showingEnergy = true },
                    onSettings: { showingSettings = true }
                )
                .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading)))
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.32), value: playingLevelId)
        .sheet(item: $selectedLevel) { level in
            AdventureLevelPreview(
                level: level,
                progressStore: progressStore,
                onPlay: {
                    guard progressStore.canStart(level) else {
                        selectedLevel = nil
                        showingEnergy = true
                        return
                    }
                    selectedLevel = nil
                    playingLevelId = level.id
                    AdventureFeedback.shared.play(.star)
                }
            )
            .presentationDetents([.height(410)])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(28)
        }
        .sheet(isPresented: $showingEnergy) {
            AdventureEnergyShop(progressStore: progressStore, storeKit: storeKit)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(28)
        }
        .sheet(isPresented: $showingSettings) {
            AdventureFeedbackSettings()
                .presentationDetents([.height(310)])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(28)
        }
        .task {
            progressStore.refreshEnergy()
            guard !MazleRuntimeConfiguration.isOfflineBuild else { return }
            await progressStore.syncAccount()
        }
        .statusBarHidden(true)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("mazle.adventure-screen")
    }
}

private struct AdventureBackdrop: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drifting = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.91, green: 0.98, blue: 1.0),
                    Color(red: 0.80, green: 0.93, blue: 1.0),
                    Color(red: 0.90, green: 0.88, blue: 1.0),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Circle()
                .fill(AdventurePalette.aqua.opacity(0.25))
                .frame(width: 330, height: 330)
                .blur(radius: 28)
                .offset(x: drifting ? 150 : 90, y: drifting ? -310 : -250)

            Circle()
                .fill(AdventurePalette.purple.opacity(0.18))
                .frame(width: 390, height: 390)
                .blur(radius: 36)
                .offset(x: drifting ? -140 : -80, y: drifting ? 350 : 280)

            Canvas { context, size in
                for index in 0..<28 {
                    let x = CGFloat((index * 73) % 101) / 101 * size.width
                    let y = CGFloat((index * 47) % 97) / 97 * size.height
                    let radius = CGFloat(1 + index % 3)
                    context.fill(
                        Path(ellipseIn: CGRect(x: x, y: y, width: radius, height: radius)),
                        with: .color(.white.opacity(0.52))
                    )
                }
            }
        }
        .ignoresSafeArea()
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 8).repeatForever(autoreverses: true)) {
                drifting = true
            }
        }
    }
}

private struct AdventureMapScreen: View {
    @ObservedObject var progressStore: AdventureProgressStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let onDaily: () -> Void
    let onLevel: (AdventureLevel) -> Void
    let onEnergy: () -> Void
    let onSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            AdventureMapHeader(
                progressStore: progressStore,
                onDaily: onDaily,
                onEnergy: onEnergy,
                onSettings: onSettings
            )

            if let catalog = progressStore.catalog {
                ScrollViewReader { reader in
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(spacing: 18) {
                            AdventureWelcomeCard(progressStore: progressStore)

                            ForEach(catalog.chapters.sorted { $0.index < $1.index }) { chapter in
                                AdventureChapterTrack(
                                    chapter: chapter,
                                    levels: catalog.levels(in: chapter),
                                    progressStore: progressStore,
                                    onLevel: onLevel
                                )
                            }

                            Text("MORE ADVENTURES AHEAD")
                                .font(AdventureFont.extraBold(12))
                                .tracking(1.8)
                                .foregroundStyle(AdventurePalette.ink.opacity(0.48))
                                .padding(.vertical, 28)
                        }
                        .padding(.horizontal, 14)
                        .padding(.bottom, 28)
                        .frame(maxWidth: 760)
                        .frame(maxWidth: .infinity)
                    }
                    .task(id: progressStore.progress.highestUnlockedLevel) {
                        guard progressStore.progress.highestUnlockedLevel > 1 else { return }
                        guard !Task.isCancelled else { return }
                        if reduceMotion {
                            await Task.yield()
                            guard !Task.isCancelled else { return }
                            reader.scrollTo("level-\(progressStore.progress.highestUnlockedLevel)", anchor: .center)
                            return
                        }
                        do {
                            try await Task.sleep(nanoseconds: 350_000_000)
                        } catch {
                            return
                        }
                        guard !Task.isCancelled else { return }
                        withAnimation(.easeInOut(duration: 0.6)) {
                            reader.scrollTo("level-\(progressStore.progress.highestUnlockedLevel)", anchor: .center)
                        }
                    }
                }
            } else {
                ContentUnavailableView(
                    "Adventure unavailable",
                    systemImage: "map",
                    description: Text(progressStore.errorMessage ?? "The level pack could not be loaded.")
                )
                .foregroundStyle(AdventurePalette.ink)
                .frame(maxHeight: .infinity)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("adventure-map")
    }
}

private struct AdventureMapHeader: View {
    @ObservedObject var progressStore: AdventureProgressStore
    let onDaily: () -> Void
    let onEnergy: () -> Void
    let onSettings: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if MazleRuntimeConfiguration.isOfflineBuild {
                Color.clear
                    .frame(width: 42, height: 42)
            } else {
                Button(action: onDaily) {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                        Text("DAILY")
                    }
                    .font(AdventureFont.extraBold(12))
                    .foregroundStyle(AdventurePalette.ink)
                    .padding(.horizontal, 12)
                    .frame(height: 42)
                    .background(.white.opacity(0.72), in: Capsule())
                    .overlay { Capsule().stroke(.white.opacity(0.85), lineWidth: 1) }
                }
                .buttonStyle(.plain)
            }

            VStack(spacing: 0) {
                Text("MAZLE")
                    .font(AdventureFont.black(20))
                    .tracking(2.2)
                Text("ADVENTURE")
                    .font(AdventureFont.extraBold(10))
                    .tracking(2.4)
                    .foregroundStyle(AdventurePalette.deepBlue)
            }
            .foregroundStyle(AdventurePalette.ink)
            .frame(maxWidth: .infinity)

            Button(action: onSettings) {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(AdventurePalette.ink)
                    .frame(width: 42, height: 42)
                    .background(.white.opacity(0.72), in: Circle())
                    .overlay { Circle().stroke(.white.opacity(0.85), lineWidth: 1) }
            }
            .buttonStyle(AdventurePressStyle())
            .accessibilityLabel("Adventure settings")
            .accessibilityIdentifier("adventure-settings")

            AdventureEnergyPill(progressStore: progressStore, onTap: onEnergy)
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(.ultraThinMaterial.opacity(0.84))
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.7)).frame(height: 1) }
    }
}

private struct AdventureFeedbackSettings: View {
    @ObservedObject private var feedback = AdventureFeedback.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 3) {
                Text("ADVENTURE SETTINGS")
                    .font(AdventureFont.black(22))
                    .foregroundStyle(AdventurePalette.ink)
                Text("Make each move feel right for you.")
                    .font(AdventureFont.regular(13))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.58))
            }

            Toggle(isOn: $feedback.soundEnabled) {
                Label("Sound effects", systemImage: "speaker.wave.2.fill")
                    .font(AdventureFont.bold(15))
                    .foregroundStyle(AdventurePalette.ink)
            }
            .tint(AdventurePalette.blue)
            .accessibilityIdentifier("adventure-settings-sound")

            Toggle(isOn: $feedback.hapticsEnabled) {
                Label("Haptics", systemImage: "hand.tap.fill")
                    .font(AdventureFont.bold(15))
                    .foregroundStyle(AdventurePalette.ink)
            }
            .tint(AdventurePalette.blue)
            .accessibilityIdentifier("adventure-settings-haptics")

            Text("Audio follows your iPhone’s silent switch and pauses during interruptions.")
                .font(AdventureFont.regular(11.5))
                .foregroundStyle(AdventurePalette.ink.opacity(0.5))
                .fixedSize(horizontal: false, vertical: true)

            Button("Done") { dismiss() }
                .font(AdventureFont.black(14))
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .foregroundStyle(.white)
                .background(AdventurePalette.blue, in: RoundedRectangle(cornerRadius: 14))
                .buttonStyle(AdventurePressStyle())
        }
        .padding(24)
        .background(AdventurePalette.snow)
    }
}

private struct AdventurePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct AdventureEnergyPill: View {
    @ObservedObject var progressStore: AdventureProgressStore
    let onTap: () -> Void

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            Button(action: onTap) {
                VStack(alignment: .trailing, spacing: 0) {
                    HStack(spacing: 3) {
                        Image(systemName: "heart.fill")
                            .foregroundStyle(AdventurePalette.coral)
                        Text("\(progressStore.energy.hearts)/\(progressStore.energy.maximumHearts)")
                            .font(AdventureFont.extraBold(13))
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(AdventurePalette.blue)
                    }
                    if let countdown = progressStore.countdownString(at: context.date) {
                        Text(countdown)
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundStyle(AdventurePalette.ink.opacity(0.55))
                    }
                }
                .foregroundStyle(AdventurePalette.ink)
                .padding(.horizontal, 11)
                .frame(minWidth: 82, minHeight: 42)
                .background(.white.opacity(0.78), in: Capsule())
                .overlay { Capsule().stroke(.white.opacity(0.9), lineWidth: 1) }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(progressStore.energy.hearts) of \(progressStore.energy.maximumHearts) Adventure hearts")
            .accessibilityHint("Opens energy and refill options")
            .onChange(of: context.date) { _, date in
                progressStore.refreshEnergy(at: date)
            }
        }
    }
}

private struct AdventureWelcomeCard: View {
    @ObservedObject var progressStore: AdventureProgressStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AdventureHeroIllustration()
                .frame(height: 184)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                Text("YOUR JOURNEY")
                    .font(AdventureFont.extraBold(10))
                    .tracking(1.5)
                    .foregroundStyle(AdventurePalette.blue)
                HStack(alignment: .firstTextBaseline) {
                    Text("Level \(min(50, progressStore.progress.highestUnlockedLevel))")
                        .font(AdventureFont.black(22))
                        .foregroundStyle(AdventurePalette.ink)
                    Spacer()
                    Label("\(progressStore.totalStars)/150", systemImage: "star.fill")
                        .font(AdventureFont.extraBold(12))
                        .foregroundStyle(AdventurePalette.deepBlue)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .background(.white.opacity(0.86), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 24).stroke(.white.opacity(0.96), lineWidth: 1.5) }
        .shadow(color: AdventurePalette.deepBlue.opacity(0.10), radius: 16, y: 8)
        .padding(.top, 14)
    }
}

private struct AdventureHeroIllustration: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sunOffset: CGFloat = 0

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottomLeading) {
                LinearGradient(
                    colors: [Color(red: 0.79, green: 0.94, blue: 1.0), Color(red: 0.94, green: 0.98, blue: 1.0)],
                    startPoint: .top,
                    endPoint: .bottom
                )

                Circle()
                    .fill(Color(red: 1.0, green: 0.87, blue: 0.32).opacity(0.92))
                    .frame(width: proxy.size.width * 0.34)
                    .blur(radius: 1)
                    .offset(x: proxy.size.width * 0.62, y: -proxy.size.height * 0.30 + sunOffset)

                AdventureCloud(x: proxy.size.width * 0.10, y: proxy.size.height * 0.17, scale: 0.9)
                AdventureCloud(x: proxy.size.width * 0.82, y: proxy.size.height * 0.29, scale: 0.65)

                Canvas { context, size in
                    var rear = Path()
                    rear.move(to: CGPoint(x: 0, y: size.height * 0.77))
                    rear.addLine(to: CGPoint(x: size.width * 0.27, y: size.height * 0.28))
                    rear.addLine(to: CGPoint(x: size.width * 0.53, y: size.height * 0.77))
                    rear.addLine(to: CGPoint(x: size.width * 0.74, y: size.height * 0.43))
                    rear.addLine(to: CGPoint(x: size.width, y: size.height * 0.73))
                    rear.addLine(to: CGPoint(x: size.width, y: size.height))
                    rear.addLine(to: CGPoint(x: 0, y: size.height))
                    rear.closeSubpath()
                    context.fill(rear, with: .color(Color(red: 0.55, green: 0.74, blue: 0.84).opacity(0.54)))

                    var snow = Path()
                    snow.move(to: CGPoint(x: size.width * 0.27, y: size.height * 0.28))
                    snow.addLine(to: CGPoint(x: size.width * 0.40, y: size.height * 0.52))
                    snow.addLine(to: CGPoint(x: size.width * 0.32, y: size.height * 0.48))
                    snow.addLine(to: CGPoint(x: size.width * 0.27, y: size.height * 0.57))
                    snow.addLine(to: CGPoint(x: size.width * 0.18, y: size.height * 0.47))
                    snow.closeSubpath()
                    context.fill(snow, with: .color(.white.opacity(0.92)))

                    for index in 0..<7 {
                        let x = CGFloat(index) / 6 * size.width
                        let baseY = size.height * (0.92 - CGFloat(index % 2) * 0.04)
                        var pine = Path()
                        pine.move(to: CGPoint(x: x, y: baseY - 34))
                        pine.addLine(to: CGPoint(x: x - 18, y: baseY))
                        pine.addLine(to: CGPoint(x: x + 18, y: baseY))
                        pine.closeSubpath()
                        context.fill(pine, with: .color(Color(red: 0.28, green: 0.56, blue: 0.66).opacity(0.38)))
                    }
                }

                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("THE FROSTPEAK TRAIL")
                            .font(AdventureFont.extraBold(9))
                            .tracking(1.2)
                            .foregroundStyle(AdventurePalette.deepBlue)
                            .padding(.horizontal, 9)
                            .frame(height: 24)
                            .background(.white.opacity(0.88), in: Capsule())
                        Text("Every path has\na perfect route.")
                            .font(AdventureFont.black(22))
                            .foregroundStyle(AdventurePalette.ink)
                            .shadow(color: .white.opacity(0.7), radius: 3)
                    }
                    Spacer()
                    WebCharacterIcon(size: 46)
                        .padding(8)
                        .background(.white.opacity(0.72), in: Circle())
                }
                .padding(16)
            }
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 6).repeatForever(autoreverses: true)) {
                sunOffset = -4
            }
        }
    }
}

private struct AdventureCloud: View {
    let x: CGFloat
    let y: CGFloat
    let scale: CGFloat

    var body: some View {
        HStack(spacing: -10 * scale) {
            Circle().frame(width: 28 * scale, height: 20 * scale)
            Circle().frame(width: 38 * scale, height: 28 * scale)
            Circle().frame(width: 25 * scale, height: 18 * scale)
        }
        .foregroundStyle(.white.opacity(0.55))
        .position(x: x, y: y)
    }
}

private struct AdventureChapterTrack: View {
    let chapter: AdventureChapter
    let levels: [AdventureLevel]
    @ObservedObject var progressStore: AdventureProgressStore
    let onLevel: (AdventureLevel) -> Void

    private let stepHeight: CGFloat = 100

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(String(format: "%02d", chapter.index))
                    .font(AdventureFont.black(25))
                    .foregroundStyle(AdventurePalette.deepBlue)
                    .frame(width: 48, height: 48)
                    .background(.white.opacity(0.74), in: RoundedRectangle(cornerRadius: 15))
                VStack(alignment: .leading, spacing: 1) {
                    Text(chapter.title.uppercased())
                        .font(AdventureFont.black(17))
                        .tracking(0.6)
                    Text(chapter.subtitle)
                        .font(AdventureFont.semibold(11.5))
                        .foregroundStyle(AdventurePalette.ink.opacity(0.62))
                        .lineLimit(2)
                }
                Spacer()
                Text("\(chapterStars)/30")
                    .font(AdventureFont.extraBold(12))
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(.white.opacity(0.66), in: Capsule())
                    .accessibilityLabel("\(chapterStars) of 30 stars")
            }
            .foregroundStyle(AdventurePalette.ink)
            .padding(16)

            GeometryReader { proxy in
                ZStack(alignment: .topLeading) {
                    Canvas { context, size in
                        guard levels.count > 1 else { return }
                        var path = Path()
                        for (index, level) in levels.enumerated() {
                            let point = nodePoint(level: level, width: size.width, height: size.height)
                            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                        }
                        context.stroke(
                            path,
                            with: .color(AdventurePalette.deepBlue.opacity(0.28)),
                            style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round, dash: [3, 12])
                        )
                    }

                    ForEach(Array(levels.enumerated()), id: \.element.id) { _, level in
                        AdventureLevelNode(
                            level: level,
                            result: progressStore.result(for: level.id),
                            unlocked: progressStore.isUnlocked(level),
                            current: level.id == progressStore.progress.highestUnlockedLevel && progressStore.result(for: level.id) == nil,
                            action: { onLevel(level) }
                        )
                        .position(nodePoint(level: level, width: proxy.size.width, height: proxy.size.height))
                        .id("level-\(level.id)")
                    }
                }
            }
            .frame(height: stepHeight * CGFloat(max(1, levels.count)) + 24)
            .padding(.horizontal, 8)
        }
        .background(
            LinearGradient(
                colors: AdventurePalette.chapter(chapter.index),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white.opacity(0.62), lineWidth: 1.5)
        }
        .shadow(color: AdventurePalette.chapter(chapter.index).last?.opacity(0.22) ?? .clear, radius: 16, y: 9)
    }

    private var chapterStars: Int {
        levels.compactMap { progressStore.result(for: $0.id)?.stars }.reduce(0, +)
    }

    private func nodePoint(level: AdventureLevel, width: CGFloat, height: CGFloat) -> CGPoint {
        let horizontalInset = min(48, width * 0.12)
        let x = horizontalInset + CGFloat(level.mapPosition.x) * (width - horizontalInset * 2)
        let yInset = CGFloat(22)
        let y = yInset + CGFloat(level.mapPosition.y) * (height - yInset * 2)
        return CGPoint(x: x, y: y)
    }
}

private struct AdventureLevelNode: View {
    let level: AdventureLevel
    let result: AdventureLevelResult?
    let unlocked: Bool
    let current: Bool
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                ZStack {
                    if current && unlocked {
                        Circle()
                            .stroke(AdventurePalette.mint.opacity(0.58), lineWidth: 4)
                            .frame(width: 72, height: 72)
                            .scaleEffect(pulsing ? 1.09 : 0.98)
                            .opacity(pulsing ? 0.20 : 0.78)
                    }

                    Circle()
                        .fill(nodeGradient)
                        .frame(width: level.levelInChapter == 10 ? 64 : 57, height: level.levelInChapter == 10 ? 64 : 57)
                        .overlay {
                            Circle().stroke(.white.opacity(unlocked ? 0.96 : 0.74), lineWidth: 3)
                        }
                        .shadow(color: .black.opacity(unlocked ? 0.22 : 0.08), radius: 5, y: 4)

                    if unlocked {
                        Text("\(level.id)")
                            .font(AdventureFont.black(level.levelInChapter == 10 ? 19 : 17))
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.18), radius: 1, y: 1)
                    } else {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(AdventurePalette.ink.opacity(0.48))
                    }

                    if current && unlocked {
                        Text("PLAY")
                            .font(AdventureFont.black(9))
                            .tracking(0.8)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .frame(height: 20)
                            .background(AdventurePalette.mint, in: Capsule())
                            .overlay { Capsule().stroke(.white, lineWidth: 2) }
                            .offset(y: -38)
                    }
                }

                HStack(spacing: 1) {
                    ForEach(1...3, id: \.self) { star in
                        Image(systemName: star <= (result?.stars ?? 0) ? "star.fill" : "star")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(star <= (result?.stars ?? 0) ? AdventurePalette.gold : AdventurePalette.ink.opacity(0.32))
                    }
                }
                .frame(height: 11)
            }
            .frame(width: 92, height: 92)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("adventure-level-\(level.id)")
        .disabled(!unlocked)
        .accessibilityLabel("Level \(level.id), \(level.title)")
        .accessibilityValue(unlocked ? "\(result?.stars ?? 0) stars" : "Locked")
        .onAppear {
            guard current, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.25).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
    }

    private var nodeGradient: LinearGradient {
        let colors: [Color]
        if !unlocked {
            colors = [Color(red: 0.84, green: 0.89, blue: 0.92), Color(red: 0.69, green: 0.77, blue: 0.82)]
        } else if result != nil {
            colors = [Color(red: 1.0, green: 0.83, blue: 0.35), Color(red: 0.94, green: 0.57, blue: 0.19)]
        } else if current {
            colors = [Color(red: 0.43, green: 0.86, blue: 0.62), Color(red: 0.14, green: 0.60, blue: 0.37)]
        } else {
            switch level.difficulty {
            case .tutorial, .easy, .normal: colors = [.white, Color(red: 0.55, green: 0.84, blue: 0.93)]
            case .hard: colors = [Color(red: 1.0, green: 0.77, blue: 0.48), AdventurePalette.orange]
            case .superHard: colors = [Color(red: 0.76, green: 0.68, blue: 0.95), AdventurePalette.purple]
            }
        }
        return LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
    }
}

private struct AdventureLevelPreview: View {
    let level: AdventureLevel
    @ObservedObject var progressStore: AdventureProgressStore
    let onPlay: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Capsule().fill(Color.secondary.opacity(0.25)).frame(width: 42, height: 5)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("LEVEL \(level.id)")
                        .font(AdventureFont.extraBold(11))
                        .tracking(1.5)
                        .foregroundStyle(AdventurePalette.blue)
                    Text(level.title)
                        .font(AdventureFont.black(28))
                        .foregroundStyle(AdventurePalette.ink)
                }
                Spacer()
                AdventureDifficultyBadge(difficulty: level.difficulty)
            }

            HStack(spacing: 10) {
                AdventurePreviewMetric(value: "\(level.moveLimit)", label: "MOVE LIMIT", icon: "arrow.left.arrow.right")
                AdventurePreviewMetric(value: "\(level.optimalMoves)", label: "3-STAR TARGET", icon: "star.fill")
                AdventurePreviewMetric(value: bestLabel, label: "YOUR BEST", icon: "trophy.fill")
            }

            HStack(spacing: 8) {
                ForEach(level.mechanics, id: \.self) { mechanic in
                    Label(mechanic.label, systemImage: mechanic.systemImage)
                        .font(AdventureFont.bold(10.5))
                        .foregroundStyle(AdventurePalette.ink.opacity(0.72))
                        .padding(.horizontal, 9)
                        .frame(height: 28)
                        .background(AdventurePalette.blue.opacity(0.09), in: Capsule())
                }
                Spacer(minLength: 0)
            }

            Button(action: onPlay) {
                HStack(spacing: 9) {
                    Image(systemName: "play.fill")
                    Text(progressStore.activeAttempt?.levelId == level.id ? "RESUME LEVEL" : "PLAY LEVEL")
                }
                .font(AdventureFont.black(15))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    LinearGradient(colors: [AdventurePalette.blue, AdventurePalette.deepBlue], startPoint: .top, endPoint: .bottom),
                    in: RoundedRectangle(cornerRadius: 17, style: .continuous)
                )
                .shadow(color: AdventurePalette.deepBlue.opacity(0.25), radius: 10, y: 6)
            }
            .buttonStyle(AdventurePressStyle())
            .accessibilityIdentifier("adventure-play-level")

            if !level.isProtectedFromEnergyLoss {
                Text("A heart is only used if you fail or leave after making a move.")
                    .font(AdventureFont.regular(11.5))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.58))
                    .multilineTextAlignment(.center)
            } else {
                Text("Training level • no hearts required")
                    .font(AdventureFont.bold(11.5))
                    .foregroundStyle(AdventurePalette.mint)
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
        .padding(.bottom, 20)
        .background(AdventurePalette.snow)
    }

    private var bestLabel: String {
        progressStore.result(for: level.id).map { "\($0.bestMoves)" } ?? "—"
    }
}

private struct AdventurePreviewMetric: View {
    let value: String
    let label: String
    let icon: String

    var body: some View {
        VStack(spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 10, weight: .bold))
                Text(value).font(AdventureFont.black(19)).monospacedDigit()
            }
            Text(label)
                .font(AdventureFont.extraBold(8.5))
                .tracking(0.6)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .foregroundStyle(AdventurePalette.ink)
        .frame(maxWidth: .infinity)
        .frame(height: 62)
        .background(.white, in: RoundedRectangle(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).stroke(AdventurePalette.blue.opacity(0.10), lineWidth: 1) }
    }
}

private struct AdventureDifficultyBadge: View {
    let difficulty: AdventureDifficulty

    var body: some View {
        Text(difficulty.label.uppercased())
            .font(AdventureFont.extraBold(9.5))
            .tracking(0.7)
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(color, in: Capsule())
    }

    private var color: Color {
        switch difficulty {
        case .tutorial, .easy: return AdventurePalette.mint
        case .normal: return AdventurePalette.blue
        case .hard: return AdventurePalette.orange
        case .superHard: return AdventurePalette.purple
        }
    }
}

private struct AdventureEnergyShop: View {
    @ObservedObject var progressStore: AdventureProgressStore
    @ObservedObject var storeKit: StoreKitManager
    @ObservedObject private var sessionStore = MazleSessionStore.shared
    @State private var actionError: String?

    private var refillProducts: [Product] {
        storeKit.products.filter { StoreKitManager.ProductID.refillCount(for: $0.id) != nil }
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 18) {
                ZStack {
                    Circle().fill(AdventurePalette.coral.opacity(0.12)).frame(width: 82, height: 82)
                    Image(systemName: "heart.fill")
                        .font(.system(size: 42, weight: .bold))
                        .foregroundStyle(AdventurePalette.coral)
                        .symbolEffect(.pulse, options: .repeating.speed(0.45))
                }

                VStack(spacing: 4) {
                    Text("ADVENTURE ENERGY")
                        .font(AdventureFont.black(23))
                        .foregroundStyle(AdventurePalette.ink)
                    TimelineView(.periodic(from: Date(), by: 1)) { context in
                        Text(energyDescription(at: context.date))
                            .font(AdventureFont.regular(13))
                            .foregroundStyle(AdventurePalette.ink.opacity(0.62))
                            .multilineTextAlignment(.center)
                            .onChange(of: context.date) { _, date in
                                progressStore.refreshEnergy(at: date)
                            }
                    }
                }

                HStack(spacing: 12) {
                    ForEach(0..<progressStore.energy.maximumHearts, id: \.self) { index in
                        Image(systemName: index < progressStore.energy.hearts ? "heart.fill" : "heart")
                            .font(.system(size: 29, weight: .bold))
                            .foregroundStyle(index < progressStore.energy.hearts ? AdventurePalette.coral : AdventurePalette.ink.opacity(0.18))
                            .contentTransition(.symbolEffect(.replace))
                    }
                }

                if progressStore.energy.refillTickets > 0 {
                    Button {
                        Task {
                            do { try await progressStore.useRefillTicket() }
                            catch { actionError = error.localizedDescription }
                        }
                    } label: {
                        HStack {
                            Image(systemName: "ticket.fill")
                            Text("USE REFILL TICKET")
                            Spacer()
                            Text("×\(progressStore.energy.refillTickets)")
                        }
                        .font(AdventureFont.extraBold(13))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .frame(height: 50)
                        .background(AdventurePalette.mint, in: RoundedRectangle(cornerRadius: 15))
                    }
                    .buttonStyle(.plain)
                    .disabled(progressStore.energy.hearts == progressStore.energy.maximumHearts)
                    .opacity(progressStore.energy.hearts == progressStore.energy.maximumHearts ? 0.5 : 1)
                }

                if progressStore.dailyRefillAvailable {
                    Button("CLAIM DAILY REFILL") {
                        Task {
                            do { try await progressStore.useDailyRefill() }
                            catch { actionError = error.localizedDescription }
                        }
                    }
                    .font(AdventureFont.extraBold(13))
                    .buttonStyle(.borderedProminent)
                    .tint(AdventurePalette.gold)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("REFILL TICKETS")
                        .font(AdventureFont.extraBold(11))
                        .tracking(1.3)
                        .foregroundStyle(AdventurePalette.ink.opacity(0.58))

                    if MazleRuntimeConfiguration.isOfflineBuild {
                        Label("Refills are disabled in this offline TestFlight build.", systemImage: "wifi.slash")
                            .font(AdventureFont.semibold(12))
                            .foregroundStyle(AdventurePalette.ink.opacity(0.6))
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(AdventurePalette.ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 13))
                    } else {
                        if !sessionStore.isSignedIn {
                            Label("Sign in from Account before buying refills so purchases stay with you.", systemImage: "person.crop.circle.badge.exclamationmark")
                                .font(AdventureFont.semibold(12))
                                .foregroundStyle(AdventurePalette.orange)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(AdventurePalette.orange.opacity(0.09), in: RoundedRectangle(cornerRadius: 13))
                        }

                        if storeKit.isLoading {
                            ProgressView("Loading App Store…")
                                .font(AdventureFont.semibold(12))
                                .frame(maxWidth: .infinity, minHeight: 74)
                        } else if refillProducts.isEmpty {
                            Text(storeKit.errorMessage ?? "Refill products are unavailable in this build.")
                                .font(AdventureFont.regular(12))
                                .foregroundStyle(AdventurePalette.ink.opacity(0.6))
                                .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
                        } else {
                            ForEach(refillProducts, id: \.id) { product in
                                Button {
                                    Task { await storeKit.purchase(product) }
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: "ticket.fill")
                                            .font(.system(size: 23, weight: .bold))
                                            .foregroundStyle(AdventurePalette.blue)
                                            .frame(width: 38, height: 38)
                                            .background(AdventurePalette.blue.opacity(0.10), in: RoundedRectangle(cornerRadius: 11))
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(product.displayName)
                                                .font(AdventureFont.extraBold(13))
                                            Text(product.description)
                                                .font(AdventureFont.regular(10.5))
                                                .foregroundStyle(AdventurePalette.ink.opacity(0.55))
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        Text(product.displayPrice)
                                            .font(AdventureFont.black(14))
                                    }
                                    .foregroundStyle(AdventurePalette.ink)
                                    .padding(12)
                                    .background(.white, in: RoundedRectangle(cornerRadius: 16))
                                    .overlay { RoundedRectangle(cornerRadius: 16).stroke(AdventurePalette.blue.opacity(0.12), lineWidth: 1) }
                                }
                                .buttonStyle(.plain)
                                .disabled(!sessionStore.isSignedIn)
                                .opacity(sessionStore.isSignedIn ? 1 : 0.5)
                            }
                        }
                    }
                }

                if let message = actionError ?? storeKit.errorMessage {
                    Text(message)
                        .font(AdventureFont.regular(11.5))
                        .foregroundStyle(AdventurePalette.coral)
                        .multilineTextAlignment(.center)
                }

                Text("One ticket restores all hearts. Tickets never expire. Hearts are only lost after a failed level or leaving after your first move.")
                    .font(AdventureFont.regular(11))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.50))
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 16)
            }
            .padding(22)
        }
        .background(AdventurePalette.snow)
        .task { await storeKit.prepare() }
    }

    private func energyDescription(at date: Date) -> String {
        if progressStore.energy.hearts == progressStore.energy.maximumHearts {
            return "You’re fully charged and ready to explore."
        }
        if let countdown = progressStore.countdownString(at: date) {
            return "Next heart in \(countdown) • one heart every 30 minutes"
        }
        return "One heart regenerates every 30 minutes."
    }
}

private struct AdventurePlayScreen: View {
    let level: AdventureLevel
    @ObservedObject var progressStore: AdventureProgressStore
    let onMap: () -> Void
    let onNext: (Int) -> Void
    let onEnergy: () -> Void

    @StateObject private var game: AdventureGameViewModel
    @State private var showingAbandonConfirmation = false

    init(
        level: AdventureLevel,
        progressStore: AdventureProgressStore,
        onMap: @escaping () -> Void,
        onNext: @escaping (Int) -> Void,
        onEnergy: @escaping () -> Void
    ) {
        self.level = level
        self.progressStore = progressStore
        self.onMap = onMap
        self.onNext = onNext
        self.onEnergy = onEnergy
        _game = StateObject(wrappedValue: AdventureGameViewModel(level: level, progressStore: progressStore))
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                AdventurePlayHeader(
                    level: level,
                    progressStore: progressStore,
                    onMap: requestMap,
                    onEnergy: onEnergy
                )

                VStack(spacing: 12) {
                    AdventureMoveScoreboard(level: level, game: game)

                    GeometryReader { proxy in
                        let boardSize = min(proxy.size.width, proxy.size.height, 540)
                        AdventureMazeBoard(level: level, game: game, size: boardSize)
                            .frame(width: boardSize, height: boardSize)
                            .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
                    }

                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
            }
            .accessibilityHidden(game.isFinished)

            switch game.phase {
            case .won(let result):
                AdventureWinOverlay(
                    level: level,
                    result: result,
                    onNext: level.id < 50 ? { onNext(level.id + 1) } : onMap,
                    onReplay: { Task { await game.restart() } },
                    onMap: onMap
                )
                .transition(.opacity.combined(with: .scale(scale: 0.94)))
            case .failed:
                AdventureFailureOverlay(
                    level: level,
                    progressStore: progressStore,
                    onRetry: { Task { await game.restart() } },
                    onEnergy: onEnergy,
                    onMap: onMap
                )
                .transition(.opacity.combined(with: .scale(scale: 0.94)))
            case .preparing, .playing:
                if let error = game.errorMessage {
                    AdventureBlockedOverlay(message: error, onEnergy: onEnergy, onMap: onMap)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("adventure-play-screen")
        .task { await game.prepare() }
        .onDisappear {
            game.cancelMovement()
            AdventureFeedback.shared.stopAudio()
        }
        .alert("Leave this level?", isPresented: $showingAbandonConfirmation) {
            Button("Keep Playing", role: .cancel) {}
            Button("Leave Level", role: .destructive) {
                Task {
                    await game.abandon()
                    onMap()
                }
            }
        } message: {
            Text("Because you’ve made a move, leaving will use one heart. Your completed levels and stars are safe.")
        }
    }

    private func requestMap() {
        if game.phase == .playing, game.moves > 0, !level.isProtectedFromEnergyLoss {
            showingAbandonConfirmation = true
        } else {
            Task {
                await game.abandon()
                onMap()
            }
        }
    }
}

private struct AdventurePlayHeader: View {
    let level: AdventureLevel
    @ObservedObject var progressStore: AdventureProgressStore
    let onMap: () -> Void
    let onEnergy: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onMap) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(AdventurePalette.ink)
                    .frame(width: 42, height: 42)
                    .background(.white.opacity(0.76), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back to Adventure map")

            VStack(spacing: 0) {
                Text("LEVEL \(level.id)")
                    .font(AdventureFont.black(17))
                    .tracking(1.1)
                Text(level.title.uppercased())
                    .font(AdventureFont.extraBold(9.5))
                    .tracking(1)
                    .foregroundStyle(AdventurePalette.deepBlue)
                    .lineLimit(1)
            }
            .foregroundStyle(AdventurePalette.ink)
            .frame(maxWidth: .infinity)

            AdventureEnergyPill(progressStore: progressStore, onTap: onEnergy)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.ultraThinMaterial.opacity(0.82))
    }
}

private struct AdventureMoveScoreboard: View {
    let level: AdventureLevel
    @ObservedObject var game: AdventureGameViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 0) {
                Text("\(game.movesRemaining)")
                    .font(AdventureFont.black(29))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: game.movesRemaining)
                    .accessibilityIdentifier("adventure-moves-remaining")
                Text("MOVES LEFT")
                    .font(AdventureFont.extraBold(9))
                    .tracking(1)
            }
            .foregroundStyle(game.movesRemaining <= 3 ? AdventurePalette.coral : AdventurePalette.ink)
            .frame(width: 92)

            Rectangle().fill(AdventurePalette.ink.opacity(0.10)).frame(width: 1, height: 38)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    ForEach(1...3, id: \.self) { star in
                        let available = star <= projectedStars
                        Image(systemName: available ? "star.fill" : "star")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(available ? AdventurePalette.gold : AdventurePalette.ink.opacity(0.17))
                            .contentTransition(.symbolEffect(.replace))
                    }
                }
                Text(starHint)
                    .font(AdventureFont.semibold(10.5))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.56))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            AdventureDifficultyBadge(difficulty: level.difficulty)
        }
        .padding(.horizontal, 14)
        .frame(height: 66)
        .background(.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.92), lineWidth: 1) }
    }

    private var projectedStars: Int {
        if game.moves <= level.thresholds.three { return 3 }
        if game.moves <= level.thresholds.two { return 2 }
        return 1
    }

    private var starHint: String {
        switch projectedStars {
        case 3: return "Finish in \(max(0, level.thresholds.three - game.moves)) more for 3 stars"
        case 2: return "2-star pace"
        default: return "Reach the goal to clear"
        }
    }
}

private struct AdventureMazeBoard: View {
    let level: AdventureLevel
    @ObservedObject var game: AdventureGameViewModel
    let size: CGFloat

    @State private var displayedPosition: GridPosition
    @State private var animationTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(level: AdventureLevel, game: AdventureGameViewModel, size: CGFloat) {
        self.level = level
        self.game = game
        self.size = size
        _displayedPosition = State(initialValue: game.position)
    }

    var body: some View {
        GeometryReader { geometry in
            let pitch = min(
                geometry.size.width / CGFloat(level.width),
                geometry.size.height / CGFloat(level.height)
            )
            let gridWidth = pitch * CGFloat(level.width)
            let gridHeight = pitch * CGFloat(level.height)
            let origin = CGPoint(
                x: (geometry.size.width - gridWidth) / 2,
                y: (geometry.size.height - gridHeight) / 2
            )

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(.white.opacity(0.42))
                    .overlay { RoundedRectangle(cornerRadius: 22).stroke(.white.opacity(0.74), lineWidth: 2) }

                ForEach(0..<level.height, id: \.self) { y in
                    ForEach(0..<level.width, id: \.self) { x in
                        let position = GridPosition(x: x, y: y)
                        AdventureTileCell(
                            tile: level.tiles[y][x],
                            isGoal: position == level.goal,
                            cellSize: pitch
                        )
                        .frame(width: pitch, height: pitch)
                        .position(
                            x: origin.x + pitch * (CGFloat(x) + 0.5),
                            y: origin.y + pitch * (CGFloat(y) + 0.5)
                        )
                    }
                }

                WebCharacterIcon(size: pitch)
                    .frame(width: pitch, height: pitch)
                    .position(
                        x: origin.x + pitch * (CGFloat(displayedPosition.x) + 0.5),
                        y: origin.y + pitch * (CGFloat(displayedPosition.y) + 0.5)
                    )
                    .shadow(color: AdventurePalette.coral.opacity(0.22), radius: 4, y: 3)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 18)
                    .onEnded { value in
                        Task { await game.handleSwipe(value.translation) }
                    }
            )
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("adventure-board")
        .accessibilityLabel("Adventure maze for level \(level.id)")
        .accessibilityValue(boardAccessibilityValue)
        .accessibilityHint("Swipe in a direction to move, or use the rotor actions")
        .accessibilityAction(named: "Move up") {
            Task { await game.move(.up) }
        }
        .accessibilityAction(named: "Move down") {
            Task { await game.move(.down) }
        }
        .accessibilityAction(named: "Move left") {
            Task { await game.move(.left) }
        }
        .accessibilityAction(named: "Move right") {
            Task { await game.move(.right) }
        }
        .onAppear { displayedPosition = game.position }
        .onChange(of: game.moveAnimation) { _, animation in
            animationTask?.cancel()
            guard let animation else {
                // This also handles retry/reset: the previous non-nil
                // animation may have been interrupted before its last point.
                displayedPosition = game.position
                return
            }
            animationTask = Task { @MainActor in
                for (index, point) in animation.path.enumerated() {
                    guard !Task.isCancelled else { return }
                    if reduceMotion {
                        displayedPosition = point
                    } else if index == animation.path.count - 1 {
                        withAnimation(.easeOut(duration: animation.stepDuration)) {
                            displayedPosition = point
                        }
                    } else {
                        withAnimation(.linear(duration: animation.stepDuration)) {
                            displayedPosition = point
                        }
                    }
                    do {
                        try await Task.sleep(nanoseconds: UInt64(animation.stepDuration * 1_000_000_000))
                    } catch {
                        return
                    }
                }
            }
        }
        .onChange(of: game.position) { _, position in
            if game.moveAnimation == nil {
                displayedPosition = position
            }
        }
        .onDisappear { animationTask?.cancel() }
    }

    private var boardAccessibilityValue: String {
        let state = game.isAnimatingMove ? "Moving" : "Ready"
        return "\(state). Position \(game.position.x + 1), \(game.position.y + 1). \(game.movesRemaining) moves remaining"
    }
}

private struct AdventureTileCell: View {
    let tile: TileType
    let isGoal: Bool
    let cellSize: CGFloat

    private var role: MazleWebTileRole { MazleWebTileRole.forTile(tile) }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cellSize * 0.12, style: .continuous)
                .fill(edgeColor)
                .frame(width: cellSize * 0.90, height: cellSize * 0.90)

            RoundedRectangle(cornerRadius: cellSize * 0.11, style: .continuous)
                .fill(faceGradient)
                .frame(width: cellSize * 0.90, height: cellSize * 0.82)
                .offset(y: -cellSize * 0.035)

            if role == .ice {
                Capsule()
                    .fill(.white.opacity(0.60))
                    .frame(width: cellSize * 0.48, height: max(1, cellSize * 0.025))
                    .rotationEffect(.degrees(-43))
            }

            if let direction = ledgeDirection {
                Image(systemName: direction.systemImage)
                    .font(.system(size: cellSize * 0.25, weight: .black))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.72))
            }

            if isGoal {
                AdventureStarShape()
                    .fill(AdventurePalette.gold)
                    .overlay { AdventureStarShape().stroke(Color.orange.opacity(0.7), lineWidth: max(0.7, cellSize * 0.02)) }
                    .frame(width: cellSize * 0.52, height: cellSize * 0.52)
                    .shadow(color: AdventurePalette.gold.opacity(0.55), radius: 4)
            }
        }
    }

    private var faceGradient: LinearGradient {
        LinearGradient(colors: [faceColor.opacity(1), faceColor.opacity(0.84)], startPoint: .top, endPoint: .bottom)
    }

    private var faceColor: Color {
        switch role {
        case .ground: return Color(red: 0.78, green: 0.68, blue: 0.46)
        case .start: return AdventurePalette.gold
        case .goal: return AdventurePalette.mint
        case .ice: return Color(red: 0.58, green: 0.84, blue: 1.0)
        case .wall: return Color(red: 0.12, green: 0.16, blue: 0.25)
        case .ledgeUp, .ledgeDown, .ledgeLeft, .ledgeRight: return Color(red: 0.91, green: 0.94, blue: 0.98)
        }
    }

    private var edgeColor: Color {
        switch role {
        case .ground: return Color(red: 0.61, green: 0.50, blue: 0.30)
        case .start: return Color(red: 0.76, green: 0.58, blue: 0.13)
        case .goal: return Color(red: 0.20, green: 0.58, blue: 0.39)
        case .ice: return Color(red: 0.34, green: 0.65, blue: 0.91)
        case .wall: return Color(red: 0.20, green: 0.23, blue: 0.34)
        case .ledgeUp, .ledgeDown, .ledgeLeft, .ledgeRight: return Color(red: 0.70, green: 0.75, blue: 0.82)
        }
    }

    private var ledgeDirection: Direction? {
        switch role {
        case .ledgeUp: return .up
        case .ledgeDown: return .down
        case .ledgeLeft: return .left
        case .ledgeRight: return .right
        default: return nil
        }
    }
}

private struct AdventureWinOverlay: View {
    let level: AdventureLevel
    let result: AdventureLevelResult
    let onNext: () -> Void
    let onReplay: () -> Void
    let onMap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var revealedStars = 0

    var body: some View {
        ZStack {
            Color.black.opacity(0.54).ignoresSafeArea()
            AdventureCelebrationParticles()

            VStack(spacing: 16) {
                Text(level.id == 50 ? "ADVENTURE COMPLETE" : "LEVEL COMPLETE")
                    .font(AdventureFont.black(24))
                    .tracking(1.2)
                    .foregroundStyle(AdventurePalette.ink)

                HStack(spacing: 10) {
                    ForEach(1...3, id: \.self) { star in
                        AdventureStarShape()
                            .fill(star <= revealedStars ? AdventurePalette.gold : AdventurePalette.ink.opacity(0.10))
                            .overlay { AdventureStarShape().stroke(star <= revealedStars ? Color.orange : .clear, lineWidth: 2) }
                            .frame(width: star == 2 ? 66 : 53, height: star == 2 ? 66 : 53)
                            .scaleEffect(star <= revealedStars ? 1 : 0.55)
                            .rotationEffect(.degrees(star <= revealedStars ? 0 : -18))
                    }
                }
                .frame(height: 78)

                Text(result.stars == 3 ? "Perfect path!" : result.stars == 2 ? "Beautiful solve!" : "Trail cleared!")
                    .font(AdventureFont.extraBold(17))
                    .foregroundStyle(AdventurePalette.deepBlue)

                HStack(spacing: 22) {
                    VStack(spacing: 1) {
                        Text("\(result.bestMoves)").font(AdventureFont.black(21))
                        Text("MOVES").font(AdventureFont.extraBold(9)).tracking(0.8)
                    }
                    Rectangle().fill(AdventurePalette.ink.opacity(0.12)).frame(width: 1, height: 34)
                    VStack(spacing: 1) {
                        Text(formatDuration(result.bestTimeMs)).font(AdventureFont.black(21))
                        Text("TIME").font(AdventureFont.extraBold(9)).tracking(0.8)
                    }
                }
                .foregroundStyle(AdventurePalette.ink)

                Button(action: onNext) {
                    Text(level.id < 50 ? "NEXT LEVEL" : "BACK TO MAP")
                        .font(AdventureFont.black(15))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(AdventurePalette.blue, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(AdventurePressStyle())
                .accessibilityIdentifier("adventure-next")

                HStack(spacing: 10) {
                    Button("REPLAY", action: onReplay)
                        .accessibilityIdentifier("adventure-replay")
                    Button("MAP", action: onMap)
                }
                .font(AdventureFont.extraBold(12))
                .foregroundStyle(AdventurePalette.ink.opacity(0.68))
                .buttonStyle(.borderless)
            }
            .padding(24)
            .frame(maxWidth: 350)
            .background(AdventurePalette.snow, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 28).stroke(.white, lineWidth: 2) }
            .shadow(color: .black.opacity(0.28), radius: 30, y: 16)
            .padding(22)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("adventure-win")
        .task(id: result) {
            revealedStars = 0
            if reduceMotion {
                revealedStars = result.stars
            } else {
                for star in 1...result.stars {
                    do {
                        try await Task.sleep(nanoseconds: 250_000_000)
                    } catch {
                        return
                    }
                    guard !Task.isCancelled else { return }
                    withAnimation(.spring(response: 0.46, dampingFraction: 0.55)) {
                        revealedStars = star
                    }
                    AdventureFeedback.shared.play(.star)
                }
            }
        }
    }

    private func formatDuration(_ milliseconds: Int) -> String {
        let seconds = milliseconds / 1000
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

private struct AdventureFailureOverlay: View {
    let level: AdventureLevel
    @ObservedObject var progressStore: AdventureProgressStore
    let onRetry: () -> Void
    let onEnergy: () -> Void
    let onMap: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 15) {
                Image(systemName: "heart.slash.fill")
                    .font(.system(size: 48, weight: .bold))
                    .foregroundStyle(AdventurePalette.coral)
                Text("SO CLOSE")
                    .font(AdventureFont.black(25))
                    .foregroundStyle(AdventurePalette.ink)
                if level.isProtectedFromEnergyLoss {
                    Text("No heart was used.")
                        .font(AdventureFont.bold(13))
                        .foregroundStyle(AdventurePalette.mint)
                } else {
                    Text("The trail ended before the star. Try a new route and watch your move limit.")
                        .font(AdventureFont.regular(13))
                        .foregroundStyle(AdventurePalette.ink.opacity(0.62))
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: 5) {
                    ForEach(0..<progressStore.energy.maximumHearts, id: \.self) { index in
                        Image(systemName: index < progressStore.energy.hearts ? "heart.fill" : "heart")
                            .foregroundStyle(index < progressStore.energy.hearts ? AdventurePalette.coral : AdventurePalette.ink.opacity(0.18))
                    }
                }
                .font(.system(size: 22, weight: .bold))

                Button(action: canRetry ? onRetry : onEnergy) {
                    Text(canRetry ? "TRY AGAIN" : "GET HEARTS")
                        .font(AdventureFont.black(15))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(canRetry ? AdventurePalette.blue : AdventurePalette.coral, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(AdventurePressStyle())
                .accessibilityIdentifier("adventure-retry")

                Button("BACK TO MAP", action: onMap)
                    .font(AdventureFont.extraBold(12))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.62))
            }
            .padding(24)
            .frame(maxWidth: 345)
            .background(AdventurePalette.snow, in: RoundedRectangle(cornerRadius: 28))
            .padding(22)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("adventure-failure")
    }

    private var canRetry: Bool {
        level.isProtectedFromEnergyLoss || progressStore.energy.hearts > 0
    }
}

private struct AdventureBlockedOverlay: View {
    let message: String
    let onEnergy: () -> Void
    let onMap: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "heart.slash.fill")
                    .font(.system(size: 42, weight: .bold))
                    .foregroundStyle(AdventurePalette.coral)
                Text("PAUSE AND RECHARGE").font(AdventureFont.black(21))
                Text(message)
                    .font(AdventureFont.regular(13))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.60))
                    .multilineTextAlignment(.center)
                Button("VIEW HEARTS", action: onEnergy)
                    .font(AdventureFont.black(14))
                    .buttonStyle(.borderedProminent)
                    .tint(AdventurePalette.coral)
                Button("BACK TO MAP", action: onMap)
                    .font(AdventureFont.extraBold(12))
            }
            .foregroundStyle(AdventurePalette.ink)
            .padding(24)
            .frame(maxWidth: 340)
            .background(AdventurePalette.snow, in: RoundedRectangle(cornerRadius: 26))
            .padding(22)
        }
    }
}

private struct AdventureCelebrationParticles: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(0..<22, id: \.self) { index in
                    let angle = Double(index) / 22 * Double.pi * 2
                    let radius = min(proxy.size.width, proxy.size.height) * 0.42
                    Circle()
                        .fill([AdventurePalette.gold, AdventurePalette.aqua, AdventurePalette.coral, AdventurePalette.purple][index % 4])
                        .frame(width: CGFloat(5 + index % 5), height: CGFloat(5 + index % 5))
                        .offset(
                            x: expanded ? CGFloat(cos(angle)) * radius : 0,
                            y: expanded ? CGFloat(sin(angle)) * radius : 0
                        )
                        .opacity(expanded ? 0 : 1)
                        .rotationEffect(.degrees(expanded ? 240 : 0))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.25)) { expanded = true }
        }
    }
}

private struct AdventureStarShape: Shape {
    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let inner = outer * 0.44
        var path = Path()
        for index in 0..<10 {
            let radius = index.isMultiple(of: 2) ? outer : inner
            let angle = -Double.pi / 2 + Double(index) * Double.pi / 5
            let point = CGPoint(
                x: center.x + CGFloat(cos(angle)) * radius,
                y: center.y + CGFloat(sin(angle)) * radius
            )
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }
}
