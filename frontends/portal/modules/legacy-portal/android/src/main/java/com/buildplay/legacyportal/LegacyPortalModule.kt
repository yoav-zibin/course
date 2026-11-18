package com.buildplay.legacyportal

import android.content.Context
import android.util.Base64
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
