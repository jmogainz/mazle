import Foundation

enum DailyDate {
    static let launchDateString = "2025-12-04"

    static func todayString(now: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        let components = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    static func puzzleNumber(for dateString: String) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!

        guard let parsedDate = date(from: dateString, calendar: calendar),
              let launchDate = date(from: launchDateString, calendar: calendar),
              let dayDelta = calendar.dateComponents([.day], from: launchDate, to: parsedDate).day else {
            return 1
        }
        return max(1, dayDelta + 1)
    }

    static func addingDays(_ days: Int, to dateString: String) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        guard let source = date(from: dateString, calendar: calendar),
              let shifted = calendar.date(byAdding: .day, value: days, to: source) else {
            return dateString
        }
        let components = calendar.dateComponents([.year, .month, .day], from: shifted)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    static func daysBetween(_ from: String, and to: String) -> Int? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        guard let start = date(from: from, calendar: calendar),
              let end = date(from: to, calendar: calendar) else {
            return nil
        }
        return calendar.dateComponents([.day], from: start, to: end).day
    }

    private static func date(from string: String, calendar: Calendar) -> Date? {
        let pieces = string.split(separator: "-").compactMap { Int($0) }
        guard pieces.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: pieces[0], month: pieces[1], day: pieces[2], hour: 12))
    }
}
