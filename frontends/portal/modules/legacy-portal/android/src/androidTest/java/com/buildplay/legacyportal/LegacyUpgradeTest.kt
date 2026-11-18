package com.buildplay.legacyportal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Exercises real Keystore interoperability with the former SessionVault format. */
class LegacyUpgradeTest {
  @Test fun largePersistentValuesSurviveNewStoreAndDelete() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val key = "large-upgrade-${UUID.randomUUID()}"
    val value = "♟️" + "x".repeat(3 * 1024 * 1024)
    val first = PortalPersistentStorage(context)
    try {
      first.set(key, value)
      assertEquals(value, first.get(key))
      val restarted = PortalPersistentStorage(context)
      assertEquals(value, restarted.get(key))
      assertTrue(restarted.keys().contains(key))
      val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray())
        .joinToString("") { "%02x".format(it) }
      val file = File(context.filesDir, "BuildPlayShared/$digest.json")
      file.copyTo(File(file.path + ".bak"), overwrite = true)
      file.writeText("interrupted-write")
      assertEquals("AtomicFile must recover its saved backup", value, PortalPersistentStorage(context).get(key))
      restarted.remove(key)
      assertNull(PortalPersistentStorage(context).get(key))
      assertFalse(PortalPersistentStorage(context).keys().contains(key))
      file.writeText("corrupt-envelope")
      var rejected = false
      try { PortalPersistentStorage(context).get(key) } catch (_: Exception) { rejected = true }
      assertTrue("Corrupt values must reject instead of returning null", rejected)
      assertEquals("corrupt-envelope", file.readText())
    } finally { first.remove(key) }
  }

  @Test fun originalGuestAndSelectionAreRecoveredWithoutChangingOldStorage() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val baseUrl = "https://upgrade-${UUID.randomUUID()}.invalid/"
    val scope = MessageDigest.getInstance("SHA-256").digest(baseUrl.toByteArray())
      .joinToString("") { "%02x".format(it) }
    val alias = "game-portal-$scope"
    val preferences = context.getSharedPreferences("portal-session", Context.MODE_PRIVATE)
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    try {
      val key = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
      }.generateKey()
      val original = JSONObject().put("id", "legacy-alice").put("name", "Alice ♟️").put("password", "test-only-password")
      val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
      val sealed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
        Base64.encodeToString(cipher.doFinal(original.toString().toByteArray()), Base64.NO_WRAP)
      assertTrue(preferences.edit().putString("credentials-$scope", sealed).putString("match-$scope", "saved-match").commit())
      // The new client stores a URL without '/', the old Retrofit URL used it.
      val recovered = JSONObject(exportLegacyPortal(context, baseUrl.trimEnd('/')))
      val android = recovered.getJSONObject("android")
      assertEquals("legacy-alice", android.getJSONObject("user").getString("id"))
      assertEquals("Alice ♟️", android.getJSONObject("user").getString("display_name"))
      assertEquals("test-only-password", android.getJSONObject("user").getString("password"))
      assertEquals("saved-match", android.getString("selectedMatchId"))
      assertEquals(0, recovered.getJSONArray("errors").length())
      assertEquals(sealed, preferences.getString("credentials-$scope", null))
      assertTrue(store.containsAlias(alias))
      assertFalse(JSONObject(exportLegacyPortal(context, "https://different.invalid")).getJSONObject("android").has("user"))
    } finally {
      preferences.edit().remove("credentials-$scope").remove("match-$scope").commit()
      store.deleteEntry(alias)
    }
  }

  @Test fun corruptOldAccountIsPreservedAndReported() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val baseUrl = "https://corrupt-${UUID.randomUUID()}.invalid/"
    val scope = MessageDigest.getInstance("SHA-256").digest(baseUrl.toByteArray())
      .joinToString("") { "%02x".format(it) }
    val preferences = context.getSharedPreferences("portal-session", Context.MODE_PRIVATE)
    try {
      preferences.edit().putString("credentials-$scope", "unreadable-ciphertext").commit()
      val recovered = JSONObject(exportLegacyPortal(context, baseUrl))
      assertFalse(recovered.getJSONObject("android").has("user"))
      assertTrue(recovered.getJSONArray("errors").length() > 0)
      assertEquals("unreadable-ciphertext", preferences.getString("credentials-$scope", null))
    } finally {
      preferences.edit().remove("credentials-$scope").commit()
    }
  }
}
