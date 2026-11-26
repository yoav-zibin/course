import UIKit

@main
final class LinkAppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Link", sessionRole: session.role)
        configuration.delegateClass = LinkSceneDelegate.self
        return configuration
    }
}

@objc(LinkSceneDelegate)
final class LinkSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var sent = false

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        let root = UIViewController()
        root.view.backgroundColor = UIColor(red: 0, green: 0.75, blue: 0.75, alpha: 1)
        window.rootViewController = root
        self.window = window
        window.makeKeyAndVisible()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        guard !sent else { return }
        sent = true
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Leave a stable sender frame before asking iOS to open the real app.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            let sentAt = Date().timeIntervalSince1970
            UIApplication.shared.open(URL(string: "buildplay:///#match=benchmark-opening")!)
            try? String(sentAt).write(to: directory.appendingPathComponent("link-sent.txt"), atomically: true, encoding: .utf8)
        }
    }
}
