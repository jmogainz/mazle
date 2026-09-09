import UserNotifications

@MainActor
enum ReminderManager {
    static func scheduleDailyReminder() async throws {
        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound])
        guard granted else { throw ReminderError.permissionDenied }

        var components = DateComponents()
        components.hour = 9
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        let content = UNMutableNotificationContent()
        content.title = "Today's Mazle is ready"
        content.body = "Take a few minutes to solve the daily puzzle."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "mazle.daily-reminder",
            content: content,
            trigger: trigger
        )
        try await center.add(request)
    }
}

enum ReminderError: LocalizedError, Sendable {
    case permissionDenied

    var errorDescription: String? {
        switch self {
        case .permissionDenied: return "Notification permission was not granted."
        }
    }
}
