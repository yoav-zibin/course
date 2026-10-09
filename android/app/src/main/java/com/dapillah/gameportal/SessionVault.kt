package com.dapillah.gameportal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.encodeToString

class SessionVault(context: Context, baseUrl: String) {
    private val preferences = context.getSharedPreferences("portal-session", Context.MODE_PRIVATE)
    private val scope = MessageDigest.getInstance("SHA-256").digest(baseUrl.toByteArray())
        .joinToString("") { "%02x".format(it) }
    private val alias = "game-portal-$scope"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(): Credentials? {
        val sealed = preferences.getString("credentials-$scope", null) ?: return null
        val parts = sealed.split(':')
        require(parts.size == 2) { "Stored account is unreadable" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        val plain = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)).toString(Charsets.UTF_8)
        return PortalJson.decodeFromString(plain)
    }
    fun save(credentials: Credentials) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(cipher.doFinal(PortalJson.encodeToString(credentials).toByteArray()), Base64.NO_WRAP)
        check(preferences.edit().putString("credentials-$scope", sealed).commit()) { "Could not save your account on this device" }
    }
    var selectedId: String?
        get() = preferences.getString("match-$scope", null)
        set(value) { preferences.edit().putString("match-$scope", value).apply() }
}
