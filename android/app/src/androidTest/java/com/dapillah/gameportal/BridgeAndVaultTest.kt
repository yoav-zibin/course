package com.dapillah.gameportal

import android.webkit.WebView
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class BridgeAndVaultTest {
    @Test fun composeGameFrameHasUsableViewport() {
        val heights = LinkedBlockingQueue<Int>()
        val code = """<!doctype html><html><body><script>
            addEventListener('message', e => {
              if (e.data.type === 'state_changed') parent.postMessage({type:'make_move',
                new_state:{height:innerHeight},next_turn_player_indices:[1]}, '*');
            });
            </script></body></html>"""
        val match = Match("viewport", "test", 1, "alice", "ongoing",
            listOf(Player(0, "human", "alice"), Player(1, "human", "bob")), listOf(0), moveCount = 0)
        val state = PortalState(account = Credentials("alice", "Alice", "fixture"),
            match = match, game = Game("test", "Test", version = 1, counts = listOf(2), code = code), online = true)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity -> activity.setContent {
                GameView(state, Modifier.fillMaxSize(), { _, _, move ->
                    heights.offer(move.getValue("new_state").jsonObject.getValue("height").jsonPrimitive.int)
                }, { error(it) })
            } }
            val height = heights.poll(15, TimeUnit.SECONDS)
            assertNotNull("Game iframe did not load", height)
            assertTrue("The frame must not collapse with the document's percentage height", height!! > 100)
        }
    }

    @Test fun sandboxAndBridgeEnforceSourceAndResendAuthoritativeState() {
        val moves = LinkedBlockingQueue<Triple<String, Int, JsonObject>>()
        val errors = LinkedBlockingQueue<String>()
        var revision = 0
        val code = """
            <!doctype html><html><body><script>
            window.addEventListener('message', event => {
              if (event.data.type !== 'state_changed') return;
              let parentReadable = false;
              try { parentReadable = !!parent.document; } catch (_) {}
              // A nested untrusted frame must not be able to impersonate this game.
              const child = document.createElement('iframe');
              child.srcdoc = '<script>parent.parent.postMessage({type:"make_move",new_state:{forged:true}},"*")<\/script>';
              document.body.appendChild(child);
              setTimeout(() => {
                const move = {type:'make_move', new_state:{nativeBridge:typeof PortalNative,
                  parentReadable, count:event.data.move_count, legacy:event.data.turn_of_player_index},
                  next_turn_player_indices:[1]};
                parent.postMessage(move, '*');
                parent.postMessage(move, '*');
              }, 100);
            });
            </script></body></html>
        """.trimIndent()
        fun payload() = buildJsonObject {
            put("key", "test@version-7"); put("code", code); put("revision", revision)
            putJsonObject("message") {
                put("type", "state_changed"); put("move_count", 4)
                put("turn_of_player_index", 0); put("state", JsonNull)
            }
        }.toString()
        lateinit var web: WebView
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                web = WebView(activity)
                activity.setContentView(web)
                initializeGameWebView(web, ::payload, { key, expected, move ->
                    moves.offer(Triple(key, expected, move))
                }, errors::offer)
            }
            val first = moves.poll(15, TimeUnit.SECONDS)
            assertNotNull("No game message; errors=$errors", first)
            assertEquals("test@version-7", first!!.first)
            assertEquals(4, first.second)
            val state = first.third.getValue("new_state").jsonObject
            assertEquals("undefined", state.getValue("nativeBridge").jsonPrimitive.content)
            assertFalse(state.getValue("parentReadable").jsonPrimitive.boolean)
            assertEquals(0, state.getValue("legacy").jsonPrimitive.int)
            assertNull("Duplicate or nested-frame move reached native", moves.poll(400, TimeUnit.MILLISECONDS))
            // An unrelated top-level message has the wrong event.source.
            scenario.onActivity { web.evaluateJavascript("window.postMessage({type:'make_move',new_state:'forged'}, '*')", null) }
            assertNull(moves.poll(200, TimeUnit.MILLISECONDS))
            revision++
            scenario.onActivity { web.evaluateJavascript("window.PortalHost.render(${payload()})", null) }
            assertEquals("Rejected moves must receive fresh state", 4, moves.poll(10, TimeUnit.SECONDS)?.second)
            assertNull(moves.poll(200, TimeUnit.MILLISECONDS))
            assertTrue(errors.toString(), errors.isEmpty())
            scenario.onActivity { web.stopLoading(); web.destroy() }
        }
    }

    @Test fun accountAndSelectedMatchSurviveNewVaultWithoutPlaintextStorage() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val scope = "https://vault-test-${UUID.randomUUID()}.invalid/"
        val before = context.getSharedPreferences("portal-session", 0).all.keys
        val account = Credentials("test-id", "Test player", UUID.randomUUID().toString())
        try {
            SessionVault(context, scope).apply { save(account); selectedId = "test-match" }
            SessionVault(context, scope).apply {
                assertEquals(account, read()); assertEquals("test-match", selectedId)
            }
            assertNull(SessionVault(context, "$scope/other").read())
            val stored = context.getSharedPreferences("portal-session", 0).all.values.joinToString()
            assertFalse(stored.contains(account.password))
            assertFalse(stored.contains(account.name))
        } finally {
            val preferences = context.getSharedPreferences("portal-session", 0)
            val added = preferences.all.keys - before
            val editor = preferences.edit()
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            added.forEach {
                editor.remove(it)
                if (it.startsWith("credentials-")) store.deleteEntry("game-portal-${it.removePrefix("credentials-")}")
            }
            editor.commit()
        }
    }
}
