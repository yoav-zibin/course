package com.dapillah.gameportal

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException

class PortalApiTest {
    @Test fun `requests use course headers and preserve game version and null turns`() = runTest {
        MockWebServer().use { server ->
            val account = Credentials("alice", "Alice", "private-test-value")
            val api = makeApi(server.url("/").toString()) { account }
            server.enqueue(MockResponse().setBody("""{"id":"m","game_id":"g","game_version":3,"owner_user_id":"alice","status":"over","players":[{"player_index":0,"kind":"human","user_id":"alice"}],"turn_of_player_indices":null,"state":{"board":["X"]},"move_count":5,"end_reason":"finished","future_field":true}"""))
            val result = api.move("m", Move(PortalJson.parseToJsonElement("""{"board":["X"]}"""), null, 4))
            assertEquals(3, result.gameVersion)
            assertNull(result.turn)
            val request = server.takeRequest()
            assertEquals("/matches/m/moves", request.path)
            assertEquals("alice", request.getHeader("X-User-Id"))
            assertEquals("private-test-value", request.getHeader("X-User-Password"))
            val payload = PortalJson.parseToJsonElement(request.body.readUtf8()).jsonObject
            assertEquals(setOf("new_state", "next_turn_player_indices", "expected_move_count"), payload.keys)
            assertEquals(JsonNull, payload["next_turn_player_indices"])
            assertEquals(JsonPrimitive(4), payload["expected_move_count"])
        }
    }
    @Test fun `stale moves are returned as conflicts without automatic resubmission`() = runTest {
        MockWebServer().use { server ->
            val api = makeApi(server.url("/").toString()) { null }
            server.enqueue(MockResponse().setResponseCode(409).setBody("""{"detail":"expected 0 moves"}"""))
            try { api.move("m", Move(JsonNull, listOf(1), 0)); fail("Expected conflict") }
            catch (error: HttpException) { assertEquals(409, error.code()) }
            assertEquals(1, server.requestCount)
        }
    }
}
