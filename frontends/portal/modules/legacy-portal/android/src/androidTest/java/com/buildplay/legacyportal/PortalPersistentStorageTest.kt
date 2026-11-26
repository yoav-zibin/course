package com.buildplay.legacyportal

import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test

class PortalPersistentStorageTest {
  @Test fun largePersistentValuesSurviveNewStoreAndDelete() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val key = "large-storage-${UUID.randomUUID()}"
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
}
