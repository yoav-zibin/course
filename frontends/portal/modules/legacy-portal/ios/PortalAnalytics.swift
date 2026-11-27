import FirebaseAnalytics
import FirebaseCore
import Foundation

/// The Analytics Worklet owns this instance. Load the plist there, then run
/// Firebase's required one-time configuration on the main thread after launch.
final class PortalAnalytics {
  private var configured = false
  private var user: String?
  private var screen: String?

  func view(id: String, name: String) -> String? {
    guard !id.isEmpty else {
      if user != nil {
        Analytics.setUserID(nil)
        Analytics.setAnalyticsCollectionEnabled(false)
      }
      user = nil
      screen = nil
      return "disabled"
    }
    if !configured {
      guard let path = Bundle.main.path(forResource: "BuildPlayFirebase", ofType: "plist"),
            let options = FirebaseOptions(contentsOfFile: path),
            options.bundleID == Bundle.main.bundleIdentifier else { return nil }
      let configure = {
        if FirebaseApp.app() == nil { FirebaseApp.configure(options: options) }
      }
      if Thread.isMainThread { configure() } else { DispatchQueue.main.sync(execute: configure) }
      configured = true
    }
    if user != id {
      Analytics.setAnalyticsCollectionEnabled(true)
      Analytics.setUserID(id)
      user = id
      screen = nil
    }
    if screen != name {
      Analytics.logEvent(AnalyticsEventScreenView, parameters: [
        AnalyticsParameterScreenName: name, AnalyticsParameterScreenClass: "BuildPlay"
      ])
      screen = name
    }
    return "enabled"
  }
}
