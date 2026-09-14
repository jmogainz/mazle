import SwiftUI

/// Geometry and rendering constants measured from the live Mazle web client.
enum MazleWebLayout {
    static let boardColumns = 15
    static let boardRows = 15
    static let boardAspectRatio: CGFloat = 1
    static let headerHeight: CGFloat = 82
    static let scoreboardHeight: CGFloat = 52
    static let boardHorizontalInset: CGFloat = 8
    static let tabletBoardMaxSize: CGFloat = 520
    static let boardCornerRadius: CGFloat = 10
    static let tilePitch: CGFloat = 64
    static let tileInset: CGFloat = 2
    static let tileCornerRadius: CGFloat = 8
    static let tileDepth: CGFloat = 4
    // Phaser draws the default player in a 64px tile using the original
    // 32px-wide / 36px-tall character geometry (s = TILE_SIZE / 32).
    static let playerBodyWidthRatio: CGFloat = 32.0 / 64.0
    static let playerBodyHeightRatio: CGFloat = 36.0 / 64.0
    static let playerBodyCornerRadiusRatio: CGFloat = 6.0 / 64.0
    static let playerEyeDiameterRatio: CGFloat = 12.0 / 64.0
    static let playerPupilDiameterRatio: CGFloat = 6.0 / 64.0
    static let playerShadowWidthRatio: CGFloat = 32.0 / 64.0
    static let playerShadowHeightRatio: CGFloat = 12.0 / 64.0
    static let playerShadowOffsetRatio: CGFloat = 8.0 / 64.0
    static let menuButtonSize: CGFloat = 44
    static let menuGlyphSize: CGFloat = 24
    static let menuLineWidth: CGFloat = 20
    static let menuLineHeight: CGFloat = 2
    static let themeToggleWidth: CGFloat = 44
    static let themeToggleHeight: CGFloat = 24
    static let themeToggleThumbSize: CGFloat = 20
    static let menuDropdownWidth: CGFloat = 155.5
    static let menuDropdownRadius: CGFloat = 12
}

enum MazleWebPalette {
    static let background: UInt32 = 0xFFFFFF
    static let surface: UInt32 = 0xF3F3F3
    static let text: UInt32 = 0x1A1A1A
    static let secondary: UInt32 = 0x787C7E
    static let border: UInt32 = 0xD3D6DA
    static let warning: UInt32 = 0xC9B458
    static let groundFace: UInt32 = 0xBFA46B
    static let groundEdge: UInt32 = 0x9F8451
    static let success: UInt32 = 0x6AAA64
    static let successEdge: UInt32 = 0x538D4E
    static let goalFace: UInt32 = 0x6AAA64
    static let goalEdge: UInt32 = 0x538D4E
    static let startFace: UInt32 = 0xD7B74A
    static let startEdge: UInt32 = 0xBD9E3C
    static let wallFace: UInt32 = 0x202124
    static let wallEdge: UInt32 = 0x403D52
    static let iceFace: UInt32 = 0xA6D8FF
    static let iceEdge: UInt32 = 0x7EB5ED
    static let ledgeFace: UInt32 = 0xE8E8E8
    static let ledgeEdge: UInt32 = 0xC0C0C0
    static let ledgeArrow: UInt32 = 0x3A3D41
    static let playerFace: UInt32 = 0xFF4D4D
    static let playerEdge: UInt32 = 0xCC0000
    static let playerOutline: UInt32 = 0x000000
    static let starFace: UInt32 = 0xFFD700
    static let starEdge: UInt32 = 0xDAA520

    static func color(_ hex: UInt32) -> Color {
        Color(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

enum MazleWebTileRole: Equatable {
    case ground
    case start
    case goal
    case ice
    case wall
    case ledgeUp
    case ledgeDown
    case ledgeLeft
    case ledgeRight

    static func forTile(_ tile: TileType) -> Self {
        switch tile {
        case .ground, .boulder: return .ground
        case .start: return .start
        case .goal: return .goal
        case .ice: return .ice
        case .wall: return .wall
        // Web draws the arrow as the exit direction, opposite the entry enum name.
        case .ledgeUp: return .ledgeDown
        case .ledgeDown: return .ledgeUp
        case .ledgeLeft: return .ledgeLeft
        case .ledgeRight: return .ledgeRight
        }
    }
}
