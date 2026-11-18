import CryptoKit
import Foundation

final class PortalPersistentStorage {
  private let lock = NSLock()

  private func directory() throws -> URL {
    guard let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
      throw CocoaError(.fileNoSuchFile)
    }
    let directory = root.appendingPathComponent("BuildPlayShared", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func hash(_ key: String) -> String {
    SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func missing(_ error: Error) -> Bool {
    let error = error as NSError
    return error.domain == NSCocoaErrorDomain &&
      (error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError)
  }

  private func read(_ file: URL) throws -> [String: String] {
    let data = try Data(contentsOf: file)
    guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: String],
          let key = envelope["key"], envelope["value"] != nil,
          file.lastPathComponent == hash(key) + ".json" else {
      throw CocoaError(.fileReadCorruptFile)
    }
    return envelope
  }

  func get(_ key: String) throws -> String? {
    lock.lock(); defer { lock.unlock() }
    let file = try directory().appendingPathComponent(hash(key) + ".json")
    let envelope: [String: String]
    do { envelope = try read(file) }
    catch { if missing(error) { return nil }; throw error }
    guard envelope["key"] == key else { throw CocoaError(.fileReadCorruptFile) }
    return envelope["value"]
  }

  func set(_ key: String, _ value: String) throws {
    lock.lock(); defer { lock.unlock() }
    let file = try directory().appendingPathComponent(hash(key) + ".json")
    let data = try JSONSerialization.data(withJSONObject: ["key": key, "value": value])
    try data.write(to: file, options: .atomic)
  }

  func remove(_ key: String) throws {
    lock.lock(); defer { lock.unlock() }
    let file = try directory().appendingPathComponent(hash(key) + ".json")
    do { try FileManager.default.removeItem(at: file) }
    catch { if !missing(error) { throw error } }
  }

  func keys() throws -> [String] {
    lock.lock(); defer { lock.unlock() }
    return try FileManager.default.contentsOfDirectory(at: directory(),
      includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      .filter { $0.pathExtension == "json" }
      .filter { file in
        let flags = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        return flags.isRegularFile == true && flags.isSymbolicLink != true
      }
      .map { try read($0)["key"]! }.sorted()
  }
}
