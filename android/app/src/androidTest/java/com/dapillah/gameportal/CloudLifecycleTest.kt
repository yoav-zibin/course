package com.dapillah.gameportal

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in: temporarily disables this test emulator's Wi-Fi/data and restores their prior state. */
class CloudLifecycleTest {
    private fun awaitCondition(check: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 60_000
        while (!check()) {
            check(SystemClock.elapsedRealtime() < deadline) { "Lifecycle/network condition timed out" }
            Thread.sleep(100)
        }
    }

    @Test fun closedActivityRestoresAndRealNetworkRecovers() = runBlocking {
        assumeTrue("Run explicitly on the dedicated emulator",
            InstrumentationRegistry.getArguments().getString("lifecycleBackend") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as Application
        val vault = SessionVault(app, BuildConfig.BASE_URL)
        var account = vault.read()
        val api = makeApi(BuildConfig.BASE_URL) { account }
        if (account == null) {
            val user = api.createUser(NewUser("Android demo"))
            account = Credentials(user.id, user.name, requireNotNull(user.password))
            vault.save(account!!)
        }
        val previousMatch = vault.selectedId
        val match = api.create(NewMatch("tictactoe"))
        vault.selectedId = match.id
        val device = UiDevice.getInstance(instrumentation)
        val wifi = device.executeShellCommand("settings get global wifi_on").trim() == "1"
        val data = device.executeShellCommand("settings get global mobile_data").trim() == "1"
        var radioChanged = false
        try {
            lateinit var original: PortalViewModel
            ActivityScenario.launch(MainActivity::class.java).use { first ->
                first.onActivity { original = ViewModelProvider(it)[PortalViewModel::class.java] }
                awaitCondition { original.state.value.match?.id == match.id && original.state.value.online }
            }
            ActivityScenario.launch(MainActivity::class.java).use { reopened ->
                lateinit var restored: PortalViewModel
                reopened.onActivity {
                    it.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    restored = ViewModelProvider(it)[PortalViewModel::class.java]
                }
                assertNotSame(original, restored)
                awaitCondition { restored.state.value.match?.id == match.id && restored.state.value.online }
                assertEquals(account, restored.state.value.account)
                radioChanged = true
                device.executeShellCommand("svc wifi disable")
                device.executeShellCommand("svc data disable")
                reopened.onActivity { restored.retry() }
                awaitCondition { !restored.state.value.online && restored.state.value.error != null }
                assertEquals(match.id, restored.state.value.selectedId)
                if (wifi) device.executeShellCommand("svc wifi enable")
                if (data) device.executeShellCommand("svc data enable")
                radioChanged = false
                reopened.onActivity { restored.retry() }
                awaitCondition { restored.state.value.online && restored.state.value.match?.id == match.id }
                assertEquals(0, restored.state.value.match!!.moveCount)
                assertEquals(account, restored.state.value.account)
            }
        } finally {
            if (radioChanged) {
                if (wifi) device.executeShellCommand("svc wifi enable")
                if (data) device.executeShellCommand("svc data enable")
            }
            vault.selectedId = previousMatch
            api.delete(match.id)
        }
    }
}
