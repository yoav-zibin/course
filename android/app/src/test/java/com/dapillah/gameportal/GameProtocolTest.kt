package com.dapillah.gameportal

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class GameProtocolTest {
    private fun match(turn: List<Int>? = listOf(0), status: String = "ongoing") = Match(
        "match-1", "tictactoe", 1, "alice", status,
        listOf(Player(0, "human", "alice"), Player(1, "human", "bob")), turn,
        PortalJson.parseToJsonElement("{\"board\":[\"X\",\"\",\"\"]}"), 1,
    )
    @Test fun `finishing move retains explicit null turn and opaque JSON`() {
        val move = GameProtocol.parseMove(PortalJson.parseToJsonElement("""{"type":"make_move","new_state":{"nested":[false,null,3]},"next_turn_player_indices":null}""").jsonObject, 8)
        val body = PortalJson.parseToJsonElement(PortalJson.encodeToString(move)).jsonObject
        assertEquals(JsonNull, body["next_turn_player_indices"])
        assertEquals(JsonPrimitive(8), body["expected_move_count"])
        assertEquals(PortalJson.parseToJsonElement("""{"nested":[false,null,3]}"""), body["new_state"])
    }
    @Test fun `legacy game moves remain compatible`() {
        val move = GameProtocol.parseMove(PortalJson.parseToJsonElement("""{"type":"make_move","new_state":null,"next_turn_player_index":1}""").jsonObject, 0)
        assertEquals(listOf(1), move.next)
        assertEquals(JsonNull, move.state)
        val finished = GameProtocol.parseMove(PortalJson.parseToJsonElement("""{"type":"make_move","new_state":{},"next_turn_player_index":null}""").jsonObject, 9)
        assertNull(finished.next)
    }
    @Test fun `ended match and spectator cannot act`() {
        val ended = GameProtocol.stateChanged(match(null, "over"), "alice", emptyMap(), true)
        assertEquals(JsonNull, ended["acting_for_player_index"])
        assertEquals(JsonNull, ended["turn_of_player_index"])
        assertEquals(JsonNull, ended["turn_of_player_indices"])
        val spectator = GameProtocol.stateChanged(match(), "stranger", emptyMap(), true)
        assertEquals(JsonNull, spectator["my_player_index"])
        assertEquals(JsonNull, spectator["acting_for_player_index"])
    }
    @Test fun `bot seat can be played by a seated human only`() {
        val game = match(listOf(1)).copy(players = listOf(Player(0, "human", "alice"), Player(1, "computer")))
        assertEquals(1, game.actingFor("alice"))
        assertNull(game.actingFor("stranger"))
        assertEquals(JsonNull, GameProtocol.stateChanged(game, "alice", emptyMap(), false)["acting_for_player_index"])
    }
    @Test fun `malformed game messages cannot become network moves`() {
        val invalid = listOf(
            """{"type":"make_move","next_turn_player_indices":[1]}""",
            """{"type":"make_move","new_state":{},"next_turn_player_indices":[]}""",
            """{"type":"make_move","new_state":{},"next_turn_player_indices":["1"]}""",
            """{"type":"make_move","new_state":{},"next_turn_player_indices":[1,1]}""",
            """{"type":"other","new_state":{},"next_turn_player_indices":[1]}""",
        )
        invalid.forEach { assertThrows(IllegalArgumentException::class.java) { GameProtocol.parseMove(PortalJson.parseToJsonElement(it).jsonObject, 0) } }
    }
    @Test fun `match links cannot silently switch servers`() {
        assertEquals("abc-123", matchIdFromInput("https://buildplay.fun/portal#match=abc-123", "https://buildplay.fun/"))
        assertEquals("abc-123", matchIdFromInput("abc-123", "https://buildplay.fun/"))
        assertThrows(IllegalArgumentException::class.java) { matchIdFromInput("https://other.example/portal#match=abc", "https://buildplay.fun/") }
        assertThrows(IllegalArgumentException::class.java) { matchIdFromInput("../users", "https://buildplay.fun/") }
    }
}
