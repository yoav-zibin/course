package com.buildplay.legacyportal

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.security.MessageDigest
import org.json.JSONObject

/** Large JSON values stay outside SQLite's row/window and database size limits. */
internal class PortalPersistentStorage(context: Context) {
  private val directory = File(context.filesDir, "BuildPlayShared")

  private fun prepareDirectory() {
    if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Persistent storage directory is unavailable")
  }

  private fun hash(key: String) = MessageDigest.getInstance("SHA-256")
    .digest(key.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

  private fun file(key: String) = File(directory, hash(key) + ".json")

  private fun read(file: File): JSONObject? {
    val text = try { AtomicFile(file).openRead().use { String(it.readBytes(), Charsets.UTF_8) } }
    catch (error: FileNotFoundException) {
      if (!file.exists() && !File(file.path + ".bak").exists()) return null
      throw error
    }
    val envelope = JSONObject(text)
    val key = envelope.get("key")
    require(key is String && envelope.get("value") is String) { "Persistent storage item is invalid" }
    require(file.name == hash(key) + ".json") { "Persistent storage key does not match its file" }
    return envelope
  }

  fun get(key: String): String? = synchronized(lock) {
    prepareDirectory()
    read(file(key))?.also { require(it.getString("key") == key) }?.getString("value")
  }

  fun set(key: String, value: String) = synchronized(lock) {
    prepareDirectory()
    val target = file(key)
    val atomic = AtomicFile(target)
    val data = JSONObject().put("key", key).put("value", value).toString().toByteArray(Charsets.UTF_8)
    val output = atomic.startWrite()
    try {
      output.write(data)
      atomic.finishWrite(output)
      if (!target.isFile || File(target.path + ".new").exists()) throw IOException("Persistent storage write could not be committed")
    } catch (error: Throwable) {
      atomic.failWrite(output)
      throw error
    }
  }

  fun remove(key: String) = synchronized(lock) {
    prepareDirectory()
    val file = file(key)
    AtomicFile(file).delete()
    if (file.exists() || File(file.path + ".bak").exists() || File(file.path + ".new").exists()) {
      throw IOException("Persistent storage item could not be removed")
    }
  }

  fun keys(): List<String> = synchronized(lock) {
    prepareDirectory()
    val files = directory.listFiles() ?: throw IOException("Persistent storage directory could not be read")
    files.mapNotNull { candidate ->
      val name = candidate.name.removeSuffix(".bak")
      if (candidate.isFile && name.matches(Regex("[a-f0-9]{64}\\.json"))) name else null
    }.distinct().sorted().mapNotNull { name -> read(File(directory, name))?.getString("key") }
  }

  companion object { private val lock = Any() }
}
