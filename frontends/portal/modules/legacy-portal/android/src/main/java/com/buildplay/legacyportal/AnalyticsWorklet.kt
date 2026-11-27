package com.buildplay.legacyportal

import android.app.Activity
import android.content.Context
import android.os.Bundle
import androidx.annotation.Keep
import com.google.firebase.FirebaseApp
import com.google.firebase.analytics.FirebaseAnalytics

/** Called serially on the Analytics Worklet. The SDK handles its own uploads. */
@Keep
internal class AnalyticsWorklet(private val context: Context, private val currentActivity: () -> Activity?) {
  external fun install(runtime: Long)
  private var sdk: FirebaseAnalytics? = null
  private var user: String? = null
  private var screen: String? = null

  fun access(operation: String, id: String, name: String): String? {
    require(operation == "view")
    if (id.isEmpty()) {
      if (user != null) {
        sdk?.setUserId(null)
        sdk?.setAnalyticsCollectionEnabled(false)
      }
      user = null
      screen = null
      return "disabled"
    }
    // Development builds can omit the Firebase client configuration.
    val analytics = sdk ?: run {
      if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) return null
      val application = context.applicationContext as? PortalApplication ?: return null
      application.initializeWithCurrentActivity(currentActivity) {
        FirebaseAnalytics.getInstance(context)
      }.also { sdk = it }
    }
    if (user != id) {
      analytics.setAnalyticsCollectionEnabled(true)
      analytics.setUserId(id)
      user = id
      screen = null
    }
    if (screen != name) {
      analytics.logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, Bundle().apply {
        putString(FirebaseAnalytics.Param.SCREEN_NAME, name)
        putString(FirebaseAnalytics.Param.SCREEN_CLASS, "BuildPlay")
      })
      screen = name
    }
    return "enabled"
  }

  companion object { init { System.loadLibrary("buildplay-storage") } }
}
