package com.dapillah.gameportal

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.util.Log
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in paired test. Logcat prints each fresh match link for a real browser partner.
 * Browser O joins and plays [3,4] for the win, then [1,4,5,6] for the draw.
 * Android X makes the final move; see VALIDATION.md for the deployed web legacy-null bug.
 * Completed matches remain available in both portals for inspection.
 */
class BrowserInteropTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun vm() = ViewModelProvider(compose.activity)[PortalViewModel::class.java]
    private fun waitFor(condition: () -> Boolean) = compose.waitUntil(180_000, condition)

    @Test fun browserAndAndroidCompleteWinAndDraw() {
        assumeTrue("Enable explicitly with a real browser partner",
            InstrumentationRegistry.getArguments().getString("browserPartner") == "true")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val config = Configurator.getInstance()
        val previousTimeout = config.waitForIdleTimeout
        config.waitForIdleTimeout = 100
        device.wakeUp(); device.pressMenu()
        try {
            waitFor { !vm().state.value.loading }
            if (vm().state.value.account == null) {
                compose.onNodeWithText("Your player name").performTextInput("Android demo")
                compose.onNodeWithText("Let's play").performClick()
                waitFor { vm().state.value.account != null && !vm().state.value.busy }
            }
            listOf(listOf(0, 1, 2), listOf(0, 2, 3, 7, 8)).forEachIndexed { scenario, cells ->
                compose.runOnUiThread {
                    compose.activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    vm().closeMatch()
                }
                waitFor { vm().state.value.selectedId == null && vm().state.value.online }
                compose.onNodeWithTag("create-tictactoe").performScrollTo().performClick()
                waitFor { vm().state.value.match?.status == "waiting_for_players" && !vm().state.value.busy }
                val id = vm().state.value.match!!.id
                Log.i("PortalBrowserTest", "Browser match $scenario: ${vm().matchLink()}")
                waitFor { vm().state.value.match?.players?.size == 2 }
                compose.onNodeWithText("Start game").performClick()
                waitFor { vm().state.value.match?.status == "ongoing" && !vm().state.value.busy }
                cells.forEachIndexed { turn, cell ->
                    waitFor { vm().state.value.match?.moveCount == turn * 2 && !vm().state.value.busy }
                    compose.tapGameCell(cell)
                    waitFor { (vm().state.value.match?.moveCount ?: 0) >= turn * 2 + 1 && !vm().state.value.busy }
                }
                waitFor { vm().state.value.match?.status == "over" }
                val result = vm().state.value.match!!.state.jsonObject
                assertEquals(scenario == 1, result.getValue("draw").jsonPrimitive.boolean)
                if (scenario == 0) assertEquals(0, result.getValue("winner").jsonPrimitive.int)
                val account = vm().state.value.account
                for (orientation in listOf(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)) {
                    compose.runOnUiThread { compose.activity.requestedOrientation = orientation }
                    val expected = if (orientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)
                        Configuration.ORIENTATION_LANDSCAPE else Configuration.ORIENTATION_PORTRAIT
                    waitFor { compose.activity.resources.configuration.orientation == expected && vm().state.value.match?.id == id }
                    assertEquals(account, vm().state.value.account)
                }
                Log.i("PortalBrowserTest", "Completed scenario $scenario and rotation: $id")
            }
        } finally { config.waitForIdleTimeout = previousTimeout }
    }
}
