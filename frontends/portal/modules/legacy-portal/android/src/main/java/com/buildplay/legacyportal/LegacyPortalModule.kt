package com.buildplay.legacyportal

import android.graphics.Rect
import android.os.Build
import android.util.Log
import android.view.View
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.annotations.FrameworkAPI
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** App-owned files, launch settings and gesture handling for native builds. */
class LegacyPortalModule : Module() {
  private fun storage() = PortalPersistentStorage(appContext.reactContext
    ?: throw IllegalStateException("The application context is unavailable"))

  @OptIn(FrameworkAPI::class)
  override fun definition() = ModuleDefinition {
    Name("LegacyPortal")

    Function("readLocalUiTest") {
      appContext.currentActivity?.intent?.getBooleanExtra("buildplayLocalUiTest", false) ?: false
    }

    Function("installStorageWorklet") {
      val pointer = (appContext.reactContext as? ReactApplicationContext)?.javaScriptContextHolder?.get() ?: 0L
      check(pointer != 0L) { "The JavaScript runtime is unavailable" }
      StorageWorklet(storage()).install(pointer)
    }

    Function("installAnalyticsWorklet") {
      val context = appContext.reactContext as? ReactApplicationContext ?: error("No React context")
      val pointer = context.javaScriptContextHolder?.get() ?: 0L
      check(pointer != 0L) { "The JavaScript runtime is unavailable" }
      AnalyticsWorklet(context.applicationContext) { appContext.currentActivity }.install(pointer)
    }

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
  }
}
