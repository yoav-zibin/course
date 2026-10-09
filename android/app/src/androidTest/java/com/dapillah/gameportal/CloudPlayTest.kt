package com.dapillah.gameportal

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Configurator
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Opt-in: real Android UI + unchanged TicTacToe HTML against a second cloud API client. */
class CloudPlayTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val previousIdleTimeout = Configurator.getInstance().waitForIdleTimeout
    @After fun restoreAutomationSettings() {
        Configurator.getInstance().waitForIdleTimeout = previousIdleTimeout
    }
    private fun vm() = ViewModelProvider(compose.activity)[PortalViewModel::class.java]
    private fun waitFor(condition: () -> Boolean) = compose.waitUntil(30_000, condition)

    @Test fun androidPlaysWinAndDrawAgainstSecondCloudClient() = runBlocking {
        assumeTrue("Enable explicitly against an authorized test backend",
            InstrumentationRegistry.getArguments().getString("liveBackend") == "true")
        Configurator.getInstance().waitForIdleTimeout = 100
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).apply { wakeUp(); pressMenu() }
        compose.runOnUiThread { compose.activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        waitFor { !vm().state.value.loading }
        if (vm().state.value.account == null) {
            compose.onNodeWithText("Your player name").performTextInput("Android demo")
            compose.onNodeWithText("Let's play").performClick()
            waitFor { vm().state.value.account != null && !vm().state.value.busy }
        }
        val vault = SessionVault(compose.activity, "${BuildConfig.BASE_URL}#integration-opponent")
        var opponent = vault.read()
        val service = makeApi(BuildConfig.BASE_URL) { opponent }
        if (opponent == null) {
            val created = service.createUser(NewUser("Cloud test opponent"))
            opponent = Credentials(created.id, created.name, requireNotNull(created.password))
            vault.save(opponent!!)
        }
        for ((label, cells) in listOf("win" to listOf(0, 3, 1, 4, 2), "draw" to listOf(0, 1, 2, 4, 3, 5, 7, 6, 8))) {
            compose.runOnUiThread { vm().closeMatch() }
            waitFor { vm().state.value.selectedId == null && vm().state.value.online }
            compose.onNodeWithTag("create-tictactoe").performScrollTo().performClick()
            waitFor { vm().state.value.match?.status == "waiting_for_players" && !vm().state.value.busy }
            val id = vm().state.value.match!!.id
            try {
                service.join(id)
                waitFor { vm().state.value.match?.players?.size == 2 }
                compose.onNodeWithText("Start game").performClick()
                waitFor { vm().state.value.match?.status == "ongoing" && !vm().state.value.busy }
                val board = MutableList(9) { "" }
                cells.forEachIndexed { number, cell ->
                    Log.i("PortalUITest", "Scenario $label, move $number, native count ${vm().state.value.match?.moveCount}")
                    board[cell] = if (number % 2 == 0) "X" else "O"
                    if (number % 2 == 0) {
                        compose.tapGameCell(cell)
                    } else {
                        service.move(id, Move(buildJsonObject {
                            put("board", JsonArray(board.map(::JsonPrimitive)))
                            put("winner", JsonNull); put("draw", false)
                        }, listOf(0), number))
                    }
                    try {
                        waitFor { vm().state.value.match?.moveCount == number + 1 && !vm().state.value.busy }
                    } catch (error: Throwable) {
                        throw AssertionError("Move $number failed: count=${vm().state.value.match?.moveCount}, error=${vm().state.value.error}", error)
                    }
                    assertEquals(JsonArray(board.map(::JsonPrimitive)), service.match(id).state.jsonObject["board"])
                    if (number == 0) {
                        val account = vm().state.value.account
                        compose.activityRule.scenario.recreate()
                        waitFor { vm().state.value.match?.id == id && vm().state.value.online }
                        assertEquals(account, vm().state.value.account)
                    }
                }
                val ended = service.match(id)
                assertEquals("over", ended.status)
                assertEquals(label == "draw", ended.state.jsonObject.getValue("draw").jsonPrimitive.boolean)
                if (label == "win") assertEquals(0, ended.state.jsonObject.getValue("winner").jsonPrimitive.int)
                // A fresh ViewModel restores the persisted session/selection independently of UI state.
                val restored = PortalViewModel(compose.activity.application)
                assertEquals(id, restored.state.value.selectedId)
                assertEquals(vm().state.value.account, restored.state.value.account)
            } finally {
                // Delete only the temporary match created by this test, using its Android owner.
                val ownerApi = makeApi(BuildConfig.BASE_URL) { vm().state.value.account }
                ownerApi.delete(id)
                compose.runOnUiThread { vm().closeMatch() }
                waitFor { vm().state.value.selectedId == null }
            }
        }
    }
}
