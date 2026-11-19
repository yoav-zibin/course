package com.buildplay.legacyportal

import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.util.Base64
import android.util.Log
import android.view.View
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

/** Read-only bridge for upgrades from the original Compose application. */
class LegacyPortalModule : Module() {
  private fun storage() = PortalPersistentStorage(appContext.reactContext
    ?: throw IllegalStateException("The application context is unavailable"))

  override fun definition() = ModuleDefinition {
    Name("LegacyPortal")

    Function("readLocalUiTest") {
      appContext.currentActivity?.intent?.getBooleanExtra("buildplayLocalUiTest", false) ?: false
    }

    AsyncFunction("getPersistentItem") { key: String -> storage().get(key) }
    AsyncFunction("setPersistentItem") { key: String, value: String -> storage().set(key, value) }
    AsyncFunction("removePersistentItem") { key: String -> storage().remove(key) }
    AsyncFunction("getPersistentKeys") { storage().keys() }

    AsyncFunction("protectBugControlGesture") { viewTag: Int ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@AsyncFunction false
      val view = try {
        appContext.findView<View>(viewTag)
      } catch (_: Exception) {
        // A modal can disappear before its layout callback reaches this queue.
        null
      } ?: run {
        Log.d("BuildPlayBugGesture", "view missing tag=$viewTag")
        return@AsyncFunction false
      }
      // This API is deliberately restricted to the small floating control,
      // never an Activity or Modal window's entire navigation edge.
      val maximum = (64 * view.resources.displayMetrics.density).toInt()
      if (!view.isAttachedToWindow || view.width <= 0 || view.height <= 0 || view.width > maximum || view.height > maximum) {
        Log.d("BuildPlayBugGesture", "not ready tag=$viewTag size=${view.width}x${view.height} attached=${view.isAttachedToWindow}")
        return@AsyncFunction false
      }
      // Android tracks this View's movement. Avoid re-registering/logging the
      // same local rectangle on every frame while the control is dragged.
      val exclusions = listOf(Rect(0, 0, view.width, view.height))
      if (view.systemGestureExclusionRects != exclusions) {
        view.systemGestureExclusionRects = exclusions
        Log.d("BuildPlayBugGesture", "protected tag=$viewTag size=${view.width}x${view.height}")
      }
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("readLegacyPortal") { baseUrl: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("The application context is unavailable")
      exportLegacyPortal(context, baseUrl)
    }
  }
}

internal fun exportLegacyPortal(context: Context, baseUrl: String): String {
  val preferences = context.getSharedPreferences("portal-session", Context.MODE_PRIVATE)
  val android = JSONObject()
  val errors = JSONArray()
  // The original Retrofit base URL ended with '/'. Accept the unsuffixed
  // spelling as well, without inspecting credentials for another server.
  val normalized = baseUrl.trim().trimEnd('/')
  val candidates = listOf(baseUrl.trim(), "$normalized/", normalized).distinct()
  for (candidate in candidates) {
    val scope = MessageDigest.getInstance("SHA-256").digest(candidate.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
    if (!android.has("selectedMatchId")) {
      preferences.getString("match-$scope", null)?.let { android.put("selectedMatchId", it) }
    }
    if (android.has("user")) continue
    val sealed = preferences.getString("credentials-$scope", null) ?: continue
    try {
      // Never create/replace a key or modify the legacy preferences.
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val key = store.getKey("game-portal-$scope", null) as? SecretKey
        ?: throw IllegalStateException("The previous account key is unavailable")
      val parts = sealed.split(':')
      require(parts.size == 2)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
      val raw = JSONObject(String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8))
      val id = raw.getString("id")
      val password = raw.getString("password")
      require(id.isNotBlank() && password.isNotBlank())
      android.put("user", JSONObject().put("id", id).put("password", password)
        .put("display_name", raw.optString("name", "Player")))
      android.put("raw", raw)
    } catch (_: Exception) {
      errors.put("The previous Android account could not be decrypted. Its original data has been preserved.")
    }
  }
  return JSONObject().put("android", android).put("errors", errors).toString()
}
