import ExpoModulesCore
import Foundation

/// App-owned files and launch settings for native builds.
public final class LegacyPortalModule: Module {
  private let persistentStorage = PortalPersistentStorage()

  public func definition() -> ModuleDefinition {
    Name("LegacyPortal")

    Function("readLocalUiTest") {
      ProcessInfo.processInfo.environment["BUILDPLAY_LOCAL_UI_TEST"] == "1"
    }

    AsyncFunction("getPersistentItem") { (key: String) -> String? in try self.persistentStorage.get(key) }
    AsyncFunction("setPersistentItem") { (key: String, value: String) in try self.persistentStorage.set(key, value) }
    AsyncFunction("removePersistentItem") { (key: String) in try self.persistentStorage.remove(key) }
    AsyncFunction("getPersistentKeys") { try self.persistentStorage.keys() }
  }
}
