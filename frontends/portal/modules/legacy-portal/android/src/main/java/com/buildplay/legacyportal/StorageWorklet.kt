package com.buildplay.legacyportal

import androidx.annotation.Keep
import org.json.JSONArray

@Keep
internal class StorageWorklet(private val storage: PortalPersistentStorage) {
  external fun install(runtime: Long)

  fun access(operation: String, key: String, value: String): String? = when (operation) {
    "get" -> storage.get(key)
    "set" -> { storage.set(key, value); null }
    "remove" -> { storage.remove(key); null }
    "keys" -> JSONArray(storage.keys()).toString()
    else -> throw IllegalArgumentException("Unknown device storage operation")
  }

  companion object { init { System.loadLibrary("buildplay-storage") } }
}
