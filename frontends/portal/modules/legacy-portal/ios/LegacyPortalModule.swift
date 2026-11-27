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

    Function("installStorageWorklet") {
      guard let appContext = self.appContext else { throw Exceptions.RuntimeLost() }
      let runtime = try appContext.runtime
      runtime.withUnsafePointee { pointer in
        BPInstallStorageWorklet(pointer) { [storage = self.persistentStorage] operation, key, value, error in
          do {
            switch operation {
            case "get": return try storage.get(key)
            case "set": try storage.set(key, value)
            case "remove": try storage.remove(key)
            case "keys": return String(decoding: try JSONEncoder().encode(storage.keys()), as: UTF8.self)
            default: throw NSError(domain: "BuildPlayStorage", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown storage operation"])
            }
            return nil
          } catch let failure {
            error.pointee = failure as NSError
            return nil
          }
        }
      }
    }
  }
}
