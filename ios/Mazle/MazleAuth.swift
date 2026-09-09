import AuthenticationServices
import Combine
import Foundation
import Security
import UIKit

struct MazleAuthSession: Codable, Equatable, Sendable {
    let accessToken: String
    let provider: String?
    let expiresAt: Date?
    let userId: String?

    init(accessToken: String, provider: String?, expiresAt: Date?, userId: String? = nil) {
        self.accessToken = accessToken
        self.provider = provider
        self.expiresAt = expiresAt
        self.userId = userId
    }

    var isExpired: Bool {
        guard let expiresAt else { return false }
        return expiresAt <= Date()
    }
}

@MainActor
final class MazleSessionStore: ObservableObject {
    static let shared = MazleSessionStore()

    @Published private(set) var session: MazleAuthSession?

    private static let service = "com.mazle.game.auth"
    private static let account = "session"

    private init() {
        guard !MazleRuntimeConfiguration.isOfflineMode else { return }
        session = Self.load()
        if session?.isExpired == true {
            session = nil
            Self.remove()
        }
    }

    var isSignedIn: Bool {
        session != nil && session?.isExpired == false
    }

    func save(_ session: MazleAuthSession) {
        if MazleRuntimeConfiguration.isOfflineMode {
            self.session = session
            return
        }
        guard let data = try? JSONEncoder().encode(session) else { return }
        let query = Self.baseQuery()
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { return }
        self.session = session
    }

    func clear() {
        if !MazleRuntimeConfiguration.isOfflineMode { Self.remove() }
        session = nil
    }

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func load() -> MazleAuthSession? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(MazleAuthSession.self, from: data)
    }

    private static func remove() {
        SecItemDelete(baseQuery() as CFDictionary)
    }
}

@MainActor
final class MazleAuthManager: NSObject, ObservableObject {
    @Published private(set) var isAuthenticating = false
    @Published var errorMessage: String?

    let baseURL: URL
    let sessionStore: MazleSessionStore
    private var authenticationSession: ASWebAuthenticationSession?

    init(
        baseURL: URL = MazleRuntimeConfiguration.apiBaseURL,
        sessionStore: MazleSessionStore = .shared
    ) {
        self.baseURL = baseURL
        self.sessionStore = sessionStore
        super.init()
    }

    var session: MazleAuthSession? { sessionStore.session }
    var isSignedIn: Bool { sessionStore.isSignedIn }

    func signIn(provider: String) {
        guard !MazleRuntimeConfiguration.isOfflineMode else { return }
        guard !isAuthenticating else { return }
        guard let callbackURL = URL(string: "https://mazle.io/api/mobile/auth/callback") else { return }

        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/auth/signin/\(provider)"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "callbackUrl", value: callbackURL.absoluteString),
        ]
        guard let signInURL = components?.url else {
            errorMessage = "The sign-in URL is invalid."
            return
        }

        errorMessage = nil
        isAuthenticating = true
        let session = ASWebAuthenticationSession(
            url: signInURL,
            callbackURLScheme: "mazle"
        ) { [weak self] callbackURL, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isAuthenticating = false
                self.authenticationSession = nil
                if let error {
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        return
                    }
                    self.errorMessage = error.localizedDescription
                    return
                }
                guard let callbackURL,
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                      let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
                      !token.isEmpty else {
                    let callbackError = callbackURL.flatMap {
                        URLComponents(url: $0, resolvingAgainstBaseURL: false)?
                            .queryItems?.first(where: { $0.name == "error" })?.value
                    }
                    self.errorMessage = callbackError.map { "Sign-in failed: \($0)." }
                        ?? "Sign-in completed without a session token."
                    return
                }
                self.sessionStore.save(
                    MazleAuthSession(
                        accessToken: token,
                        provider: components.queryItems?.first(where: { $0.name == "provider" })?.value,
                        expiresAt: Date().addingTimeInterval(10 * 24 * 60 * 60),
                        userId: components.queryItems?.first(where: { $0.name == "userId" })?.value
                    )
                )
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session
        guard session.start() else {
            authenticationSession = nil
            isAuthenticating = false
            errorMessage = "Could not start sign-in."
            return
        }
    }

    func signOut() {
        authenticationSession?.cancel()
        authenticationSession = nil
        sessionStore.clear()
    }
}

extension MazleAuthManager: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: { $0.isKeyWindow }) ?? UIWindow()
    }
}
