package com.dapillah.gameportal

import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.UiDevice

/** Reacquire accessibility nodes while the game rerenders after state_changed. */
fun AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>.tapGameCell(index: Int) {
    val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    var last = ""
    try { waitUntil(30_000) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 33)
                InstrumentationRegistry.getInstrumentation().uiAutomation.clearCache()
            val cells = device.findObject(By.clazz("android.webkit.WebView"))
                ?.findObjects(By.clazz("android.widget.Button"))
                ?.map { it.visibleBounds to it.isEnabled }
                ?.sortedWith(compareBy({ it.first.top }, { it.first.left })).orEmpty()
            val observed = cells.toString()
            if (observed != last) { android.util.Log.i("PortalUITest", "Cell $index: $observed"); last = observed }
            if (cells.size != 9 || !cells[index].second) false
            else {
                val bounds = cells[index].first
                device.click(bounds.centerX(), bounds.centerY())
            }
        } catch (_: StaleObjectException) { false }
    } } catch (failure: Throwable) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val resolver = instrumentation.targetContext.contentResolver
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "playroom-test-failure.png")
            put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Playroom")
        }
        val uri = if (android.os.Build.VERSION.SDK_INT >= 29)
            resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) else null
        if (uri != null) resolver.openOutputStream(uri)?.use {
            instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        throw AssertionError("Cannot tap cell $index; last board=$last; screenshot=$uri", failure)
    }
}
