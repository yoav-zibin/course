package com.buildplay.legacyportal

import android.content.ComponentName
import android.content.pm.PackageManager
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.analytics.FirebaseAnalytics
import org.junit.Assert.*
import org.junit.Test

class AnalyticsConfigurationTest {
  @Test fun analyticsIsInstalledAndDeferredIndependentlyOfPush() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val manager = context.packageManager
    val flags = manager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
    assertFalse(flags.getBoolean("firebase_analytics_collection_enabled", true))
    assertFalse(flags.getBoolean("google_analytics_automatic_screen_reporting_enabled", true))
    assertFalse(flags.getBoolean("google_analytics_adid_collection_enabled", true))
    val discovery = ComponentName(context.packageName, "com.google.firebase.components.ComponentDiscoveryService")
    val components = manager.getServiceInfo(discovery, PackageManager.GET_META_DATA).metaData
    assertFalse(components?.containsKey("com.google.firebase.components:com.google.firebase.analytics.connector.internal.AnalyticsConnectorRegistrar") == true)
    assertEquals("screen_view", FirebaseAnalytics.Event.SCREEN_VIEW)
  }
}
