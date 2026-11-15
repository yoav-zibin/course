import SwiftUI

/// Tiny pipeline-proof app for BuildPlay: one screen, no packages.
/// It proves the cloud (GitHub Actions macOS) build works; once the
/// Apple Developer Program membership is active, the same project is
/// archived and uploaded to TestFlight by CI.
@main
struct BuildPlaySampleApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
