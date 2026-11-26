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
    private var markerTimes: [CFTimeInterval] = []

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
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.scheduleMarker() }
    }

    private func scheduleMarker() {
        CADisplayLink(target: self, selector: #selector(mark(_:))).add(to: .main, forMode: .common)
    }

    @objc private func mark(_ link: CADisplayLink) {
        let displayTime = link.targetTimestamp
        link.invalidate()
        markerTimes.append(displayTime)
        window?.rootViewController?.view.backgroundColor = markerTimes.count == 1 ? .yellow : .magenta
        CATransaction.flush()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            guard self.markerTimes.count == 2 else { self.scheduleMarker(); return }
            let elapsed = (CACurrentMediaTime() - displayTime) * 1000
            let sentAt = Date().timeIntervalSince1970 * 1000
            UIApplication.shared.open(URL(string: "buildplay:///#match=benchmark-opening")!)
            let timing = ["sent_epoch_ms": sentAt, "after_marker_ms": elapsed,
                          "marker_interval_ms": (displayTime - self.markerTimes[0]) * 1000]
            let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            try? JSONEncoder().encode(timing).write(to: directory.appendingPathComponent("link-sent.json"), options: .atomic)
        }
    }
}
