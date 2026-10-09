package com.dapillah.gameportal

import android.app.Application
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.security.KeyStore
import java.util.UUID

class MoveRecoveryTest {
    @Test fun lostAcknowledgementBlocksReplayUntilAuthoritativeRefresh() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as Application
        val scope = "https://recovery-${UUID.randomUUID()}.invalid/"
        val preferences = app.getSharedPreferences("portal-session", 0)
        val before = preferences.all.keys
        SessionVault(app, scope).apply { save(Credentials("alice", "Alice", "test-password")); selectedId = "test-match" }
        val accepted = CompletableDeferred<Unit>()
        val disconnect = CompletableDeferred<Unit>()
        var offline = false
        var calls = 0
        var submittedCount: Int? = null
        var saved = Match("test-match", "test-game", 1, "alice", "ongoing",
            listOf(Player(0, "human", "alice"), Player(1, "human", "bob")), listOf(0), JsonNull, 0)
        val game = Game("test-game", "Test", version = 1, counts = listOf(2), code = "")
        val api = object : UnusedApi() {
            override suspend fun games(): List<Game> {
                if (offline) throw IOException("network unavailable")
                return listOf(game)
            }
            override suspend fun mine() = listOf(saved)
            override suspend fun open() = emptyList<Match>()
            override suspend fun match(id: String) = saved
            override suspend fun user(id: String) = User(id, id)
            override suspend fun game(id: String, version: Int) = game
            override suspend fun move(id: String, body: Move): Match {
                calls++; submittedCount = body.expected
                saved = saved.copy(state = body.state, moveCount = 1, turn = listOf(1))
                accepted.complete(Unit)
                disconnect.await()
                offline = true
                throw IOException("server committed, but response was lost")
            }
        }
        lateinit var vm: PortalViewModel
        val store = ViewModelStore()
        try {
            instrumentation.runOnMainSync {
                vm = PortalViewModel(app, scope) { api }
                store.put("test", vm); vm.setActive(true)
            }
            withTimeout(10_000) { vm.state.first { it.online && it.match != null } }
            val move = PortalJson.parseToJsonElement("""{"type":"make_move","new_state":"committed","next_turn_player_indices":[1]}""")
                as kotlinx.serialization.json.JsonObject
            instrumentation.runOnMainSync { vm.makeMove(saved.key, 0, move) }
            withTimeout(10_000) { accepted.await() }
            instrumentation.runOnMainSync { vm.makeMove(saved.key, 0, move) }
            assertEquals("Only one move may be in flight", 1, calls)
            assertEquals(0, submittedCount)
            disconnect.complete(Unit)
            withTimeout(10_000) { vm.state.first { !it.busy && !it.online } }
            instrumentation.runOnMainSync { vm.makeMove(saved.key, 0, move) }
            assertEquals("An uncertain offline move must not be replayed", 1, calls)
            offline = false
            instrumentation.runOnMainSync { vm.retry() }
            val restored = withTimeout(10_000) { vm.state.first { it.online && it.match?.moveCount == 1 } }
            assertEquals(JsonPrimitive("committed"), restored.match!!.state)
            assertNull(restored.match.actingFor("alice"))
            assertEquals(1, calls)
        } finally {
            instrumentation.runOnMainSync { store.clear() }
            val editor = preferences.edit()
            val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (preferences.all.keys - before).forEach {
                editor.remove(it)
                if (it.startsWith("credentials-")) keys.deleteEntry("game-portal-${it.removePrefix("credentials-")}")
            }
            editor.commit()
        }
    }
}

private abstract class UnusedApi : PortalApi {
    override suspend fun createUser(body: NewUser): User = error("unused")
    override suspend fun create(body: NewMatch): Match = error("unused")
    override suspend fun join(id: String): Match = error("unused")
    override suspend fun start(id: String, body: StartMatch): Match = error("unused")
    override suspend fun leave(id: String): Match = error("unused")
    override suspend fun computers(id: String, body: Computers): Match = error("unused")
    override suspend fun delete(id: String): Unit = error("unused")
}
