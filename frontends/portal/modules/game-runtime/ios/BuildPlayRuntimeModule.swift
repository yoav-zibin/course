import ExpoModulesCore
import Foundation

public class BuildPlayRuntimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BuildPlayRuntime")
    AsyncFunction("evaluate") { (source: String) throws -> String in
      var failed: Int32 = 0
      guard let result = source.withCString({ bp_runtime_evaluate($0, &failed) }) else {
        throw NSError(domain: "BuildPlayRuntime", code: 1, userInfo: [NSLocalizedDescriptionKey: "Game runtime allocation failed"])
      }
      defer { bp_runtime_free(result) }
      let text = String(cString: result)
      if failed != 0 {
        throw NSError(domain: "BuildPlayRuntime", code: 2, userInfo: [NSLocalizedDescriptionKey: text])
      }
      return text
    }.runOnQueue(DispatchQueue(label: "fun.buildplay.game-runtime", qos: .userInitiated))
  }
}
