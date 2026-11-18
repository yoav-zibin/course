package com.buildplay.runtime

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BuildPlayRuntimeModule : Module() {
  companion object { init { System.loadLibrary("buildplay-runtime") } }
  private external fun evaluateNative(source: ByteArray): ByteArray
  override fun definition() = ModuleDefinition {
    Name("BuildPlayRuntime")
    AsyncFunction("evaluate") { source: String ->
      val bytes = evaluateNative(source.toByteArray(Charsets.UTF_8))
      val text = String(bytes, 1, bytes.size - 1, Charsets.UTF_8)
      require(bytes[0] == 0.toByte()) { text }
      text
    }
  }
}
