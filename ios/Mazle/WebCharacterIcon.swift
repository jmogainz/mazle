import Foundation
import SwiftUI

/// The two non-inline character SVGs used by the web CharacterIcon component.
enum WebCharacterAsset: String, CaseIterable {
    case penguin
    case obsidian

    var fileName: String { "\(rawValue).svg" }
}

/// Geometry copied from src/components/CharacterIcon.tsx (viewBox 0 0 32 32).
enum WebCharacterGeometry {
    static let viewBoxSize = CGSize(width: 32, height: 32)
    static let shadowCenter = CGPoint(x: 16, y: 27)
    static let shadowRadius = CGSize(width: 9, height: 3)
    static let eyeCenters = [CGPoint(x: 13, y: 13), CGPoint(x: 19, y: 13)]
    static let pupilCenters = [CGPoint(x: 14, y: 13), CGPoint(x: 20, y: 13)]
    static let eyeRadius: CGFloat = 3
    static let pupilRadius: CGFloat = 1.5
}

/// Native renderer for the same web character SVGs and inline SVG geometry.
///
/// The web's Cube/Cylinder/Pyramid are inline SVG paths. Penguin and Obsidian
/// are the exact source SVG files copied into the native target's resources;
/// they are parsed and filled at runtime rather than converted to a different
/// image format or replaced by SF Symbols.
struct WebCharacterIcon: View {
    let characterId: String
    let skinId: String
    let size: CGFloat
    let locked: Bool

    init(characterId: String = "default", skinId: String = "default", size: CGFloat = 32, locked: Bool = false) {
        self.characterId = characterId
        self.skinId = skinId
        self.size = size
        self.locked = locked
    }

    var body: some View {
        Canvas { context, canvasSize in
            WebCharacterRenderer.draw(
                context: &context,
                size: canvasSize,
                characterId: characterId,
                skinId: skinId,
                locked: locked
            )
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private enum WebCharacterRenderer {
    static func draw(
        context: inout GraphicsContext,
        size: CGSize,
        characterId: String,
        skinId: String,
        locked: Bool
    ) {
        let scale = min(size.width / 32, size.height / 32)
        let drawSize = CGSize(width: 32 * scale, height: 32 * scale)
        let origin = CGPoint(
            x: (size.width - drawSize.width) / 2,
            y: (size.height - drawSize.height) / 2
        )

        drawShadow(context: &context, origin: origin, scale: scale)

        var normalizedSkin = skinId.lowercased()
        // Match src/lib/skins.ts: obsidian is currently disabled and the web
        // CharacterIcon normalizes it back to the Classic skin.
        if normalizedSkin == "obsidian" {
            normalizedSkin = "default"
        }

        if !locked, let asset = WebCharacterAsset(rawValue: normalizedSkin) {
            if let document = SVGDocument.load(asset: asset) {
                document.draw(context: &context, in: size)
                return
            }
        }

        drawInlineCharacter(
            context: &context,
            origin: origin,
            scale: scale,
            characterId: characterId,
            skinId: normalizedSkin,
            locked: locked
        )
    }

    private static func drawShadow(context: inout GraphicsContext, origin: CGPoint, scale: CGFloat) {
        var shadow = Path()
        shadow.addEllipse(in: CGRect(
            x: origin.x + (16 - 9) * scale,
            y: origin.y + (27 - 3) * scale,
            width: 18 * scale,
            height: 6 * scale
        ))
        context.fill(shadow, with: .color(.black.opacity(0.25)))
    }

    private static func drawInlineCharacter(
        context: inout GraphicsContext,
        origin: CGPoint,
        scale: CGFloat,
        characterId: String,
        skinId: String,
        locked: Bool
    ) {
        let colors = colorsFor(characterId: characterId, skinId: skinId, locked: locked)
        let shape = characterId.lowercased()

        var body = Path()
        switch shape {
        case "cylinder":
            body.move(to: CGPoint(x: 8, y: 10))
            body.addLine(to: CGPoint(x: 8, y: 22))
            body.addCurve(
                to: CGPoint(x: 16, y: 25),
                control1: CGPoint(x: 8, y: 23.66),
                control2: CGPoint(x: 11.58, y: 25)
            )
            body.addCurve(
                to: CGPoint(x: 24, y: 22),
                control1: CGPoint(x: 20.42, y: 25),
                control2: CGPoint(x: 24, y: 23.66)
            )
            body.addLine(to: CGPoint(x: 24, y: 10))
            body.closeSubpath()
        case "pyramid":
            body.move(to: CGPoint(x: 16, y: 4))
            body.addLine(to: CGPoint(x: 26, y: 24))
            body.addLine(to: CGPoint(x: 6, y: 24))
            body.closeSubpath()
        default:
            body.addRoundedRect(
                in: CGRect(x: 8, y: 6, width: 16, height: 18),
                cornerSize: CGSize(width: 3, height: 3)
            )
        }

        let mappedBody = map(body, origin: origin, scale: scale)
        context.fill(mappedBody, with: .color(colors.face))
        context.stroke(mappedBody, with: .color(colors.edge), lineWidth: max(0.5, 2 * scale))

        if shape == "cylinder" {
            var top = Path()
            top.addEllipse(in: CGRect(x: 8, y: 7, width: 16, height: 6))
            let mappedTop = map(top, origin: origin, scale: scale)
            context.fill(mappedTop, with: .color(colors.face))
            context.stroke(mappedTop, with: .color(colors.edge), lineWidth: max(0.5, 2 * scale))
        }

        let eyeOffsetY: CGFloat = shape == "pyramid" ? 2 : 0
        for (index, center) in WebCharacterGeometry.eyeCenters.enumerated() {
            var eye = Path()
            eye.addEllipse(in: CGRect(
                x: center.x - WebCharacterGeometry.eyeRadius,
                y: center.y - WebCharacterGeometry.eyeRadius + eyeOffsetY,
                width: WebCharacterGeometry.eyeRadius * 2,
                height: WebCharacterGeometry.eyeRadius * 2
            ))
            context.fill(map(eye, origin: origin, scale: scale), with: .color(.white))

            let pupilCenter = WebCharacterGeometry.pupilCenters[index]
            var pupil = Path()
            pupil.addEllipse(in: CGRect(
                x: pupilCenter.x - WebCharacterGeometry.pupilRadius,
                y: pupilCenter.y - WebCharacterGeometry.pupilRadius + eyeOffsetY,
                width: WebCharacterGeometry.pupilRadius * 2,
                height: WebCharacterGeometry.pupilRadius * 2
            ))
            context.fill(map(pupil, origin: origin, scale: scale), with: .color(.black))
        }
    }

    private static func map(_ path: Path, origin: CGPoint, scale: CGFloat) -> Path {
        var transform = CGAffineTransform(translationX: origin.x, y: origin.y)
            .scaledBy(x: scale, y: scale)
        guard let copied = path.cgPath.copy(using: &transform) else { return path }
        return Path(copied)
    }

    private static func colorsFor(characterId: String, skinId: String, locked: Bool) -> (face: Color, edge: Color) {
        if locked {
            return (Color(red: 0x9c / 255, green: 0xa3 / 255, blue: 0xac / 255), Color(red: 0x6b / 255, green: 0x72 / 255, blue: 0x80 / 255))
        }

        switch skinId {
        case "mustard":
            return (hex("#ffdb58"), hex("#daa520"))
        case "teal":
            return (hex("#008080"), hex("#004d4d"))
        case "royal":
            return (hex("#4f2db3"), hex("#a78bfa"))
        case "penguin":
            return (hex("#1a1a2e"), hex("#ffffff"))
        default:
            return (hex("#ff4d4d"), hex("#cc0000"))
        }
    }

    private static func hex(_ value: String) -> Color {
        let raw = value.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        guard let number = UInt64(raw, radix: 16) else { return .clear }
        return Color(
            red: Double((number >> 16) & 0xff) / 255,
            green: Double((number >> 8) & 0xff) / 255,
            blue: Double(number & 0xff) / 255
        )
    }
}

private struct SVGPathLayer {
    let path: CGPath
    let fill: Color
    let opacity: Double
}

private final class SVGDocument: NSObject, XMLParserDelegate {
    private let viewBox: CGRect
    private let layers: [SVGPathLayer]

    private init(viewBox: CGRect, layers: [SVGPathLayer]) {
        self.viewBox = viewBox
        self.layers = layers
    }

    static func load(asset: WebCharacterAsset) -> SVGDocument? {
        let url = Bundle.main.url(forResource: asset.rawValue, withExtension: "svg", subdirectory: "Characters")
            ?? Bundle.main.url(forResource: asset.rawValue, withExtension: "svg")
        guard let url, let data = try? Data(contentsOf: url) else {
            return nil
        }
        let delegate = Parser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse(), let viewBox = delegate.viewBox else { return nil }
        return SVGDocument(viewBox: viewBox, layers: delegate.layers)
    }

    func draw(context: inout GraphicsContext, in size: CGSize) {
        let scale = min(size.width / viewBox.width, size.height / viewBox.height)
        let transform = CGAffineTransform(
            translationX: (size.width - viewBox.width * scale) / 2 - viewBox.minX * scale,
            y: (size.height - viewBox.height * scale) / 2 - viewBox.minY * scale
        ).scaledBy(x: scale, y: scale)

        for layer in layers {
            var mutableTransform = transform
            guard let mapped = layer.path.copy(using: &mutableTransform) else { continue }
            context.fill(Path(mapped), with: .color(layer.fill.opacity(layer.opacity)))
        }
    }

    private final class Parser: NSObject, XMLParserDelegate {
        var viewBox: CGRect?
        var layers: [SVGPathLayer] = []

        func parser(
            _ parser: XMLParser,
            didStartElement elementName: String,
            namespaceURI: String?,
            qualifiedName qName: String?,
            attributes attributeDict: [String: String] = [:]
        ) {
            if elementName == "svg", let raw = attributeDict["viewBox"] {
                let values = raw.split { $0 == " " || $0 == "," }.compactMap { Double($0) }
                if values.count == 4, values[2] > 0, values[3] > 0 {
                    viewBox = CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
                }
                return
            }

            guard elementName == "path", let rawPath = attributeDict["d"], let path = SVGPathParser(rawPath).parse() else {
                return
            }
            let transform = SVGTransformParser.parse(attributeDict["transform"])
            var mutableTransform = transform
            let transformed = path.copy(using: &mutableTransform) ?? path
            let fill = SVGColorParser.color(attributeDict["fill"] ?? "#000000")
            let opacity = Double(attributeDict["opacity"] ?? "1") ?? 1
            layers.append(SVGPathLayer(path: transformed, fill: fill, opacity: opacity))
        }
    }
}

private enum SVGColorParser {
    static func color(_ value: String) -> Color {
        let raw = value.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        guard let number = UInt64(raw, radix: 16) else { return .black }
        let digits = raw.count
        if digits == 3 {
            let r = Double((number >> 8) & 0xf) / 15
            let g = Double((number >> 4) & 0xf) / 15
            let b = Double(number & 0xf) / 15
            return Color(red: r, green: g, blue: b)
        }
        return Color(
            red: Double((number >> 16) & 0xff) / 255,
            green: Double((number >> 8) & 0xff) / 255,
            blue: Double(number & 0xff) / 255
        )
    }
}

private enum SVGTransformParser {
    static func parse(_ raw: String?) -> CGAffineTransform {
        guard let raw else { return .identity }
        var result = CGAffineTransform.identity
        let pattern = #"(translate|scale)\\s*\\(([^)]*)\\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return result }
        let range = NSRange(raw.startIndex..<raw.endIndex, in: raw)
        for match in regex.matches(in: raw, range: range) {
            guard let nameRange = Range(match.range(at: 1), in: raw),
                  let valuesRange = Range(match.range(at: 2), in: raw) else { continue }
            let name = String(raw[nameRange])
            let values = String(raw[valuesRange])
                .split { $0 == " " || $0 == "," }
                .compactMap { Double($0) }
            if name == "translate", let x = values.first {
                result = result.concatenating(CGAffineTransform(translationX: x, y: values.count > 1 ? values[1] : 0))
            } else if name == "scale", let x = values.first {
                result = result.concatenating(CGAffineTransform(scaleX: x, y: values.count > 1 ? values[1] : x))
            }
        }
        return result
    }
}

private enum SVGPathToken {
    case command(Character)
    case number(CGFloat)
}

private struct SVGPathParser {
    let tokens: [SVGPathToken]

    init(_ data: String) {
        self.tokens = SVGPathParser.tokenize(data)
    }

    func parse() -> CGPath? {
        let path = CGMutablePath()
        var index = 0
        var command: Character?
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var lastControl: CGPoint?

        while index < tokens.count {
            if case .command(let next) = tokens[index] {
                command = next
                index += 1
                if next == "Z" || next == "z" {
                    path.closeSubpath()
                    current = subpathStart
                    lastControl = nil
                    command = nil
                }
                continue
            }

            guard let active = command else { return nil }
            let lower = active.lowercased()
            let count: Int
            switch lower {
            case "m", "l": count = 2
            case "h", "v": count = 1
            case "c": count = 6
            case "s": count = 4
            default: return nil
            }
            guard index + count <= tokens.count else { return nil }
            var values: [CGFloat] = []
            values.reserveCapacity(count)
            for _ in 0..<count {
                guard case .number(let value) = tokens[index] else { return nil }
                values.append(value)
                index += 1
            }
            let isRelative = active.isLowercase

            switch lower {
            case "m":
                let point = point(x: values[0], y: values[1], current: current, relative: isRelative)
                path.move(to: point)
                current = point
                subpathStart = point
                lastControl = nil
                command = isRelative ? "l" : "L"
            case "l":
                let point = point(x: values[0], y: values[1], current: current, relative: isRelative)
                path.addLine(to: point)
                current = point
                lastControl = nil
            case "h":
                let point = CGPoint(x: isRelative ? current.x + values[0] : values[0], y: current.y)
                path.addLine(to: point)
                current = point
                lastControl = nil
            case "v":
                let point = CGPoint(x: current.x, y: isRelative ? current.y + values[0] : values[0])
                path.addLine(to: point)
                current = point
                lastControl = nil
            case "c":
                let c1 = point(x: values[0], y: values[1], current: current, relative: isRelative)
                let c2 = point(x: values[2], y: values[3], current: current, relative: isRelative)
                let end = point(x: values[4], y: values[5], current: current, relative: isRelative)
                path.addCurve(to: end, control1: c1, control2: c2)
                current = end
                lastControl = c2
            case "s":
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = point(x: values[0], y: values[1], current: current, relative: isRelative)
                let end = point(x: values[2], y: values[3], current: current, relative: isRelative)
                path.addCurve(to: end, control1: c1, control2: c2)
                current = end
                lastControl = c2
            default:
                return nil
            }
        }
        return path.copy()
    }

    private func point(x: CGFloat, y: CGFloat, current: CGPoint, relative: Bool) -> CGPoint {
        relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
    }

    private static func tokenize(_ data: String) -> [SVGPathToken] {
        let chars = Array(data)
        var result: [SVGPathToken] = []
        var index = 0
        let commands = Set("MmZzLlHhVvCcSs")

        while index < chars.count {
            let ch = chars[index]
            if commands.contains(ch) {
                result.append(.command(ch))
                index += 1
                continue
            }
            if ch.isWhitespace || ch == "," {
                index += 1
                continue
            }

            let start = index
            if chars[index] == "-" || chars[index] == "+" { index += 1 }
            while index < chars.count, chars[index].isNumber { index += 1 }
            if index < chars.count, chars[index] == "." {
                index += 1
                while index < chars.count, chars[index].isNumber { index += 1 }
            }
            if index < chars.count, chars[index] == "e" || chars[index] == "E" {
                index += 1
                if index < chars.count, chars[index] == "-" || chars[index] == "+" { index += 1 }
                while index < chars.count, chars[index].isNumber { index += 1 }
            }
            guard index > start, let number = Double(String(chars[start..<index])) else {
                index += 1
                continue
            }
            result.append(.number(CGFloat(number)))
        }
        return result
    }
}
