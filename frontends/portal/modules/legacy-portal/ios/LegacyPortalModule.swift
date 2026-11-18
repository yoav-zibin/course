import ExpoModulesCore
import Foundation
import Security

/// Only reads the former app's container and Keychain; never evaluates game HTML.
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

    AsyncFunction("readLegacyPortal") { (baseUrl: String) -> String in
      var result: [String: Any] = [:]
      var ios: [String: Any] = [:]
      var errors: [String] = []
      // The Swift app had a single hardcoded HTTPS backend. Do not attach its
      // identity or caches to a development server selected in the new app.
      if let url = URL(string: baseUrl), url.scheme == "https",
         url.host?.lowercased() == "buildplay.fun", url.port == nil || url.port == 443 {
        let query: [String: Any] = [
          kSecClass as String: kSecClassGenericPassword,
          kSecAttrService as String: "edu.columbia.gameportal.online",
          kSecAttrAccount as String: "buildplay.fun",
          kSecReturnData as String: true,
          kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data {
          if let identity = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            ios["identity"] = identity
          } else {
            errors.append("The previous iOS account could not be decoded. Its Keychain item has been preserved.")
          }
        } else if status != errSecItemNotFound {
          errors.append("The previous iOS account is currently unavailable. Its Keychain item has been preserved.")
        }

        let manager = FileManager.default
        var rawFiles: [String: String] = [:]
        func readJSON(_ file: URL, archiveName: String) -> Any? {
          guard manager.fileExists(atPath: file.path) else { return nil }
          do {
            let data = try Data(contentsOf: file)
            do { return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
            catch {
              rawFiles[archiveName] = data.base64EncodedString()
              errors.append("A previous iOS save was preserved as raw data because its JSON could not be decoded.")
            }
          } catch {
            errors.append("A previous iOS save could not be read. The original file has been preserved.")
          }
          return nil
        }
        if let documents = manager.urls(for: .documentDirectory, in: .userDomainMask).first,
           let portal = readJSON(documents.appendingPathComponent("portal.json"), archiveName: "portal.json") {
          ios["portal"] = portal
        }
        if let support = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
          let directory = support.appendingPathComponent("OnlineSnapshots", isDirectory: true)
          if manager.fileExists(atPath: directory.path) {
            do {
              let files = try manager.contentsOfDirectory(at: directory,
                includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])
              var snapshots: [String: Any] = [:]
              for file in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                let flags = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                guard flags.isRegularFile == true, flags.isSymbolicLink != true,
                      file.lastPathComponent.hasPrefix("account-"), file.pathExtension == "json" else { continue }
                if let snapshot = readJSON(file, archiveName: "OnlineSnapshots/" + file.lastPathComponent) {
                  snapshots[file.lastPathComponent] = snapshot
                }
              }
              ios["onlineSnapshots"] = snapshots
            } catch {
              errors.append("The previous iOS snapshot directory could not be fully read. Its files have been preserved.")
            }
          }
        }
        if !rawFiles.isEmpty { ios["rawFiles"] = rawFiles }
      }
      result["ios"] = ios
      result["errors"] = errors
      let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
      return String(decoding: data, as: UTF8.self)
    }
  }
}
