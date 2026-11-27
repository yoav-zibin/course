package com.buildplay.legacyportal

import android.app.Activity
import android.app.Application
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.FutureTask

open class PortalApplication : Application() {
  private val lateRegistrations = ThreadLocal<MutableList<ActivityLifecycleCallbacks>>()

  override fun registerActivityLifecycleCallbacks(callback: ActivityLifecycleCallbacks) {
    val pending = lateRegistrations.get()
    if (pending == null) super.registerActivityLifecycleCallbacks(callback) else pending.add(callback)
  }

  /** Firebase registers its Activity listener during getInstance(). When the
   * Worklet starts after onResume, Android only delivers subsequent transitions.
   * Attach that listener and catch it up to the real Activity on the main loop. */
  internal fun <T> initializeWithCurrentActivity(activity: () -> Activity?, initialize: () -> T): T {
    val pending = mutableListOf<ActivityLifecycleCallbacks>()
    lateRegistrations.set(pending)
    return try {
      initialize()
    } finally {
      lateRegistrations.remove()
      if (pending.isNotEmpty()) attachToCurrentActivity(pending, activity)
    }
  }

  private fun attachToCurrentActivity(listeners: List<ActivityLifecycleCallbacks>, activity: () -> Activity?) {
    val attach = FutureTask<Unit> {
      val current = activity()
      val state = (current as? LifecycleOwner)?.lifecycle?.currentState
      for (listener in listeners) {
        registerActivityLifecycleCallbacks(listener)
        if (current != null && state != null) {
          if (state.isAtLeast(Lifecycle.State.CREATED)) listener.onActivityCreated(current, null)
          if (state.isAtLeast(Lifecycle.State.STARTED)) listener.onActivityStarted(current)
          if (state.isAtLeast(Lifecycle.State.RESUMED)) listener.onActivityResumed(current)
        }
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) attach.run()
    else check(Handler(Looper.getMainLooper()).post(attach))
    attach.get() // The Worklet waits for lifecycle delivery before its first screen_view.
  }
}
