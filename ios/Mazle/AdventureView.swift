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
        case 1: return [Color(red: 0.31, green: 0.76, blue: 0.96), Color(red: 0.35, green: 0.57, blue: 0.94)]
        case 2: return [Color(red: 0.28, green: 0.82, blue: 0.76), Color(red: 0.20, green: 0.61, blue: 0.77)]
        case 3: return [Color(red: 0.55, green: 0.50, blue: 0.94), Color(red: 0.31, green: 0.42, blue: 0.82)]
        case 4: return [Color(red: 0.95, green: 0.52, blue: 0.46), Color(red: 0.69, green: 0.35, blue: 0.76)]
        default: return [Color(red: 0.20, green: 0.32, blue: 0.59), Color(red: 0.08, green: 0.16, blue: 0.35)]
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
    let onDaily: () -> Void

    @State private var selectedLevel: AdventureLevel?
    @State private var playingLevelId: Int? = AdventureLaunchConfiguration.requestedLevelID
    @State private var showingEnergy = false

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
                    onEnergy: { showingEnergy = true }
                )
                .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading)))
            }
        }
        .animation(.easeInOut(duration: 0.32), value: playingLevelId)
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
                    MazleHaptics.shared.confirm()
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
        .task {
            progressStore.refreshEnergy()
            await progressStore.syncAccount()
        }
        .statusBarHidden(true)
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
    let onDaily: () -> Void
    let onLevel: (AdventureLevel) -> Void
    let onEnergy: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            AdventureMapHeader(
                progressStore: progressStore,
                onDaily: onDaily,
                onEnergy: onEnergy
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
                    }
                    .onAppear {
                        guard progressStore.progress.highestUnlockedLevel > 1 else { return }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            withAnimation(.easeInOut(duration: 0.6)) {
                                reader.scrollTo("level-\(progressStore.progress.highestUnlockedLevel)", anchor: .center)
                            }
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
    }
}

private struct AdventureMapHeader: View {
    @ObservedObject var progressStore: AdventureProgressStore
    let onDaily: () -> Void
    let onEnergy: () -> Void

    var body: some View {
        HStack(spacing: 10) {
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

            AdventureEnergyPill(progressStore: progressStore, onTap: onEnergy)
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(.ultraThinMaterial.opacity(0.84))
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.7)).frame(height: 1) }
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
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(AdventurePalette.blue.opacity(0.13))
                WebCharacterIcon(size: 58)
            }
            .frame(width: 70, height: 70)

            VStack(alignment: .leading, spacing: 4) {
                Text(progressStore.completedLevels == 0 ? "YOUR JOURNEY BEGINS" : "KEEP CLIMBING")
                    .font(AdventureFont.black(16))
                    .foregroundStyle(AdventurePalette.ink)
                Text("Solve each maze, earn stars, and discover new ice trails.")
                    .font(AdventureFont.regular(12.5))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.66))
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 12) {
                    Label("\(progressStore.totalStars)", systemImage: "star.fill")
                    Label("\(progressStore.completedLevels)/50", systemImage: "flag.checkered")
                }
                .font(AdventureFont.extraBold(11))
                .foregroundStyle(AdventurePalette.deepBlue)
                .padding(.top, 3)
            }
        }
        .padding(16)
        .background(.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 22).stroke(.white.opacity(0.92), lineWidth: 1.5) }
        .shadow(color: AdventurePalette.deepBlue.opacity(0.10), radius: 16, y: 8)
        .padding(.top, 14)
    }
}

private struct AdventureChapterTrack: View {
    let chapter: AdventureChapter
    let levels: [AdventureLevel]
    @ObservedObject var progressStore: AdventureProgressStore
    let onLevel: (AdventureLevel) -> Void

    private let stepHeight: CGFloat = 78
    private let offsets: [CGFloat] = [-0.27, -0.06, 0.22, 0.10, -0.18, -0.28, 0.02, 0.27, 0.14, -0.10]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(String(format: "%02d", chapter.index))
                    .font(AdventureFont.black(25))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 15))
                VStack(alignment: .leading, spacing: 1) {
                    Text(chapter.title.uppercased())
                        .font(AdventureFont.black(17))
                        .tracking(0.6)
                    Text(chapter.subtitle)
                        .font(AdventureFont.semibold(11.5))
                        .foregroundStyle(.white.opacity(0.78))
                        .lineLimit(2)
                }
                Spacer()
                Text("\(chapterStars)/30")
                    .font(AdventureFont.extraBold(12))
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(.black.opacity(0.13), in: Capsule())
                    .accessibilityLabel("\(chapterStars) of 30 stars")
            }
            .foregroundStyle(.white)
            .padding(16)

            GeometryReader { proxy in
                ZStack(alignment: .topLeading) {
                    Canvas { context, size in
                        guard levels.count > 1 else { return }
                        var path = Path()
                        for index in levels.indices {
                            let point = nodePoint(index: index, width: size.width)
                            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                        }
                        context.stroke(
                            path,
                            with: .color(.white.opacity(0.42)),
                            style: StrokeStyle(lineWidth: 9, lineCap: .round, lineJoin: .round, dash: [4, 15])
                        )
                    }

                    ForEach(Array(levels.enumerated()), id: \.element.id) { index, level in
                        AdventureLevelNode(
                            level: level,
                            result: progressStore.result(for: level.id),
                            unlocked: progressStore.isUnlocked(level),
                            current: level.id == progressStore.progress.highestUnlockedLevel,
                            action: { onLevel(level) }
                        )
                        .position(nodePoint(index: index, width: proxy.size.width))
                        .id("level-\(level.id)")
                    }
                }
            }
            .frame(height: stepHeight * CGFloat(max(1, levels.count)) + 20)
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

    private func nodePoint(index: Int, width: CGFloat) -> CGPoint {
        let x = width / 2 + offsets[index % offsets.count] * width
        return CGPoint(x: x, y: 48 + CGFloat(index) * stepHeight)
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
                    if current {
                        Circle()
                            .stroke(.white.opacity(0.64), lineWidth: 4)
                            .frame(width: 72, height: 72)
                            .scaleEffect(pulsing ? 1.09 : 0.98)
                            .opacity(pulsing ? 0.18 : 0.8)
                    }

                    Circle()
                        .fill(nodeGradient)
                        .frame(width: level.levelInChapter == 10 ? 64 : 57, height: level.levelInChapter == 10 ? 64 : 57)
                        .overlay {
                            Circle().stroke(.white.opacity(unlocked ? 0.92 : 0.35), lineWidth: 3)
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
                            .foregroundStyle(.white.opacity(0.72))
                    }
                }

                HStack(spacing: 1) {
                    ForEach(1...3, id: \.self) { star in
                        Image(systemName: star <= (result?.stars ?? 0) ? "star.fill" : "star")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(star <= (result?.stars ?? 0) ? AdventurePalette.gold : .white.opacity(0.55))
                    }
                }
                .frame(height: 11)
            }
            .frame(width: 86, height: 78)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
            colors = [.white.opacity(0.28), .black.opacity(0.18)]
        } else if result != nil {
            colors = [AdventurePalette.gold, AdventurePalette.orange]
        } else {
            switch level.difficulty {
            case .tutorial, .easy, .normal: colors = [.white.opacity(0.96), AdventurePalette.aqua]
            case .hard: colors = [AdventurePalette.orange, AdventurePalette.coral]
            case .superHard: colors = [AdventurePalette.purple, AdventurePalette.deepBlue]
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
            .buttonStyle(.plain)

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
        .task { await game.prepare() }
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

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 0) {
                Text("\(game.movesRemaining)")
                    .font(AdventureFont.black(29))
                    .monospacedDigit()
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
        .accessibilityLabel("Adventure maze for level \(level.id)")
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
            guard let animation else { return }
            animationTask?.cancel()
            animationTask = Task { @MainActor in
                for point in animation.path {
                    guard !Task.isCancelled else { return }
                    withAnimation(.easeInOut(duration: 0.068)) {
                        displayedPosition = point
                    }
                    try? await Task.sleep(nanoseconds: 72_000_000)
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
                .buttonStyle(.plain)

                HStack(spacing: 10) {
                    Button("REPLAY", action: onReplay)
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
        .onAppear {
            if reduceMotion {
                revealedStars = result.stars
            } else {
                Task { @MainActor in
                    for star in 1...result.stars {
                        try? await Task.sleep(nanoseconds: 250_000_000)
                        withAnimation(.spring(response: 0.46, dampingFraction: 0.55)) {
                            revealedStars = star
                        }
                        MazleHaptics.shared.confirm()
                    }
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
                Text("The trail ended before the star. Try a new route and watch your move limit.")
                    .font(AdventureFont.regular(13))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.62))
                    .multilineTextAlignment(.center)

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
                .buttonStyle(.plain)

                Button("BACK TO MAP", action: onMap)
                    .font(AdventureFont.extraBold(12))
                    .foregroundStyle(AdventurePalette.ink.opacity(0.62))
            }
            .padding(24)
            .frame(maxWidth: 345)
            .background(AdventurePalette.snow, in: RoundedRectangle(cornerRadius: 28))
            .padding(22)
        }
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
