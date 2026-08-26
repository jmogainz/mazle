import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var game: GameViewModel
    @State private var showingHelp = false
    @State private var showingMenu = false
    @State private var menuDestination: WebMenuDestination?
    @AppStorage("mazle.webHelpSeen") private var webHelpSeen = false
    @AppStorage("mazle.themePreference") private var themePreference = "light"

    var body: some View {
        ZStack {
            MazleWebPalette.color(MazleWebPalette.background)
                .ignoresSafeArea()

            if game.isLoading && game.puzzle == nil {
                WebLoadingView()
            } else if let puzzle = game.puzzle {
                WebGameView(
                    game: game,
                    puzzle: puzzle,
                    themePreference: $themePreference,
                    onHelp: { showingHelp = true },
                    onMenu: { showingMenu.toggle() },
                    onRecentPuzzles: { menuDestination = .recentPuzzles },
                    isMenuOpen: showingMenu
                )
            } else {
                WebUnavailableView(message: game.errorMessage) {
                    Task { await game.loadToday() }
                }
            }

            if showingMenu {
                WebMenuOverlay(
                    onStats: {
                        showingMenu = false
                        menuDestination = .stats
                    },
                    onLeaderboard: {
                        showingMenu = false
                        menuDestination = .leaderboard
                    },
                    onHallOfFame: {
                        showingMenu = false
                        menuDestination = .hallOfFame
                    },
                    onRecentPuzzles: {
                        showingMenu = false
                        menuDestination = .recentPuzzles
                    },
                    onAccount: {
                        showingMenu = false
                        menuDestination = .account
                    },
                    onSupport: {
                        showingMenu = false
                        MazleHaptics.shared.confirm()
                        menuDestination = .support
                    },
                    onClose: { showingMenu = false }
                )
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            if let menuDestination {
                WebDestinationOverlay(game: game, destination: menuDestination) {
                    self.menuDestination = nil
                }
                .transition(.opacity)
            }

            if showingHelp {
                WebHelpOverlay {
                    webHelpSeen = true
                    showingHelp = false
                }
                .transition(.opacity)
            }
        }
        .statusBarHidden(true)
        .preferredColorScheme(themePreference == "dark" ? .dark : themePreference == "light" ? .light : nil)
        .task {
            await game.loadToday()
            if !webHelpSeen {
                showingHelp = true
            }
        }
        .onChange(of: showingMenu) { _, isOpen in
            if isOpen {
                showingHelp = false
            }
        }
        .accessibilityIdentifier("mazle.web-native-screen")
    }
}

private enum WebMenuDestination: String, Identifiable {
    case stats
    case leaderboard
    case hallOfFame
    case recentPuzzles
    case account
    case support

    var id: String { rawValue }

    var title: String {
        switch self {
        case .stats: return "Stats"
        case .leaderboard: return "Leaderboard"
        case .hallOfFame: return "Hall of Fame"
        case .recentPuzzles: return "Recent Puzzles"
        case .account: return "Account"
        case .support: return "Support Us"
        }
    }
}

private struct WebHelpGlyph: View {
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 256
            var circle = Path()
            circle.addEllipse(in: CGRect(x: 32 * scale, y: 32 * scale, width: 192 * scale, height: 192 * scale))
            context.stroke(circle, with: .foreground, lineWidth: 20 * scale)

            var question = Path()
            question.move(to: CGPoint(x: 128 * scale, y: 144 * scale))
            question.addLine(to: CGPoint(x: 128 * scale, y: 136 * scale))
            question.addCurve(
                to: CGPoint(x: 156 * scale, y: 88 * scale),
                control1: CGPoint(x: 128 * scale, y: 116 * scale),
                control2: CGPoint(x: 156 * scale, y: 116 * scale)
            )
            question.addCurve(
                to: CGPoint(x: 100 * scale, y: 88 * scale),
                control1: CGPoint(x: 156 * scale, y: 50 * scale),
                control2: CGPoint(x: 100 * scale, y: 50 * scale)
            )
            context.stroke(
                question,
                with: .foreground,
                style: StrokeStyle(lineWidth: 20 * scale, lineCap: .round, lineJoin: .round)
            )
            context.fill(
                Path(ellipseIn: CGRect(x: 114 * scale, y: 166 * scale, width: 28 * scale, height: 28 * scale)),
                with: .foreground
            )
        }
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }
}

private struct WebThemeToggle: View {
    @Binding var themePreference: String

    private var isDark: Bool {
        themePreference == "dark"
    }

    var body: some View {
        Button {
            themePreference = isDark ? "light" : "dark"
            MazleHaptics.shared.confirm()
        } label: {
            ZStack(alignment: isDark ? .trailing : .leading) {
                Capsule(style: .continuous)
                    .fill(MazleWebPalette.color(MazleWebPalette.surface))
                    .overlay {
                        Capsule(style: .continuous)
                            .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
                    }
                    .frame(width: MazleWebLayout.themeToggleWidth, height: MazleWebLayout.themeToggleHeight)

                Circle()
                    .fill(MazleWebPalette.color(MazleWebPalette.background))
                    .overlay {
                        Circle()
                            .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
                    }
                    .overlay {
                        if isDark {
                            Image(systemName: "moon.fill")
                                .font(.system(size: 10, weight: .bold))
                        } else {
                            Image(systemName: "sun.max.fill")
                                .font(.system(size: 10, weight: .bold))
                        }
                    }
                    .frame(width: MazleWebLayout.themeToggleThumbSize, height: MazleWebLayout.themeToggleThumbSize)
                    .padding(2)
            }
            .frame(width: MazleWebLayout.themeToggleWidth, height: MazleWebLayout.themeToggleHeight)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Toggle theme")
        .accessibilityValue(isDark ? "Dark" : "Light")
    }
}

private struct WebMenuGlyph: View {
    let isOpen: Bool

    var body: some View {
        ZStack {
            Capsule(style: .continuous)
                .frame(width: MazleWebLayout.menuLineWidth, height: MazleWebLayout.menuLineHeight)
                .offset(y: isOpen ? 0 : -5)
                .rotationEffect(.degrees(isOpen ? 45 : 0))
            Capsule(style: .continuous)
                .frame(width: MazleWebLayout.menuLineWidth, height: MazleWebLayout.menuLineHeight)
                .opacity(isOpen ? 0 : 1)
            Capsule(style: .continuous)
                .frame(width: MazleWebLayout.menuLineWidth, height: MazleWebLayout.menuLineHeight)
                .offset(y: isOpen ? 0 : 5)
                .rotationEffect(.degrees(isOpen ? -45 : 0))
        }
        .frame(width: MazleWebLayout.menuGlyphSize, height: MazleWebLayout.menuGlyphSize)
        .animation(.easeInOut(duration: 0.3), value: isOpen)
        .accessibilityHidden(true)
    }
}

private struct WebCloseGlyph: View {
    var body: some View {
        ZStack {
            Capsule(style: .continuous)
                .frame(width: MazleWebLayout.menuLineWidth, height: MazleWebLayout.menuLineHeight)
                .rotationEffect(.degrees(45))
            Capsule(style: .continuous)
                .frame(width: MazleWebLayout.menuLineWidth, height: MazleWebLayout.menuLineHeight)
                .rotationEffect(.degrees(-45))
        }
        .frame(width: MazleWebLayout.menuGlyphSize, height: MazleWebLayout.menuGlyphSize)
        .accessibilityHidden(true)
    }
}

private enum WebFont {
    static func regular(_ size: CGFloat) -> Font { .custom("Nunito-Regular", size: size) }
    static func semibold(_ size: CGFloat) -> Font { .custom("Nunito-SemiBold", size: size) }
    static func bold(_ size: CGFloat) -> Font { .custom("Nunito-Bold", size: size) }
    static func extraBold(_ size: CGFloat) -> Font { .custom("Nunito-ExtraBold", size: size) }
    static func black(_ size: CGFloat) -> Font { .custom("Nunito-Black", size: size) }
}

private struct WebGameView: View {
    @ObservedObject var game: GameViewModel
    let puzzle: Puzzle
    @Binding var themePreference: String
    let onHelp: () -> Void
    let onMenu: () -> Void
    let onRecentPuzzles: () -> Void
    let isMenuOpen: Bool

    @State private var isPlaying = false
    @State private var playStartedAt: Date?
    @State private var showingResult = false

    var body: some View {
        ZStack {
            GeometryReader { proxy in
            let boardSize = min(
                MazleWebLayout.tabletBoardMaxSize,
                max(0, proxy.size.width - 16)
            )

            VStack(spacing: 0) {
                WebHeader(
                    puzzleNumber: game.puzzleNumber,
                    themePreference: $themePreference,
                    onHelp: onHelp,
                    onMenu: onMenu,
                    isMenuOpen: isMenuOpen
                )

                VStack(spacing: 0) {
                    Spacer(minLength: 0)

                    TimelineView(.periodic(from: Date(), by: 1)) { context in
                        WebScoreboard(
                            puzzle: puzzle,
                            game: game,
                            now: context.date,
                            playStartedAt: playStartedAt
                        )
                    }
                    .frame(height: MazleWebLayout.scoreboardHeight)
                    .padding(.bottom, 8)

                    WebMazeBoard(
                        puzzle: puzzle,
                        game: game,
                        size: boardSize,
                        isPlaying: isPlaying,
                        onStart: startPlaying
                    )
                    .frame(width: boardSize, height: boardSize)

                    // The web client reserves this slot for result/share controls
                    // even when it is visually empty during active play.
                    Color.clear
                        .frame(height: 48)
                        .padding(.top, 10)

                    Spacer(minLength: 0)
                }
                .padding(.top, 12)
                .padding(.bottom, 8)
                .frame(maxHeight: .infinity)

                WebFooter()
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            }

            if showingResult {
                WebResultView(game: game, onRecentPuzzles: {
                    showingResult = false
                    onRecentPuzzles()
                }) {
                    showingResult = false
                }
                .transition(.opacity)
            }
        }
        .onAppear {
            if game.totalMoves > 0 || game.completed {
                isPlaying = true
                playStartedAt = Date().addingTimeInterval(-TimeInterval(game.elapsedSeconds))
            }
            showingResult = game.completed
        }
        .onChange(of: game.completed) { _, completed in
            if completed {
                isPlaying = false
                showingResult = true
            }
        }
    }

    private func startPlaying() {
        guard !game.completed else { return }
        if !isPlaying {
            game.beginPlaying()
            isPlaying = true
            playStartedAt = Date()
        }
    }
}

private struct WebHeader: View {
    let puzzleNumber: Int
    @Binding var themePreference: String
    let onHelp: () -> Void
    let onMenu: () -> Void
    let isMenuOpen: Bool

    var body: some View {
        ZStack {
            HStack {
                Button(action: onHelp) {
                    WebHelpGlyph()
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Help")

                WebThemeToggle(themePreference: $themePreference)

                Spacer()

                HStack(spacing: 4) {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 18, weight: .regular))
                    Text("0")
                        .font(.system(size: 15.2, weight: .heavy, design: .rounded))
                }
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary).opacity(0.4))

                Button(action: onMenu) {
                    WebMenuGlyph(isOpen: isMenuOpen)
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Menu")
            }
            .padding(.horizontal, 16)

            VStack(spacing: 2) {
                Text("MAZLE")
                    .font(WebFont.extraBold(32.8))
                    .tracking(3.936)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    .lineLimit(1)

                Text(puzzleNumber > 0 ? "#\(puzzleNumber)" : "#000")
                    .font(WebFont.bold(14.4))
                    .tracking(2.16)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary).opacity(0.65))
            }
        }
        .frame(height: MazleWebLayout.headerHeight)
        .background(MazleWebPalette.color(MazleWebPalette.background))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Mazle puzzle \(puzzleNumber)")
    }
}

private struct WebScoreboard: View {
    let puzzle: Puzzle
    @ObservedObject var game: GameViewModel
    let now: Date
    let playStartedAt: Date?

    var body: some View {
        HStack(spacing: 15) {
            VStack(spacing: 4) {
                HStack(spacing: 4) {
                    ForEach(0..<GameViewModel.maxLives, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(
                                index < game.lives
                                    ? MazleWebPalette.color(MazleWebPalette.warning)
                                    : MazleWebPalette.color(MazleWebPalette.border).opacity(0.5)
                            )
                            .frame(width: 10, height: 10)
                            .scaleEffect(index < game.lives ? 1 : 0.8)
                    }
                }
                Text("LIVES")
                    .font(WebFont.semibold(12))
                    .tracking(0.6)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
            }
            .frame(width: 70)

            WebDivider()

            VStack(spacing: 4) {
                Text("\(max(0, puzzle.optimalMoves - game.currentAttemptMoves))")
                    .font(WebFont.bold(24))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    .monospacedDigit()
                Text("MOVES LEFT")
                    .font(WebFont.semibold(12))
                    .tracking(0.6)
                    .fixedSize(horizontal: true, vertical: false)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
            }
            .frame(width: 90)

            WebDivider()

            VStack(spacing: 4) {
                Text(elapsedString)
                    .font(WebFont.bold(24))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    .monospacedDigit()
                Text("TIME")
                    .font(WebFont.semibold(12))
                    .tracking(0.6)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
            }
            .frame(width: 76)
        }
        .frame(width: 312, height: 52)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(game.lives) lives, \(max(0, puzzle.optimalMoves - game.currentAttemptMoves)) moves left, \(elapsedString) time")
    }

    private var elapsedString: String {
        if game.completed { return game.formattedElapsedTime }
        guard let playStartedAt else { return game.formattedElapsedTime }
        let elapsed = max(0, Int(now.timeIntervalSince(playStartedAt))) + game.penaltySeconds
        return String(format: "%d:%02d", elapsed / 60, elapsed % 60)
    }
}

private struct WebDivider: View {
    var body: some View {
        Rectangle()
            .fill(MazleWebPalette.color(MazleWebPalette.border))
            .frame(width: 1, height: 32)
    }
}

private struct WebMazeBoard: View {
    let puzzle: Puzzle
    @ObservedObject var game: GameViewModel
    let size: CGFloat
    let isPlaying: Bool
    let onStart: () -> Void
    @State private var displayedPosition: GridPosition?

    var body: some View {
        ZStack {
            GeometryReader { geometry in
                let pitch = geometry.size.width / CGFloat(max(puzzle.width, puzzle.height))

                ZStack(alignment: .topLeading) {
                    ForEach(0..<puzzle.height, id: \.self) { y in
                        ForEach(0..<puzzle.width, id: \.self) { x in
                            let position = GridPosition(x: x, y: y)
                            WebTileCell(
                                tile: puzzle.tiles[y][x],
                                isPlayer: false,
                                isGoal: puzzle.goal == position,
                                cellSize: pitch
                            )
                            .frame(width: pitch, height: pitch)
                            .position(
                                x: pitch * (CGFloat(x) + 0.5),
                                y: pitch * (CGFloat(y) + 0.5)
                            )
                        }
                    }

                    if let displayedPosition {
                        WebCharacterIcon(characterId: "default", skinId: "default", size: pitch)
                            .frame(width: pitch, height: pitch)
                            .position(
                                x: pitch * (CGFloat(displayedPosition.x) + 0.5),
                                y: pitch * (CGFloat(displayedPosition.y) + 0.5)
                            )
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
            }
            .contentShape(Rectangle())
            .blur(radius: isPlaying ? 0 : 12)
            .gesture(
                DragGesture(minimumDistance: 18)
                    .onEnded { value in
                        guard isPlaying else { return }
                        game.handleSwipe(value.translation)
                    }
            )

            if !isPlaying {
                Button(action: onStart) {
                    Text("TAP TO PLAY")
                        .font(WebFont.regular(13.2))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                        .padding(.horizontal, 18)
                        .frame(height: 42)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1.5)
                        }
                        .shadow(color: .black.opacity(0.14), radius: 5, y: 2)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Tap to play")
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Mazle puzzle board")
        .accessibilityHint("Swipe up, down, left, or right to move")
        .onAppear {
            displayedPosition = game.position
        }
        .onChange(of: game.position) { _, newPosition in
            withAnimation(.easeInOut(duration: 0.22)) {
                displayedPosition = newPosition
            }
        }
    }
}

private struct WebTileCell: View {
    let tile: TileType
    let isPlayer: Bool
    let isGoal: Bool
    let cellSize: CGFloat

    private var role: MazleWebTileRole { MazleWebTileRole.forTile(tile) }

    var body: some View {
        ZStack {
            tileBase

            if role == .ice {
                IceReflection(cellSize: cellSize)
            }

            if role == .ledgeUp || role == .ledgeDown || role == .ledgeLeft || role == .ledgeRight {
                WebTriangle(direction: arrowDirection)
                    .fill(MazleWebPalette.color(MazleWebPalette.ledgeArrow))
                    .frame(width: cellSize * 0.32, height: cellSize * 0.32)
            }

            if isGoal {
                WebStar()
                    .fill(MazleWebPalette.color(MazleWebPalette.starFace))
                    .overlay {
                        WebStar().stroke(MazleWebPalette.color(MazleWebPalette.starEdge), lineWidth: max(0.5, cellSize * 0.015))
                    }
                    .frame(width: cellSize * 0.48, height: cellSize * 0.48)
            }

            if isPlayer {
                WebCharacterIcon(characterId: "default", skinId: "default", size: cellSize)
            }
        }
    }

    private var tileBase: some View {
        let edge = color(for: role, edge: true)
        let face = color(for: role, edge: false)
        let tileWidth = cellSize * 56 / 64
        let edgeRadius = cellSize * 8 / 64

        return ZStack {
            RoundedRectangle(cornerRadius: edgeRadius, style: .continuous)
                .fill(edge)
                .frame(width: tileWidth, height: tileWidth)

            RoundedRectangle(cornerRadius: edgeRadius, style: .continuous)
                .fill(face)
                .frame(width: tileWidth, height: cellSize * 52 / 64)
                .offset(y: -cellSize * 2 / 64)
        }
    }

    private var arrowDirection: Direction {
        switch role {
        case .ledgeUp: return .up
        case .ledgeDown: return .down
        case .ledgeLeft: return .left
        case .ledgeRight: return .right
        default: return .up
        }
    }

    private func color(for role: MazleWebTileRole, edge: Bool) -> Color {
        switch role {
        case .ground: return MazleWebPalette.color(edge ? MazleWebPalette.groundEdge : MazleWebPalette.groundFace)
        case .start: return MazleWebPalette.color(edge ? MazleWebPalette.startEdge : MazleWebPalette.startFace)
        case .goal: return MazleWebPalette.color(edge ? MazleWebPalette.goalEdge : MazleWebPalette.goalFace)
        case .ice: return MazleWebPalette.color(edge ? MazleWebPalette.iceEdge : MazleWebPalette.iceFace)
        case .wall: return MazleWebPalette.color(edge ? MazleWebPalette.wallEdge : MazleWebPalette.wallFace)
        case .ledgeUp, .ledgeDown, .ledgeLeft, .ledgeRight:
            return MazleWebPalette.color(edge ? MazleWebPalette.ledgeEdge : MazleWebPalette.ledgeFace)
        }
    }
}

private struct IceReflection: View {
    let cellSize: CGFloat

    var body: some View {
        Canvas { context, size in
            var primary = Path()
            primary.move(to: CGPoint(x: size.width * 0.25, y: size.height * 0.70))
            primary.addLine(to: CGPoint(x: size.width * 0.70, y: size.height * 0.25))
            context.stroke(primary, with: .color(.white.opacity(0.65)), lineWidth: max(0.5, cellSize / 64))

            var secondary = Path()
            secondary.move(to: CGPoint(x: size.width * 0.52, y: size.height * 0.78))
            secondary.addLine(to: CGPoint(x: size.width * 0.78, y: size.height * 0.52))
            context.stroke(secondary, with: .color(.white.opacity(0.65)), lineWidth: max(0.5, cellSize / 64))
        }
        .frame(width: cellSize * 56 / 64, height: cellSize * 52 / 64)
        .allowsHitTesting(false)
    }
}

private struct WebStar: Shape {
    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let inner = outer * 0.42
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

private struct WebTriangle: Shape {
    let direction: Direction

    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let halfWidth = rect.width * 0.42
        let halfHeight = rect.height * 0.42
        var path = Path()
        switch direction {
        case .up:
            path.move(to: CGPoint(x: c.x, y: c.y - halfHeight))
            path.addLine(to: CGPoint(x: c.x - halfWidth, y: c.y + halfHeight))
            path.addLine(to: CGPoint(x: c.x + halfWidth, y: c.y + halfHeight))
        case .down:
            path.move(to: CGPoint(x: c.x, y: c.y + halfHeight))
            path.addLine(to: CGPoint(x: c.x - halfWidth, y: c.y - halfHeight))
            path.addLine(to: CGPoint(x: c.x + halfWidth, y: c.y - halfHeight))
        case .left:
            path.move(to: CGPoint(x: c.x - halfWidth, y: c.y))
            path.addLine(to: CGPoint(x: c.x + halfWidth, y: c.y - halfHeight))
            path.addLine(to: CGPoint(x: c.x + halfWidth, y: c.y + halfHeight))
        case .right:
            path.move(to: CGPoint(x: c.x + halfWidth, y: c.y))
            path.addLine(to: CGPoint(x: c.x - halfWidth, y: c.y - halfHeight))
            path.addLine(to: CGPoint(x: c.x - halfWidth, y: c.y + halfHeight))
        }
        path.closeSubpath()
        return path
    }
}

private struct WebFooter: View {
    var body: some View {
        HStack(spacing: 8) {
            Text("About")
            Text("·")
            Text("Privacy")
        }
        .font(WebFont.regular(13.2))
        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
        .frame(maxWidth: .infinity)
        .frame(height: 38)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("About. Privacy")
    }
}

private struct WebLoadingView: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(MazleWebPalette.color(MazleWebPalette.secondary))
            Text("LOADING MAZLE...")
                .font(WebFont.bold(15))
                .tracking(1.2)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary).opacity(0.65))
        }
    }
}

private struct WebUnavailableView: View {
    let message: String?
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("MAZLE")
                .font(WebFont.extraBold(32.8))
                .tracking(3.936)
            Text(message ?? "The daily puzzle could not be loaded.")
                .font(.system(size: 15, design: .rounded))
                .multilineTextAlignment(.center)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .padding(.horizontal, 28)
            Button("TRY AGAIN", action: retry)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .padding(.horizontal, 20)
                .frame(height: 42)
                .background(MazleWebPalette.color(MazleWebPalette.success), in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(.white)
        }
    }
}

private struct WebHelpOverlay: View {
    let dismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.8)
                .ignoresSafeArea()

            GeometryReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        Text("HOW TO PLAY")
                            .font(WebFont.extraBold(25.6))
                            .tracking(2.56)
                            .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                            .frame(maxWidth: .infinity)
                            .frame(height: 35)
                            .padding(.bottom, 20)

                        HStack(alignment: .center, spacing: 24) {
                            WebHelpGoalTile()
                                .frame(width: 48, height: 48)
                            VStack(alignment: .leading, spacing: 0) {
                                Text("Reach the star in 10 moves.")
                                    .font(WebFont.semibold(17.6))
                                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                                    .padding(.bottom, 4)
                                Text("5 Lives. Losing a life adds a time penalty!")
                                    .font(WebFont.regular(14.4))
                                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                                Text("Solve as fast as you can!")
                                    .font(WebFont.regular(14.4))
                                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 105)
                        .overlay(alignment: .bottom) {
                            Rectangle()
                                .fill(MazleWebPalette.color(MazleWebPalette.border))
                                .frame(height: 1)
                        }
                        .padding(.bottom, 20)

                        WebHelpSection(title: "CONTROLS") {
                            HStack(spacing: 24) {
                                WebHelpExactControl(kind: .swipe, title: "Swipe")
                                WebHelpExactControl(kind: .arrows, title: "Arrow Keys")
                                WebHelpExactControl(kind: .wasd, title: "WASD")
                            }
                        }
                        .padding(.bottom, 16)

                        WebHelpSection(title: "TILES") {
                            HStack(alignment: .top, spacing: 16) {
                                VStack(spacing: 12) {
                                    WebHelpDemoRow(label: "Ice slides", kinds: [.ice, .ice, .ice], playerIndex: 0)
                                    WebHelpDemoRow(label: "Ground stops", kinds: [.ice, .ice, .ground], playerIndex: 0)
                                    WebHelpDemoRow(label: "Wall blocks", kinds: [.ice, .ice, .wall], playerIndex: 0)
                                }
                                VStack(spacing: 12) {
                                    WebHelpDemoRow(label: "Blocked", kinds: [.ice, .ice, .ledgeUp], playerIndex: 0)
                                    WebHelpLedgeDemo()
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 171.2, alignment: .top)
                        }
                        .padding(.bottom, 16)

                        WebHelpSection(title: "HINTS") {
                            Text("After you lose a life:")
                                .font(WebFont.regular(12.8))
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                                .frame(height: 18)
                                .padding(.bottom, 8)
                            HStack(spacing: 4) {
                                WebHelpMiniTile(kind: .hintDark, size: 32)
                                WebHelpMiniTile(kind: .hintLight, size: 32)
                                WebHelpMiniTile(kind: .hintLight, size: 32)
                                WebHelpMiniTile(kind: .hintDark, size: 32)
                                WebHelpMiniTile(kind: .ice, size: 32)
                            }
                            .padding(.bottom, 8)
                            Text("Correct moves from previous attempts turn green")
                                .font(WebFont.regular(12))
                                .frame(height: 16)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                        }

                        Button("Got it!", action: dismiss)
                            .font(WebFont.bold(16))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                            .background(MazleWebPalette.color(MazleWebPalette.success), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .padding(.top, 16)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 28)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 28)
                }
                .frame(width: proxy.size.width - 32, height: min(proxy.size.height - 32, 731))
                .background(MazleWebPalette.color(MazleWebPalette.background))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 2)
                }
                .shadow(color: .black.opacity(0.08), radius: 20, y: 8)
                .overlay(alignment: .topTrailing) {
                    Button(action: dismiss) {
                        WebCloseGlyph()
                            .font(.system(size: 20, weight: .regular))
                            .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                            .frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                    .padding(14)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("How to play")
        .ignoresSafeArea()
    }
}

private struct WebHelpGoalTile: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(MazleWebPalette.color(MazleWebPalette.goalEdge))
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(MazleWebPalette.color(MazleWebPalette.goalFace))
                .padding(.bottom, 6)
            WebStar()
                .fill(MazleWebPalette.color(MazleWebPalette.starFace))
                .padding(7)
        }
    }
}

private enum WebHelpControlKind {
    case swipe
    case arrows
    case wasd
}

private struct WebHelpExactControl: View {
    let kind: WebHelpControlKind
    let title: String

    var body: some View {
        VStack(spacing: 5.6) {
            Group {
                switch kind {
                case .swipe:
                    Image(systemName: "hand.draw")
                        .font(.system(size: 28, weight: .regular))
                case .arrows:
                    WebHelpKeyCluster(letters: false)
                case .wasd:
                    WebHelpKeyCluster(letters: true)
                }
            }
            .frame(height: 48)
            Text(title)
                .font(.system(size: 11.2, design: .rounded))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .lineLimit(1)
                .frame(height: 12.3)
        }
        .frame(width: 66, height: 66.7)
        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
    }
}

private struct WebHelpKeyCluster: View {
    let letters: Bool

    var body: some View {
        VStack(spacing: 2) {
            WebHelpKey(label: letters ? "W" : "▲")
            HStack(spacing: 2) {
                WebHelpKey(label: letters ? "A" : "◀")
                WebHelpKey(label: letters ? "S" : "▼")
                WebHelpKey(label: letters ? "D" : "▶")
            }
        }
    }
}

private struct WebHelpKey: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.system(size: label.count == 1 && label != "▲" && label != "▼" ? 11 : 14, weight: .bold, design: .rounded))
            .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
            .frame(width: 20, height: 20)
            .background(MazleWebPalette.color(0xF3F3F3))
            .overlay {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

private enum WebHelpMiniTileKind {
    case ice
    case ground
    case wall
    case ledgeUp
    case ledgeRight
    case hintDark
    case hintLight

    var face: UInt32 {
        switch self {
        case .ice: return MazleWebPalette.iceFace
        case .ground: return MazleWebPalette.groundFace
        case .wall: return MazleWebPalette.wallFace
        case .ledgeUp, .ledgeRight: return MazleWebPalette.ledgeFace
        case .hintDark: return MazleWebPalette.goalFace
        case .hintLight: return 0xA8D8A8
        }
    }

    var edge: UInt32 {
        switch self {
        case .ice: return MazleWebPalette.iceEdge
        case .ground: return MazleWebPalette.groundEdge
        case .wall: return 0x0A0A0A
        case .ledgeUp, .ledgeRight: return MazleWebPalette.ledgeEdge
        case .hintDark: return MazleWebPalette.successEdge
        case .hintLight: return 0x8FC98A
        }
    }
}

private struct WebHelpMiniTile: View {
    let kind: WebHelpMiniTileKind
    var size: CGFloat = 28

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 6 / 28, style: .continuous)
                .fill(MazleWebPalette.color(kind.edge))
                .frame(width: size, height: size)
            RoundedRectangle(cornerRadius: size * 6 / 28, style: .continuous)
                .fill(MazleWebPalette.color(kind.face))
                .frame(width: size, height: size - 4)
                .offset(y: -2)

            if kind == .ledgeUp {
                WebTriangle(direction: .up)
                    .fill(MazleWebPalette.color(MazleWebPalette.ledgeArrow))
                    .frame(width: size * 12 / 28, height: size * 12 / 28)
                    .offset(y: -2)
            } else if kind == .ledgeRight {
                WebTriangle(direction: .right)
                    .fill(MazleWebPalette.color(MazleWebPalette.ledgeArrow))
                    .frame(width: size * 12 / 28, height: size * 12 / 28)
                    .offset(y: -2)
            }
        }
        .frame(width: size, height: size)
    }
}

private struct WebHelpDemoRow: View {
    let label: String
    let kinds: [WebHelpMiniTileKind]
    let playerIndex: Int?

    var body: some View {
        VStack(spacing: 5) {
            HStack(spacing: 3) {
                ForEach(Array(kinds.enumerated()), id: \.offset) { index, kind in
                    ZStack {
                        WebHelpMiniTile(kind: kind)
                        if playerIndex == index {
                            WebHelpMiniPlayer()
                        }
                    }
                }
            }
            Text(label)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .lineLimit(1)
        }
    }
}

private struct WebHelpLedgeDemo: View {
    var body: some View {
        VStack(spacing: 5) {
            VStack(spacing: 3) {
                HStack(spacing: 3) {
                    ZStack { WebHelpMiniTile(kind: .ice); WebHelpMiniPlayer() }
                    WebHelpMiniTile(kind: .ice)
                    WebHelpMiniTile(kind: .ledgeRight)
                }
                HStack(spacing: 3) {
                    Color.clear.frame(width: 28, height: 28)
                    Color.clear.frame(width: 28, height: 28)
                    WebHelpMiniTile(kind: .ice)
                }
                HStack(spacing: 3) {
                    Color.clear.frame(width: 28, height: 28)
                    Color.clear.frame(width: 28, height: 28)
                    WebHelpMiniTile(kind: .ice)
                }
            }
            Text("One-way in, any out")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .lineLimit(1)
        }
    }
}

private struct WebHelpMiniPlayer: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(MazleWebPalette.color(MazleWebPalette.playerFace))
            .frame(width: 12, height: 14)
            .overlay {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .stroke(MazleWebPalette.color(MazleWebPalette.playerEdge), lineWidth: 1)
            }
            .overlay {
                HStack(spacing: 2) {
                    Circle().fill(.white).frame(width: 3, height: 3)
                    Circle().fill(.white).frame(width: 3, height: 3)
                }
                .offset(y: -2)
            }
    }
}

private struct WebHelpSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .tracking(1.2)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .frame(maxWidth: .infinity)
                .frame(height: 16)
                .padding(.bottom, 9.6)
            content()
        }
        .frame(maxWidth: .infinity)
    }
}

private struct WebHelpControl: View {
    let icon: String
    let title: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 26, weight: .regular))
                .frame(width: 42, height: 38)
            Text(title)
                .font(.system(size: 14, design: .rounded))
        }
        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
    }
}

private struct WebHelpTileLabel: View {
    let role: MazleWebTileRole
    let title: String

    var body: some View {
        VStack(spacing: 8) {
            WebLegendTile(role: role)
                .frame(width: 88, height: 48)
            Text(title)
                .font(.system(size: 13, design: .rounded))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
        .frame(maxWidth: .infinity)
    }
}

private struct WebLegendTile: View {
    let role: MazleWebTileRole

    var body: some View {
        GeometryReader { proxy in
            WebTileCell(
                tile: tile,
                isPlayer: false,
                isGoal: role == .goal,
                cellSize: proxy.size.width
            )
        }
    }

    private var tile: TileType {
        switch role {
        case .ground: return .ground
        case .start: return .start
        case .goal: return .goal
        case .ice: return .ice
        case .wall: return .wall
        case .ledgeUp: return .ledgeUp
        case .ledgeDown: return .ledgeDown
        case .ledgeLeft: return .ledgeLeft
        case .ledgeRight: return .ledgeRight
        }
    }
}

private enum WebMenuIconKind {
    case stats
    case leaderboard
    case hallOfFame
    case recentPuzzles
    case account
    case support
}

private struct WebMenuIcon: View {
    let kind: WebMenuIconKind

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
            var path = Path()

            switch kind {
            case .stats:
                path.move(to: CGPoint(x: 3, y: 3))
                path.addLine(to: CGPoint(x: 3, y: 21))
                path.addLine(to: CGPoint(x: 21, y: 21))
                path.move(to: CGPoint(x: 18, y: 17))
                path.addLine(to: CGPoint(x: 18, y: 9))
                path.move(to: CGPoint(x: 13, y: 17))
                path.addLine(to: CGPoint(x: 13, y: 5))
                path.move(to: CGPoint(x: 8, y: 17))
                path.addLine(to: CGPoint(x: 8, y: 14))
                context.stroke(path, with: .foreground, style: style)
            case .leaderboard:
                path.move(to: CGPoint(x: 3, y: 21))
                path.addLine(to: CGPoint(x: 3, y: 10))
                path.addLine(to: CGPoint(x: 9, y: 10))
                path.addLine(to: CGPoint(x: 9, y: 3))
                path.addLine(to: CGPoint(x: 15, y: 3))
                path.addLine(to: CGPoint(x: 15, y: 7))
                path.addLine(to: CGPoint(x: 21, y: 7))
                path.addLine(to: CGPoint(x: 21, y: 21))
                path.closeSubpath()
                path.move(to: CGPoint(x: 9, y: 10))
                path.addLine(to: CGPoint(x: 9, y: 21))
                path.move(to: CGPoint(x: 15, y: 7))
                path.addLine(to: CGPoint(x: 15, y: 21))
                context.stroke(path, with: .foreground, style: style)
            case .hallOfFame:
                path.move(to: CGPoint(x: 8, y: 18))
                path.addLine(to: CGPoint(x: 16, y: 18))
                path.move(to: CGPoint(x: 12, y: 12))
                path.addLine(to: CGPoint(x: 12, y: 18))
                path.move(to: CGPoint(x: 7, y: 4))
                path.addLine(to: CGPoint(x: 17, y: 4))
                path.move(to: CGPoint(x: 17, y: 4))
                path.addLine(to: CGPoint(x: 17, y: 7))
                path.addCurve(to: CGPoint(x: 7, y: 7), control1: CGPoint(x: 17, y: 13), control2: CGPoint(x: 7, y: 13))
                path.addLine(to: CGPoint(x: 7, y: 4))
                path.move(to: CGPoint(x: 5, y: 5))
                path.addCurve(to: CGPoint(x: 7, y: 7), control1: CGPoint(x: 5, y: 7), control2: CGPoint(x: 6, y: 7))
                path.move(to: CGPoint(x: 19, y: 5))
                path.addCurve(to: CGPoint(x: 17, y: 7), control1: CGPoint(x: 19, y: 7), control2: CGPoint(x: 18, y: 7))
                context.stroke(path, with: .foreground, style: style)
            case .recentPuzzles:
                path.addRoundedRect(in: CGRect(x: 3, y: 4, width: 18, height: 18), cornerSize: CGSize(width: 2, height: 2))
                path.move(to: CGPoint(x: 8, y: 2))
                path.addLine(to: CGPoint(x: 8, y: 6))
                path.move(to: CGPoint(x: 16, y: 2))
                path.addLine(to: CGPoint(x: 16, y: 6))
                path.move(to: CGPoint(x: 3, y: 10))
                path.addLine(to: CGPoint(x: 21, y: 10))
                context.stroke(path, with: .foreground, style: style)
                for point in [CGPoint(x: 8, y: 14), CGPoint(x: 12, y: 14), CGPoint(x: 16, y: 14), CGPoint(x: 8, y: 18), CGPoint(x: 12, y: 18)] {
                    context.fill(Path(ellipseIn: CGRect(x: point.x - 0.6, y: point.y - 0.6, width: 1.2, height: 1.2)), with: .foreground)
                }
            case .account:
                path.addEllipse(in: CGRect(x: 8, y: 4, width: 8, height: 8))
                path.move(to: CGPoint(x: 4, y: 20))
                path.addCurve(to: CGPoint(x: 20, y: 20), control1: CGPoint(x: 4, y: 14), control2: CGPoint(x: 20, y: 14))
                context.stroke(path, with: .foreground, style: style)
            case .support:
                path.move(to: CGPoint(x: 12, y: 21.23))
                path.addLine(to: CGPoint(x: 3.22, y: 12.39))
                path.addCurve(to: CGPoint(x: 3.22, y: 4.61), control1: CGPoint(x: -0.67, y: 8.5), control2: CGPoint(x: -0.67, y: 4.61))
                path.addCurve(to: CGPoint(x: 11, y: 4.61), control1: CGPoint(x: 7.11, y: 0.72), control2: CGPoint(x: 11, y: 4.61))
                path.addLine(to: CGPoint(x: 12, y: 5.67))
                path.addLine(to: CGPoint(x: 13.06, y: 4.61))
                path.addCurve(to: CGPoint(x: 20.84, y: 4.61), control1: CGPoint(x: 16.95, y: 0.72), control2: CGPoint(x: 20.84, y: 4.61))
                path.addCurve(to: CGPoint(x: 20.84, y: 12.39), control1: CGPoint(x: 24.73, y: 8.5), control2: CGPoint(x: 24.73, y: 12.39))
                path.closeSubpath()
                context.stroke(path, with: .foreground, style: style)
            }
        }
        .frame(width: 24, height: 24)
        .accessibilityHidden(true)
    }
}

private struct WebMenuItemButton: View {
    let title: String
    let icon: WebMenuIconKind
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Text(title)
                    .font(WebFont.bold(13.12))
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                    .allowsTightening(true)
                WebMenuIcon(kind: icon)
            }
            .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity)
            .frame(height: 35.2)
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

private struct WebMenuOverlay: View {
    let onStats: () -> Void
    let onLeaderboard: () -> Void
    let onHallOfFame: () -> Void
    let onRecentPuzzles: () -> Void
    let onAccount: () -> Void
    let onSupport: () -> Void
    let onClose: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(0.001)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: onClose)

            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    VStack(spacing: 3.2) {
                        WebMenuItemButton(title: "Stats", icon: .stats, action: onStats)
                        WebMenuItemButton(title: "Leaderboard", icon: .leaderboard, action: onLeaderboard)
                        WebMenuItemButton(title: "Hall of Fame", icon: .hallOfFame, action: onHallOfFame)
                        WebMenuItemButton(title: "Recent Puzzles", icon: .recentPuzzles, action: onRecentPuzzles)
                        WebMenuItemButton(title: "Account", icon: .account, action: onAccount)
                        WebMenuItemButton(title: "Support Us", icon: .support, action: onSupport)
                    }
                    .padding(8)
                    .frame(width: MazleWebLayout.menuDropdownWidth)
                    .background(Color(red: 243 / 255, green: 243 / 255, blue: 243 / 255).opacity(0.7), in: RoundedRectangle(cornerRadius: MazleWebLayout.menuDropdownRadius, style: .continuous))
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: MazleWebLayout.menuDropdownRadius, style: .continuous))
                    .shadow(color: .black.opacity(0.1), radius: 6, y: 4)
                    .padding(.trailing, 16)
                }
                .padding(.top, 52)
                Spacer()
            }
        }
    }
}

private struct WebDestinationOverlay: View {
    @ObservedObject var game: GameViewModel
    let destination: WebMenuDestination
    let dismiss: () -> Void

    var body: some View {
        switch destination {
        case .stats:
            WebStatsDestination(game: game, dismiss: dismiss)
        case .recentPuzzles:
            WebRecentPuzzlesDestination(game: game, dismiss: dismiss)
        case .leaderboard:
            WebLeaderboardDestination(game: game, dismiss: dismiss)
        case .hallOfFame:
            WebHallOfFameDestination(dismiss: dismiss)
        case .account:
            WebAccountDestination(dismiss: dismiss)
        case .support:
            WebSupportDestination(dismiss: dismiss)
        }
    }
}

private struct WebModalShell<Content: View>: View {
    let dismiss: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black.opacity(0.8)
                    .ignoresSafeArea()

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        HStack {
                            Spacer()
                            Button(action: dismiss) {
                                WebCloseGlyph()
                                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                                    .frame(width: 36, height: 36)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Close")
                        }
                        content()
                    }
                    .padding(28)
                }
                .frame(width: min(proxy.size.width - 32, 370))
                .frame(maxHeight: min(proxy.size.height - 32, 730))
                .background(MazleWebPalette.color(MazleWebPalette.background), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 2)
                }
                .shadow(color: .black.opacity(0.08), radius: 20, y: 8)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

private struct WebDestinationHeader: View {
    let title: String
    let icon: WebMenuIconKind
    let subtitle: String?

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(MazleWebPalette.color(MazleWebPalette.surface))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 2)
                    }
                WebMenuIcon(kind: icon)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 2) {
                Text(title.uppercased())
                    .font(WebFont.extraBold(17.6))
                    .tracking(0.35)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                if let subtitle {
                    Text(subtitle)
                        .font(WebFont.semibold(12.8))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, 16)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(MazleWebPalette.color(MazleWebPalette.border))
                .frame(height: 2)
                .mask {
                    Rectangle().stroke(style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
                }
        }
    }
}

private struct WebStatusDestination: View {
    let title: String
    let icon: WebMenuIconKind
    let message: String
    let dismiss: () -> Void

    var body: some View {
        WebModalShell(dismiss: dismiss) {
            WebDestinationHeader(title: title, icon: icon, subtitle: nil)
            Text(message)
                .font(WebFont.regular(15))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            Button("GOT IT", action: dismiss)
                .buttonStyle(WebGreenButtonStyle())
        }
    }
}

@MainActor
private struct WebLeaderboardDestination: View {
    @ObservedObject var game: GameViewModel
    let dismiss: () -> Void

    @State private var response: PublicLeaderboardResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let service = PublicMazleService.live

    private var todayDate: String { DailyDate.todayString() }
    private var todayPuzzleNumber: Int { DailyDate.puzzleNumber(for: todayDate) }

    private var podiumEntries: [PublicLeaderboardPodiumEntry] {
        guard let response else { return [] }
        if let podium = response.podium, !podium.isEmpty { return podium }
        return response.entries.prefix(3).map {
            PublicLeaderboardPodiumEntry(
                rank: $0.rank,
                displayName: $0.displayName,
                timeMs: $0.timeMs,
                attemptsUsed: $0.attemptsUsed,
                characterId: "default",
                skinId: "default",
                isMe: $0.isMe
            )
        }
    }

    var body: some View {
        WebModalShell(dismiss: dismiss) {
            WebDestinationHeader(title: "Leaderboard", icon: .leaderboard, subtitle: nil)

            VStack(spacing: 2) {
                Text("MAZLE #\(todayPuzzleNumber)")
                    .font(WebFont.extraBold(17.6))
                    .tracking(0.7)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                Text("Today")
                    .font(WebFont.bold(12.8))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)

            if isLoading {
                WebPublicLoadingCard(label: "Loading leaderboard…")
            } else if let errorMessage {
                WebPublicErrorCard(message: errorMessage, retry: {
                    Task { await reload() }
                })
            } else {
                WebPublicPodium(entries: podiumEntries)
                    .padding(.bottom, 12)

                if let response, response.entries.isEmpty {
                    Text("No entries yet — be the first!")
                        .font(WebFont.semibold(13.6))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)

                    ForEach(4..<9, id: \.self) { rank in
                        WebPublicLeaderboardRow(rank: rank, name: nil, timeMs: nil, attempts: nil)
                    }
                } else if let response {
                    ForEach(response.entries, id: \.id) { entry in
                        WebPublicLeaderboardRow(
                            rank: entry.rank,
                            name: entry.displayName,
                            timeMs: entry.timeMs,
                            attempts: entry.attemptsUsed,
                            highlighted: entry.isMe == true
                        )
                    }
                }

                Text("Times hidden until you play")
                    .font(WebFont.semibold(12.8))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)

                Text("Play today's puzzle to join the leaderboard.")
                    .font(WebFont.regular(12.8))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
            }
        }
        .task {
            await reload()
        }
    }

    private func reload() async {
        isLoading = true
        errorMessage = nil
        do {
            response = try await service.leaderboardTop(date: todayDate)
            _ = try? await service.leaderboardMe(date: todayDate)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
private struct WebHallOfFameDestination: View {
    let dismiss: () -> Void

    @State private var selectedDate = DailyDate.addingDays(-1, to: DailyDate.todayString())
    @State private var response: PublicHallOfFameResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let service = PublicMazleService.live
    private let minimumDate = DailyDate.launchDateString

    private var maximumDate: String {
        DailyDate.addingDays(-1, to: DailyDate.todayString())
    }

    private var canGoPrevious: Bool { selectedDate > minimumDate }
    private var canGoNext: Bool { selectedDate < maximumDate }

    var body: some View {
        WebModalShell(dismiss: dismiss) {
            WebDestinationHeader(title: "Hall of Fame", icon: .hallOfFame, subtitle: nil)

            HStack(spacing: 10) {
                Button {
                    guard canGoPrevious else { return }
                    selectedDate = DailyDate.addingDays(-1, to: selectedDate)
                    MazleHaptics.shared.confirm()
                } label: {
                    Text("←")
                        .font(WebFont.bold(23))
                        .foregroundStyle(MazleWebPalette.color(canGoPrevious ? MazleWebPalette.secondary : MazleWebPalette.border))
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .disabled(!canGoPrevious)
                .accessibilityLabel("Previous day")

                VStack(spacing: 2) {
                    Text("MAZLE #\(DailyDate.puzzleNumber(for: selectedDate))")
                        .font(WebFont.extraBold(17.6))
                        .tracking(0.7)
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    Text(publicDateDisplay(selectedDate))
                        .font(WebFont.bold(12.8))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                }
                .frame(maxWidth: .infinity)

                Button {
                    guard canGoNext else { return }
                    selectedDate = DailyDate.addingDays(1, to: selectedDate)
                    MazleHaptics.shared.confirm()
                } label: {
                    Text("→")
                        .font(WebFont.bold(23))
                        .foregroundStyle(MazleWebPalette.color(canGoNext ? MazleWebPalette.secondary : MazleWebPalette.border))
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .disabled(!canGoNext)
                .accessibilityLabel("Next day")
            }
            .padding(.bottom, 12)

            if isLoading {
                WebPublicLoadingCard(label: "Loading podium…")
            } else if let errorMessage {
                WebPublicErrorCard(message: errorMessage, retry: {
                    Task { await reload(date: selectedDate) }
                })
            } else if let response, response.podium.isEmpty {
                Text("No podium snapshot for this day yet.")
                    .font(WebFont.semibold(13.6))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 36)
            } else {
                WebPublicPodium(entries: response?.podium ?? [])
            }
        }
        .task(id: selectedDate) {
            await reload(date: selectedDate)
        }
    }

    private func reload(date: String) async {
        isLoading = true
        errorMessage = nil
        do {
            response = try await service.hallOfFame(date: date)
        } catch {
            response = nil
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
private struct WebAccountDestination: View {
    let dismiss: () -> Void

    @State private var account: PublicMeResponse?
    @State private var isLoading = true
    @State private var authMessage: String?
    @State private var nameDraft = ""
    @StateObject private var auth = MazleAuthManager()
    @ObservedObject private var sessionStore = MazleSessionStore.shared
    @AppStorage("mazle.leaderboardAutoSubmit") private var autoSubmitWins = false
    @AppStorage("mazle.themePreference") private var themePreference = "light"

    private let service = PublicMazleService.live

    private var accountCharacterId: String {
        account?.profile?.characterId ?? "default"
    }

    private var accountSkinId: String {
        account?.profile?.skinId ?? "default"
    }

    private var displayedPlayed: Int {
        account?.stats?.totalPlayed ?? LocalHistoryStore.entries().count
    }

    private var displayedWins: Int {
        account?.stats?.totalWins ?? LocalHistoryStore.entries().filter(\.won).count
    }

    private var displayedStreak: Int {
        account?.stats?.playedStreak ?? 0
    }

    private var selectableSkins: [String] {
        let unlocked = Set(account?.entitlements.unlockedSkins ?? [])
        return ["default", "mustard", "teal", "royal", "penguin"].filter {
            $0 == "default" || $0 == "mustard" || $0 == "teal" || unlocked.contains($0)
        }
    }

    var body: some View {
        WebModalShell(dismiss: dismiss) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(MazleWebPalette.color(MazleWebPalette.surface))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 2)
                        }
                    WebCharacterIcon(characterId: accountCharacterId, skinId: accountSkinId, size: 50)
                        .frame(width: 50, height: 50)
                }
                .frame(width: 72, height: 72)

                VStack(alignment: .leading, spacing: 3) {
                    Text("YOU")
                        .font(WebFont.extraBold(10.4))
                        .tracking(1.1)
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                    Text(account?.displayName ?? "Guest")
                        .font(WebFont.extraBold(20))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    Text(account?.mode == "user" ? "Account" : "Guest")
                        .font(WebFont.semibold(12.8))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.bottom, 16)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(MazleWebPalette.color(MazleWebPalette.border))
                    .frame(height: 2)
                    .mask { Rectangle().stroke(style: StrokeStyle(lineWidth: 2, dash: [5, 4])) }
            }

            Text("CLASSIC")
                .font(WebFont.extraBold(12.8))
                .tracking(1.35)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 18)

            Text("Save your name, earn skins, and sync across devices.")
                .font(WebFont.regular(13.6))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .multilineTextAlignment(.center)
                .padding(.vertical, 8)

            HStack(spacing: 8) {
                WebAccountMetric(label: "PLAYED", value: "\(displayedPlayed)")
                WebAccountMetric(label: "WINS", value: "\(displayedWins)")
                WebAccountMetric(label: "STREAK", value: "\(displayedStreak)")
            }
            .padding(.bottom, 12)

            if account?.mode == "user" {
                Menu {
                    ForEach(selectableSkins, id: \.self) { skin in
                        Button(skin.capitalized) {
                            Task { await saveSkin(skin) }
                        }
                    }
                } label: {
                    HStack {
                        Text("CHARACTER SKIN")
                            .font(WebFont.extraBold(11.2))
                            .tracking(0.8)
                        Spacer()
                        Text(accountSkinId.uppercased())
                            .font(WebFont.extraBold(11.2))
                            .tracking(0.6)
                    }
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    .padding(12)
                    .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
                .padding(.bottom, 8)

                HStack(spacing: 8) {
                    TextField("Display name", text: $nameDraft)
                        .font(WebFont.regular(14.4))
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 10)
                        .frame(height: 38)
                        .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
                        }
                    Button("SAVE") {
                        Task { await saveDisplayName() }
                    }
                    .buttonStyle(WebGreenButtonStyle())
                    .disabled(nameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.bottom, 8)
            }

            VStack(spacing: 8) {
                if auth.isSignedIn {
                    Button("SIGN OUT") {
                        MazleHaptics.shared.confirm()
                        auth.signOut()
                        account = nil
                        authMessage = "Signed out on this device."
                    }
                    .buttonStyle(WebOutlineButtonStyle())
                    .frame(maxWidth: .infinity)
                } else {
                    Button("SIGN IN WITH GOOGLE") {
                        MazleHaptics.shared.confirm()
                        authMessage = nil
                        auth.signIn(provider: "google")
                    }
                    .buttonStyle(WebGreenButtonStyle())
                    .frame(maxWidth: .infinity)

                    Button("SIGN IN WITH APPLE") {
                        MazleHaptics.shared.confirm()
                        authMessage = nil
                        auth.signIn(provider: "apple")
                    }
                    .buttonStyle(WebOutlineButtonStyle())
                    .frame(maxWidth: .infinity)
                }
            }

            if auth.isAuthenticating {
                ProgressView("Opening secure sign-in…")
                    .font(WebFont.regular(12.2))
                    .tint(MazleWebPalette.color(MazleWebPalette.secondary))
                    .padding(.top, 10)
            }

            if let authError = auth.errorMessage {
                Text(authError)
                    .font(WebFont.regular(12.2))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.warning))
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
            }

            if let authMessage {
                Text(authMessage)
                    .font(WebFont.regular(12.2))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
            }

            Text("SETTINGS")
                .font(WebFont.extraBold(12.8))
                .tracking(1.35)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 24)
                .padding(.bottom, 8)

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Theme")
                        .font(WebFont.bold(14.4))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    Text(themePreference.capitalized)
                        .font(WebFont.regular(12.2))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                }
                Spacer()
                Menu {
                    ForEach(["system", "light", "dark"], id: \.self) { option in
                        Button(option.capitalized) {
                            themePreference = option
                            MazleHaptics.shared.confirm()
                        }
                    }
                } label: {
                    Text(themePreference.uppercased())
                        .font(WebFont.extraBold(10.4))
                        .tracking(0.6)
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1.5)
                        }
                }
            }
            .padding(12)
            .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
            }

            Toggle(isOn: $autoSubmitWins) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Auto-Submit")
                        .font(WebFont.bold(14.4))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    Text("Auto-submit wins to leaderboard")
                        .font(WebFont.regular(12.2))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                }
            }
            .tint(MazleWebPalette.color(MazleWebPalette.success))
            .padding(12)
            .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
            }
        }
        .task(id: sessionStore.session?.accessToken) {
            await loadAccount()
        }
        .onChange(of: autoSubmitWins) { _, newValue in
            guard let session = sessionStore.session, !session.isExpired else { return }
            Task {
                _ = try? await AuthenticatedMazleService(session: session)
                    .updateSettings(theme: nil, leaderboardAutoSubmit: newValue)
            }
        }
        .onChange(of: themePreference) { _, newValue in
            guard let session = sessionStore.session, !session.isExpired else { return }
            Task {
                _ = try? await AuthenticatedMazleService(session: session)
                    .updateSettings(theme: newValue, leaderboardAutoSubmit: nil)
            }
        }
    }

    private func saveDisplayName() async {
        guard let session = sessionStore.session, !session.isExpired else { return }
        let requestedName = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !requestedName.isEmpty else { return }
        do {
            _ = try await AuthenticatedMazleService(session: session)
                .claimDisplayName(requestedName)
            authMessage = "Display name saved."
            await loadAccount()
        } catch {
            authMessage = error.localizedDescription
        }
    }

    private func saveSkin(_ skin: String) async {
        guard let session = sessionStore.session, !session.isExpired else { return }
        do {
            _ = try await AuthenticatedMazleService(session: session)
                .updateProfile(characterId: accountCharacterId, skinId: skin)
            await loadAccount()
        } catch {
            authMessage = error.localizedDescription
        }
    }

    private func loadAccount() async {
        isLoading = true
        defer { isLoading = false }

        do {
            if let session = sessionStore.session, !session.isExpired {
                let authenticated = AuthenticatedMazleService(session: session)
                let fresh = try await authenticated.me()
                account = fresh
                nameDraft = fresh.displayName
                if let settings = fresh.settings {
                    autoSubmitWins = settings.leaderboardAutoSubmit
                    themePreference = settings.theme
                }
                let localEntries = LocalHistoryStore.entries()
                if !localEntries.isEmpty {
                    _ = try? await authenticated.importHistory(localEntries)
                }
            } else {
                account = try await service.me()
            }
        } catch {
            authMessage = error.localizedDescription
            if account == nil {
                account = nil
            }
        }
    }
}

private struct WebAccountMetric: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(WebFont.extraBold(17))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
            Text(label)
                .font(WebFont.extraBold(9.2))
                .tracking(0.7)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
        }
    }
}

@MainActor
private struct WebSupportDestination: View {
    let dismiss: () -> Void

    @StateObject private var store = StoreKitManager()

    var body: some View {
        WebModalShell(dismiss: dismiss) {
            WebDestinationHeader(title: "Support Us", icon: .support, subtitle: nil)

            Text("Unlock the Mazle archive and support development.")
                .font(WebFont.regular(14.4))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 16)

            if store.isLoading {
                WebPublicLoadingCard(label: "Loading App Store products…")
            } else if store.products.isEmpty {
                WebPublicErrorCard(
                    message: store.errorMessage ?? "StoreKit products are not available in this build.",
                    retry: { Task { await store.prepare() } }
                )
            } else {
                VStack(spacing: 10) {
                    ForEach(store.products, id: \.id) { product in
                        Button {
                            Task { await store.purchase(product) }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(product.displayName.uppercased())
                                        .font(WebFont.extraBold(12.8))
                                        .tracking(0.8)
                                    Text(product.description)
                                        .font(WebFont.regular(11.8))
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                }
                                Spacer()
                                Text(product.displayPrice)
                                    .font(WebFont.extraBold(14.4))
                            }
                            .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                            .padding(12)
                            .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(store.purchasedProductIDs.contains(product.id))
                        .opacity(store.purchasedProductIDs.contains(product.id) ? 0.55 : 1)
                    }
                }
            }

            if store.serverEntitlement?.archiveAccess == true {
                Text("ARCHIVE ACCESS ACTIVE")
                    .font(WebFont.extraBold(12.8))
                    .tracking(0.8)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.success))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
            } else if store.hasArchiveAccess {
                Text("DEVICE PURCHASE VERIFIED — ACCOUNT SYNC PENDING")
                    .font(WebFont.extraBold(11.2))
                    .tracking(0.7)
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.warning))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
            }

            Button(store.isRestoring ? "RESTORING…" : "RESTORE PURCHASES") {
                Task { await store.restorePurchases() }
            }
            .buttonStyle(WebOutlineButtonStyle())
            .disabled(store.isRestoring)
            .padding(.top, 14)

            if let errorMessage = store.errorMessage {
                Text(errorMessage)
                    .font(WebFont.regular(12.2))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.warning))
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
            }

            Text("Purchases are handled by Apple on iOS. Server entitlement verification is required before archive access is granted across devices.")
                .font(WebFont.regular(11.4))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .multilineTextAlignment(.center)
                .padding(.top, 16)
        }
        .task {
            await store.prepare()
        }
    }
}

private struct WebPublicLoadingCard: View {
    let label: String

    var body: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(MazleWebPalette.color(MazleWebPalette.secondary))
            Text(label)
                .font(WebFont.semibold(13.6))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}

private struct WebPublicErrorCard: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text("UNAVAILABLE")
                .font(WebFont.extraBold(12.8))
                .tracking(1.1)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
            Text(message)
                .font(WebFont.regular(12.8))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .multilineTextAlignment(.center)
            Button("TRY AGAIN", action: retry)
                .buttonStyle(WebOutlineButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
        }
    }
}

private struct WebPublicPodium: View {
    let entries: [PublicLeaderboardPodiumEntry]

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            WebPublicPodiumColumn(entry: entry(for: 2), rank: 2, color: Color.gray.opacity(0.34), height: 46)
            WebPublicPodiumColumn(entry: entry(for: 1), rank: 1, color: Color.yellow.opacity(0.58), height: 60)
            WebPublicPodiumColumn(entry: entry(for: 3), rank: 3, color: Color.orange.opacity(0.55), height: 38)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 8)
    }

    private func entry(for rank: Int) -> PublicLeaderboardPodiumEntry? {
        entries.first { $0.rank == rank }
    }
}

private struct WebPublicPodiumColumn: View {
    let entry: PublicLeaderboardPodiumEntry?
    let rank: Int
    let color: Color
    let height: CGFloat

    var body: some View {
        VStack(spacing: 3) {
            if entry != nil {
                WebCharacterIcon(
                    characterId: entry?.characterId ?? "default",
                    skinId: entry?.skinId ?? "default",
                    size: rank == 1 ? 44 : 38
                )
                    .frame(width: rank == 1 ? 44 : 38, height: rank == 1 ? 44 : 38)
            } else {
                Color.clear.frame(width: rank == 1 ? 44 : 38, height: rank == 1 ? 44 : 38)
            }
            Text(entry?.displayName ?? "—")
                .font(WebFont.bold(11.2))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            VStack(spacing: 2) {
                Text(rank == 1 ? "🥇" : rank == 2 ? "🥈" : "🥉")
                    .font(.system(size: 14))
                Text(entry.map { publicTime($0.timeMs) } ?? "—")
                    .font(WebFont.bold(10.4))
                    .monospacedDigit()
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .padding(.top, 4)
            .background(color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .frame(maxWidth: .infinity)
    }
}

private struct WebPublicLeaderboardRow: View {
    let rank: Int
    let name: String?
    let timeMs: Int?
    let attempts: Int?
    var highlighted = false

    var body: some View {
        HStack(spacing: 8) {
            Text("#\(rank)")
                .font(WebFont.bold(12.8))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .frame(width: 34, alignment: .leading)
            Text(name ?? "—")
                .font(WebFont.bold(13.6))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(timeMs.map(publicTime) ?? "—")
                .font(WebFont.bold(12.8))
                .monospacedDigit()
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
            Text(attempts.map { "\($0)/5" } ?? "—")
                .font(WebFont.bold(12.2))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .frame(width: 28, alignment: .trailing)
        }
        .padding(.horizontal, 10)
        .frame(height: 36)
        .background(MazleWebPalette.color(highlighted ? 0xE4F2E1 : MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
        }
    }
}

private func publicTime(_ milliseconds: Int) -> String {
    let totalSeconds = milliseconds / 1000
    let minutes = totalSeconds / 60
    let seconds = totalSeconds % 60
    let millis = milliseconds % 1000
    return String(format: "%d:%02d.%03d", minutes, seconds, millis)
}

private func publicDateDisplay(_ dateString: String) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    guard let date = formatter.date(from: dateString) else { return dateString }
    formatter.dateFormat = "MMM d, yyyy"
    return formatter.string(from: date)
}

@MainActor
private struct WebStatsDestination: View {
    @ObservedObject var game: GameViewModel
    let dismiss: () -> Void

    private var history: [LocalHistoryEntry] { LocalHistoryStore.entries() }
    private var totalPlayed: Int { history.count }
    private var totalWins: Int { history.filter(\.won).count }
    private var winRate: Int { totalPlayed == 0 ? 0 : Int((Double(totalWins) / Double(totalPlayed) * 100).rounded()) }
    private var averageTime: String {
        let times = history.compactMap(\.timeSeconds)
        guard !times.isEmpty else { return "—" }
        let average = times.reduce(0, +) / times.count
        return String(format: "%d:%02d", average / 60, average % 60)
    }
    private var streak: Int {
        var count = 0
        for entry in history.reversed() {
            guard entry.won else { break }
            count += 1
        }
        return count
    }
    private var maxStreak: Int {
        var best = 0
        var current = 0
        for entry in history {
            if entry.won {
                current += 1
                best = max(best, current)
            } else {
                current = 0
            }
        }
        return best
    }

    var body: some View {
        WebModalShell(dismiss: dismiss) {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(MazleWebPalette.color(MazleWebPalette.surface))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 2)
                        }
                    WebCharacterIcon(characterId: "default", skinId: "default", size: 64)
                        .frame(width: 64, height: 64)
                }
                .frame(width: 80, height: 80)

                VStack(alignment: .leading, spacing: 3) {
                    Text("PLAYER CARD")
                        .font(WebFont.extraBold(9.6))
                        .tracking(1.15)
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                    Text("GUEST TRAINER")
                        .font(WebFont.extraBold(20))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    Text("ID #LOCAL")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.bottom, 20)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(MazleWebPalette.color(MazleWebPalette.border))
                    .frame(height: 2)
                    .mask { Rectangle().stroke(style: StrokeStyle(lineWidth: 2, dash: [5, 4])) }
            }

            Text("PERFORMANCE")
                .font(WebFont.extraBold(12.8))
                .tracking(1.54)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 20)
                .padding(.bottom, 12)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                WebStatChip(value: "\(totalPlayed)", label: "Solved")
                WebStatChip(value: "\(winRate)%", label: "Win Rate")
                WebStatChip(value: averageTime, label: "Avg Time")
                WebStatChip(value: "\(streak)", label: "Streak")
                WebStatChip(value: "\(maxStreak)", label: "Max Streak")
                WebStatChip(value: "\(game.puzzleNumber)", label: "Today")
            }

            Text("RECENT GAMES")
                .font(WebFont.extraBold(12.8))
                .tracking(1.54)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 24)
                .padding(.bottom, 10)

            if history.isEmpty {
                Text("No recent games yet.")
                    .font(WebFont.regular(14.4))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(spacing: 6) {
                    ForEach(history.suffix(5).reversed()) { entry in
                        HStack {
                            Text("#\(entry.puzzleNumber)")
                                .font(.system(size: 13, weight: .bold, design: .monospaced))
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                            Text(entry.won ? formatWebDuration(entry.timeSeconds) : "—")
                                .font(WebFont.bold(14.4))
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                            Spacer()
                            Text(entry.won ? "\(entry.attemptsUsed)/5" : "DNF")
                                .font(WebFont.bold(13.6))
                                .foregroundStyle(entry.won
                                    ? MazleWebPalette.color(MazleWebPalette.success)
                                    : MazleWebPalette.color(MazleWebPalette.secondary))
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
                        }
                    }
                }
            }
        }
    }
}

private struct WebStatChip: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(WebFont.extraBold(17.6))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            Text(label.uppercased())
                .font(WebFont.bold(8))
                .tracking(0.4)
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 64)
        .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
        }
    }
}

@MainActor
private struct WebRecentPuzzlesDestination: View {
    @ObservedObject var game: GameViewModel
    let dismiss: () -> Void

    @State private var attemptedDate: String?
    @State private var archiveError: String?

    private var historyByDate: [String: LocalHistoryEntry] {
        Dictionary(uniqueKeysWithValues: LocalHistoryStore.entries().map { ($0.date, $0) })
    }

    private var recentDates: [String] {
        let today = DailyDate.todayString()
        return (1...7).map { DailyDate.addingDays(-$0, to: today) }
    }

    var body: some View {
        WebModalShell(dismiss: dismiss) {
            WebDestinationHeader(
                title: "Recent Puzzles",
                icon: .recentPuzzles,
                subtitle: "\(recentDates.filter { historyByDate[$0] == nil }.count) puzzle(s) to play"
            )

            if let archiveError {
                VStack(spacing: 8) {
                    Text("LOCKED DAY")
                        .font(WebFont.extraBold(12.8))
                        .tracking(1.1)
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                    Text(archiveError)
                        .font(WebFont.regular(12.8))
                        .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                        .multilineTextAlignment(.center)
                    Button("BACK TO TODAY", action: dismiss)
                        .buttonStyle(WebGreenButtonStyle())
                }
                .frame(maxWidth: .infinity)
                .padding(12)
                .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 10).stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 2) }
                .padding(.bottom, 10)
            }

            if !game.completed && game.totalMoves > 0 {
                Text("Finish current puzzle first")
                    .font(WebFont.semibold(12.8))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 10).stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 2) }
                    .padding(.bottom, 10)
            }

            VStack(spacing: 8) {
                ForEach(recentDates, id: \.self) { date in
                    let entry = historyByDate[date]
                    HStack(spacing: 10) {
                        Text("#\(DailyDate.puzzleNumber(for: date))")
                            .font(.system(size: 16, weight: .bold, design: .monospaced))
                            .foregroundStyle(MazleWebPalette.color(entry == nil ? MazleWebPalette.text : MazleWebPalette.secondary))
                            .frame(width: 58, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(relativePuzzleDate(date))
                                .font(WebFont.bold(12.8))
                            Text(date)
                                .font(.system(size: 10.4, design: .monospaced))
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                        }
                        Spacer()
                        if let entry {
                            Text(entry.won ? formatWebDuration(entry.timeSeconds) : "DNF")
                                .font(WebFont.bold(13.6))
                                .foregroundStyle(MazleWebPalette.color(entry.won ? MazleWebPalette.success : MazleWebPalette.secondary))
                        } else {
                            Button {
                                MazleHaptics.shared.confirm()
                                attemptedDate = date
                                Task {
                                    await game.load(date: date)
                                    if game.dailyDate == date {
                                        dismiss()
                                    } else {
                                        archiveError = game.errorMessage ?? "This day is locked. Unlock the archive to play past puzzles."
                                    }
                                }
                            } label: {
                                Text(attemptedDate == date && archiveError != nil ? "LOCKED" : game.isLoading && attemptedDate == date ? "LOADING" : "PLAY")
                                    .font(WebFont.extraBold(11.2))
                                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                                    .padding(.horizontal, 10)
                                    .frame(height: 30)
                                    .overlay { RoundedRectangle(cornerRadius: 8).stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1.5) }
                            }
                            .buttonStyle(.plain)
                            .disabled((!game.completed && game.totalMoves > 0) || game.isLoading || (attemptedDate == date && archiveError != nil))
                        }
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 54)
                    .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 10).stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1) }
                }
            }

            Text("These puzzles are always free to play")
                .font(WebFont.regular(12.8))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .padding(.top, 18)
        }
    }
}

private func formatWebDuration(_ seconds: Int?) -> String {
    guard let seconds else { return "—" }
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
}

private func relativePuzzleDate(_ date: String) -> String {
    let today = DailyDate.todayString()
    switch DailyDate.daysBetween(date, and: today) {
    case 1: return "Yesterday"
    case let days? where days > 1: return "\(days) days ago"
    default: return "Recent puzzle"
    }
}

private func webResultCountdown(from date: Date) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .current
    let startOfToday = calendar.startOfDay(for: date)
    guard let nextPuzzle = calendar.date(byAdding: .day, value: 1, to: startOfToday) else {
        return "00:00"
    }

    let totalSeconds = max(0, Int(nextPuzzle.timeIntervalSince(date)))
    let hours = totalSeconds / 3600
    let minutes = (totalSeconds % 3600) / 60
    let seconds = totalSeconds % 60
    return hours > 0
        ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
        : String(format: "%02d:%02d", minutes, seconds)
}

private struct WebResultView: View {
    @ObservedObject var game: GameViewModel
    let onRecentPuzzles: () -> Void
    let onClose: () -> Void

    @Environment(\.openURL) private var openURL
    @State private var showingFeedback = false

    private var optimalMoves: Int { max(1, game.puzzle?.optimalMoves ?? 10) }
    private var mapEmoji: String {
        game.puzzle?.tiles.flatMap { $0 }.contains(.ice) == true ? "🧊" : "🟤"
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black.opacity(0.8)
                    .ignoresSafeArea()

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        HStack {
                            Spacer()
                            Button(action: onClose) {
                                WebCloseGlyph()
                                    .font(.system(size: 20, weight: .regular))
                                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                                    .frame(width: 32, height: 32)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Close")
                        }

                        WebResultCharacter(won: game.won)
                            .frame(height: 72)
                            .padding(.bottom, 4)

                        Text(game.won ? "VICTORY" : "GAME OVER")
                            .font(WebFont.extraBold(25.6))
                            .tracking(1.6)
                            .foregroundStyle(game.won
                                ? MazleWebPalette.color(MazleWebPalette.success)
                                : MazleWebPalette.color(MazleWebPalette.playerEdge))

                        Text("\(mapEmoji) Mazle #\(game.puzzleNumber)")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .tracking(1.1)
                            .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                            .padding(.top, 3)

                        VStack(spacing: 0) {
                            Text(game.formattedElapsedTime)
                                .font(.system(size: 38, weight: .heavy, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                            Text("TOTAL TIME")
                                .font(.system(size: 12.8, weight: .semibold, design: .rounded))
                                .tracking(1.2)
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                        }
                        .padding(.top, 12)
                        .padding(.bottom, 12)

                        if !game.won {
                            Text("Best Attempt: \(bestAttempt)/\(optimalMoves) moves")
                                .font(WebFont.regular(14.4))
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                                .padding(.bottom, 12)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("ATTEMPTS")
                                .font(.system(size: 12.8, weight: .bold, design: .rounded))
                                .tracking(1.1)
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                            ForEach(Array(attemptRows.enumerated()), id: \.offset) { index, row in
                                HStack(spacing: 8) {
                                    Text("\(index + 1)")
                                        .font(.system(size: 12.8, weight: .bold, design: .rounded))
                                        .frame(width: 14)
                                    GeometryReader { rowProxy in
                                        ZStack(alignment: .leading) {
                                            Capsule(style: .continuous)
                                                .fill(MazleWebPalette.color(MazleWebPalette.border))
                                            Capsule(style: .continuous)
                                                .fill(row.success
                                                    ? MazleWebPalette.color(MazleWebPalette.success)
                                                    : MazleWebPalette.color(MazleWebPalette.warning))
                                                .frame(width: rowProxy.size.width * CGFloat(row.progress) / CGFloat(optimalMoves))
                                        }
                                    }
                                    .frame(height: 10)
                                    Text("\(row.progress)/\(optimalMoves)")
                                        .font(.system(size: 12.8, weight: .bold, design: .rounded))
                                        .monospacedDigit()
                                        .frame(width: 38, alignment: .trailing)
                                }
                                .frame(height: 18)
                            }
                        }
                        .padding(12)
                        .background(MazleWebPalette.color(0xF3F3F3), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
                        }
                        .padding(.bottom, 12)

                        VStack(spacing: 8) {
                            HStack(spacing: 12) {
                                ShareLink(item: game.shareText) {
                                    Label("SEND SCORE", systemImage: "square.and.arrow.up")
                                }
                                .buttonStyle(WebGreenButtonStyle())

                                Button("DONE", action: onClose)
                                    .buttonStyle(WebOutlineButtonStyle())
                            }

                            Button("RECENT PUZZLES", action: onRecentPuzzles)
                                .buttonStyle(WebOutlineButtonStyle())
                                .frame(maxWidth: .infinity)
                        }

                        VStack(spacing: 8) {
                            Text("Help us keep building new features!")
                                .font(WebFont.regular(12.8))
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))

                            HStack(spacing: 16) {
                                Button("Buy us a coffee") {
                                    guard let url = URL(string: "https://ko-fi.com/mazle") else { return }
                                    openURL(url)
                                }
                                .accessibilityLabel("Buy us a coffee")

                                Button("Share feedback") {
                                    showingFeedback = true
                                }
                                .accessibilityLabel("Share feedback")
                            }
                            .font(WebFont.regular(12))
                            .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                            .underline()
                        }
                        .padding(.top, 16)

                        VStack(spacing: 4) {
                            TimelineView(.periodic(from: Date(), by: 1)) { context in
                                Text("Next puzzle in \(webResultCountdown(from: context.date))")
                                    .font(WebFont.semibold(13.6))
                                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
                            }
                            Text("Play the last 7 days of puzzles")
                                .font(WebFont.regular(12))
                                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                        .padding(.bottom, 4)
                    }
                    .padding(28)
                }
                .frame(width: proxy.size.width - 32, height: min(proxy.size.height - 32, 760))
                .background(MazleWebPalette.color(MazleWebPalette.background))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(
                            game.won
                                ? MazleWebPalette.color(MazleWebPalette.success)
                                : MazleWebPalette.color(MazleWebPalette.playerEdge),
                            lineWidth: 3
                        )
                }
                .shadow(color: .black.opacity(0.08), radius: 20, y: 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if showingFeedback {
                    WebFeedbackOverlay(game: game) {
                        showingFeedback = false
                    }
                    .transition(.opacity)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(game.won ? "Victory" : "Game over")
    }

    private var bestAttempt: Int {
        game.attempts.map(\.moveCount).max() ?? 0
    }

    private var attemptRows: [(progress: Int, success: Bool)] {
        let failures = game.attempts.map { (progress: min(max(0, $0.moveCount), optimalMoves), success: false) }
        if game.won { return failures + [(progress: optimalMoves, success: true)] }
        return failures
    }
}

private enum WebFeedbackState: Equatable {
    case idle
    case sending
    case sent
    case error(String)
}

private struct WebFeedbackOverlay: View {
    @ObservedObject var game: GameViewModel
    let dismiss: () -> Void

    @State private var feedbackText = ""
    @State private var rating: Int?
    @State private var state: WebFeedbackState = .idle

    private let service = PublicMazleService.live

    private var canSubmit: Bool {
        !feedbackText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || rating != nil
    }

    private var isSending: Bool {
        if case .sending = state { return true }
        return false
    }

    private var errorMessage: String? {
        if case .error(let message) = state { return message }
        return nil
    }

    var body: some View {
        WebModalShell(dismiss: dismiss) {
            WebDestinationHeader(title: "Share feedback", icon: .support, subtitle: nil)

            Text("Rate your experience (optional):")
                .font(WebFont.semibold(13.6))
                .foregroundStyle(MazleWebPalette.color(MazleWebPalette.secondary))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 12)

            HStack(spacing: 4) {
                ForEach(1...5, id: \.self) { value in
                    Button {
                        rating = value
                        MazleHaptics.shared.confirm()
                    } label: {
                        Text(rating.map { value <= $0 ? "★" : "☆" } ?? "☆")
                            .font(WebFont.bold(28))
                            .foregroundStyle(
                                rating.map { value <= $0 ? MazleWebPalette.color(MazleWebPalette.warning) : MazleWebPalette.color(MazleWebPalette.border) }
                                    ?? MazleWebPalette.color(MazleWebPalette.border)
                            )
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .disabled(isSending || state == .sent)
                    .accessibilityLabel("Rate \(value) star\(value == 1 ? "" : "s")")
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)

            TextEditor(text: $feedbackText)
                .font(WebFont.regular(14))
                .frame(height: 124)
                .padding(8)
                .background(MazleWebPalette.color(MazleWebPalette.surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1)
                }
                .disabled(isSending || state == .sent)
                .accessibilityLabel("Feedback message")

            if let errorMessage {
                Text(errorMessage)
                    .font(WebFont.regular(12.8))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.playerEdge))
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
            }

            if state == .sent {
                Text("Thanks for helping us improve Mazle!")
                    .font(WebFont.semibold(13.6))
                    .foregroundStyle(MazleWebPalette.color(MazleWebPalette.success))
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
            }

            HStack(spacing: 10) {
                if state == .sent {
                    Button("DONE", action: dismiss)
                        .buttonStyle(WebGreenButtonStyle())
                } else {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack(spacing: 6) {
                            if isSending { ProgressView().tint(.white) }
                            Text(isSending ? "SENDING…" : "SEND FEEDBACK")
                        }
                    }
                    .buttonStyle(WebGreenButtonStyle())
                    .disabled(!canSubmit || isSending)

                    Button("CANCEL", action: dismiss)
                        .buttonStyle(WebOutlineButtonStyle())
                        .disabled(isSending)
                }
            }
            .padding(.top, 14)
        }
    }

    private func submit() async {
        guard canSubmit else { return }
        state = .sending
        do {
            try await service.submitFeedback(
                message: feedbackText.trimmingCharacters(in: .whitespacesAndNewlines),
                puzzleLabel: "Mazle #\(game.puzzleNumber)",
                failed: !game.won,
                attempts: game.attemptsUsed,
                timeMs: game.elapsedSeconds * 1_000,
                optimalMoves: max(1, game.puzzle?.optimalMoves ?? 10),
                attemptScores: game.attempts.map(\.moveCount),
                rating: rating
            )
            state = .sent
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}

private struct WebResultCharacter: View {
    let won: Bool

    var body: some View {
        ZStack(alignment: .top) {
            WebCharacterIcon(characterId: "default", skinId: "default", size: 64)
                .frame(width: 64, height: 64)
            if won {
                WebStar()
                    .fill(MazleWebPalette.color(MazleWebPalette.starFace))
                    .overlay {
                        WebStar().stroke(MazleWebPalette.color(MazleWebPalette.starEdge), lineWidth: 1)
                    }
                    .frame(width: 28, height: 28)
                    .offset(y: -18)
            }
        }
    }
}

private struct WebGreenButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .frame(height: 42)
            .background(MazleWebPalette.color(MazleWebPalette.success), in: RoundedRectangle(cornerRadius: 10))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

private struct WebOutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .foregroundStyle(MazleWebPalette.color(MazleWebPalette.text))
            .padding(.horizontal, 20)
            .frame(height: 42)
            .background(MazleWebPalette.color(MazleWebPalette.background), in: RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(MazleWebPalette.color(MazleWebPalette.border), lineWidth: 1.5)
            }
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

private struct PremiumView: View {
    @EnvironmentObject private var store: StoreKitManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("Archive access", systemImage: "archivebox.fill")
                        .font(.headline)
                    Text("The iOS purchase path is StoreKit 2. Product verification and server entitlement sync will be connected before release.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section("Products") {
                    if store.isLoading {
                        ProgressView("Loading App Store products…")
                    } else if store.products.isEmpty {
                        Text("No StoreKit products are configured in this build yet.")
                            .foregroundStyle(.secondary)
                        Text(StoreKitManager.ProductID.all.joined(separator: "\n"))
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.products, id: \.id) { product in
                            Button {
                                Task { await store.purchase(product) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(product.displayName)
                                        Text(product.description)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(product.displayPrice)
                                        .fontWeight(.semibold)
                                }
                            }
                        }
                    }
                }

                if store.hasArchiveAccess {
                    Section {
                        Label("Archive access unlocked", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }

                if let message = store.errorMessage {
                    Section {
                        Text(message)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Mazle Premium")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await store.prepare()
            }
        }
    }
}
