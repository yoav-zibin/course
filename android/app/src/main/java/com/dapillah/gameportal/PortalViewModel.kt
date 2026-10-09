package com.dapillah.gameportal

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import retrofit2.HttpException
import java.io.IOException

data class PortalState(
    val account: Credentials? = null,
    val games: List<Game> = emptyList(), val mine: List<Match> = emptyList(), val open: List<Match> = emptyList(),
    val selectedId: String? = null, val match: Match? = null, val game: Game? = null,
    val names: Map<String, String> = emptyMap(), val online: Boolean = false,
    val loading: Boolean = true, val busy: Boolean = false, val error: String? = null,
    val gameRevision: Int = 0,
)

class PortalViewModel internal constructor(application: Application, val baseUrl: String,
    apiFactory: (() -> Credentials?) -> PortalApi) : AndroidViewModel(application) {
    constructor(application: Application) : this(application, BuildConfig.BASE_URL,
        { credentials -> makeApi(BuildConfig.BASE_URL, credentials) })
    private val vault = SessionVault(application, baseUrl)
    private val _state = MutableStateFlow(PortalState())
    val state = _state.asStateFlow()
    private var credentials: Credentials? = null
    private val api: PortalApi? = if (baseUrl.isNotEmpty()) apiFactory { credentials } else null
    private val lock = Mutex()
    private var poll: Job? = null
    private val versions = mutableMapOf<String, Game>()

    init {
        try {
            credentials = vault.read()
            _state.update { it.copy(account = credentials, selectedId = vault.selectedId) }
        } catch (_: Exception) {
            _state.update { it.copy(error = "Your saved account could not be read. Creating a new guest will not restore its matches.") }
        }
        if (api == null) _state.update { it.copy(loading = false, error = "This build needs its game server configured.") }
    }

    fun setActive(active: Boolean) {
        poll?.cancel(); poll = null
        if (active && api != null) poll = viewModelScope.launch {
            while (isActive) {
                refresh()
                delay(if (_state.value.online) 2_000L else 5_000L)
            }
        }
    }
    fun retry() { viewModelScope.launch { refresh(); _state.update { it.copy(gameRevision = it.gameRevision + 1) } } }
    fun reportError(message: String) { _state.update { it.copy(error = message) } }

    private suspend fun refresh() = lock.withLock {
        try { load() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { _state.update { it.copy(loading = false, online = false, error = describe(error)) } }
    }

    private suspend fun load() {
        val service = api ?: return
        val account = credentials
        val (games, mine, open) = coroutineScope {
            val games = async { service.games() }
            val mine = async { if (account != null) service.mine() else emptyList() }
            val open = async { service.open() }
            Triple(games.await(), mine.await(), open.await())
        }
        var selectedId = _state.value.selectedId
        val match = selectedId?.let { id ->
            try { service.match(id) }
            catch (error: HttpException) {
                if (error.code() != 404) throw error
                selectedId = null; vault.selectedId = null
                _state.update { it.copy(error = "This match is no longer available.") }
                null
            }
        }
        val names = _state.value.names.toMutableMap()
        account?.let { names[it.id] = it.name }
        val visibleMatches = mine + open + listOfNotNull(match)
        for (id in visibleMatches.flatMap { it.players }.mapNotNull { it.userId }.distinct()) {
            if (id !in names) {
                try { names[id] = service.user(id).name }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { /* A missing display name must not prevent playing. */ }
            }
        }
        val game = match?.let {
            val key = "${it.gameId}@${it.gameVersion}"
            versions[key] ?: service.game(it.gameId, it.gameVersion).also { result -> versions[key] = result }
        }
        _state.update { it.copy(account = account, games = games, mine = mine, open = open,
            selectedId = selectedId, match = match, game = game, names = names, online = true, loading = false,
            error = if (!it.online) null else it.error) }
    }

    private fun action(operation: suspend (PortalApi) -> Unit) {
        if (_state.value.busy || api == null) return
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            lock.withLock {
                var operationError: String? = null
                try { operation(api) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) { operationError = describe(error) }
                finally {
                    try { load() }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) {
                        _state.update { it.copy(online = false) }
                        if (operationError == null) operationError = describe(error)
                    }
                    _state.update { it.copy(busy = false, loading = false,
                        error = operationError, gameRevision = it.gameRevision + 1) }
                }
            }
        }
    }

    fun signIn(name: String) {
        if (name.trim().isEmpty()) return reportError("Enter a player name to continue.")
        action { service ->
            val user = service.createUser(NewUser(name.trim()))
            val account = Credentials(user.id, user.name, requireNotNull(user.password))
            vault.save(account)
            credentials = account
            _state.update { it.copy(account = account) }
        }
    }
    private fun select(id: String?) {
        vault.selectedId = id
        _state.update { it.copy(selectedId = id, match = null, game = null, error = null) }
    }
    fun openMatch(input: String) {
        val id = try { matchIdFromInput(input, baseUrl) } catch (e: Exception) { return reportError(e.message ?: "Invalid match link") }
        viewModelScope.launch { lock.withLock { select(id) }; refresh() }
    }
    fun closeMatch() { viewModelScope.launch { lock.withLock { select(null) }; refresh() } }
    fun createMatch(game: Game, computers: Int = 0) { action { select(it.create(NewMatch(game.id, computers)).id) } }
    fun join() { val id = _state.value.match?.id ?: return; action { it.join(id) } }
    fun start() { val id = _state.value.match?.id ?: return; action { it.start(id) } }
    fun computers(number: Int) { val id = _state.value.match?.id ?: return; action { it.computers(id, Computers(number)) } }
    fun leave() { val id = _state.value.match?.id ?: return; action { it.leave(id); select(null) } }
    fun delete() { val id = _state.value.match?.id ?: return; action { it.delete(id); select(null) } }

    fun makeMove(key: String, expected: Int, message: JsonObject) {
        val current = _state.value
        val match = current.match ?: return
        if (key != match.key || current.busy) return
        if (!current.online) return reportError("Reconnect before making a move.")
        if (expected != match.moveCount || match.actingFor(credentials?.id) == null) {
            _state.update { it.copy(gameRevision = it.gameRevision + 1) }; retry(); return
        }
        val move = try { GameProtocol.parseMove(message, expected) }
            catch (error: Exception) {
                reportError(error.message ?: "The game sent an invalid move")
                retry()
                return
            }
        action { service ->
            // The refresh loop shares this mutex; recheck after awaiting it.
            val latest = _state.value.match
            if (latest?.key == key && latest.moveCount == expected && latest.actingFor(credentials?.id) != null) {
                service.move(latest.id, move)
            }
        }
    }

    fun matchLink() = _state.value.match?.let { "${baseUrl.trimEnd('/')}/portal#match=${it.id}" }.orEmpty()

    private fun describe(error: Exception): String = when (error) {
        is HttpException -> {
            val detail = runCatching { PortalJson.parseToJsonElement(error.response()?.errorBody()?.string().orEmpty()).jsonObject["detail"] }
                .getOrNull()
            when (error.code()) {
                401 -> "Your account was not accepted by this server. Check that the original server is available."
                409 -> "The match changed. We refreshed it; check the board before trying again."
                else -> (detail as? JsonPrimitive)?.content ?: "The server rejected this request (${error.code()})."
            }
        }
        is IOException -> "Connection interrupted. Reconnect and retry; the latest saved match will be loaded."
        else -> error.message ?: "Something went wrong. Please retry."
    }
}
