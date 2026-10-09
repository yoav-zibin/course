package com.dapillah.gameportal

import android.annotation.SuppressLint
import android.graphics.Color
import android.webkit.*
import android.util.Log
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.serialization.json.*

const val HOST_ORIGIN = "https://appassets.androidplatform.net"
const val HOST_URL = "$HOST_ORIGIN/assets/game-host.html"

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun GameView(state: PortalState, modifier: Modifier = Modifier,
    onMove: (String, Int, JsonObject) -> Unit, onError: (String) -> Unit) {
    val match = state.match ?: return
    val game = state.game ?: return
    val payload = buildJsonObject {
        put("key", match.key); put("code", game.code); put("revision", state.gameRevision)
        put("message", GameProtocol.stateChanged(match, state.account?.id, state.names, state.online && !state.busy))
    }.toString()
    val currentPayload by rememberUpdatedState(payload)
    val currentMove by rememberUpdatedState(onMove)
    val currentError by rememberUpdatedState(onError)
    var instance by remember { mutableStateOf<WebView?>(null) }
    DisposableEffect(Unit) { onDispose { instance?.apply { stopLoading(); destroy() } } }
    AndroidView(modifier = modifier, factory = { context ->
        WebView(context).apply {
            instance = this
            initializeGameWebView(this, { currentPayload },
                { key, expected, move -> currentMove(key, expected, move) }, { currentError(it) })
        }
    }, update = { view ->
        view.evaluateJavascript("window.PortalHost && window.PortalHost.render($payload)", null)
    })
}


/** Shared by the Compose screen and instrumented bridge tests. Never receives credentials. */
@SuppressLint("SetJavaScriptEnabled")
internal fun initializeGameWebView(view: WebView, payload: () -> String,
    onMove: (String, Int, JsonObject) -> Unit, onError: (String) -> Unit) {
    with(view) {
        setBackgroundColor(Color.WHITE)
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.domStorageEnabled = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = false
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG && message.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                    Log.e("PortalGame", "${message.message()} (${message.lineNumber()})")
                return true
            }
        }
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Allow the sandboxed srcdoc document to load; never navigate the trusted host.
                val internalFrame = !request.isForMainFrame && request.url.toString() in setOf("about:srcdoc", "about:blank")
                if (BuildConfig.DEBUG && !internalFrame) Log.d("PortalGame", "Blocked navigation: ${request.url.scheme}")
                return !internalFrame
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (url == HOST_URL) view.evaluateJavascript("window.PortalHost && window.PortalHost.render(${payload()})", null)
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) onError("The game could not load. Return to the lobby and reopen the match.")
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(this, "PortalNative", setOf(HOST_ORIGIN)) { view, data, origin, mainFrame, _ ->
                if (!mainFrame || origin.toString().trimEnd('/') != HOST_ORIGIN) return@addWebMessageListener
                try {
                    val envelope = PortalJson.parseToJsonElement(data.data ?: "").jsonObject
                    when (envelope["type"]?.jsonPrimitive?.content) {
                        "ready" -> view.evaluateJavascript("window.PortalHost.render(${payload()})", null)
                        "move" -> onMove(envelope.getValue("key").jsonPrimitive.content,
                            envelope.getValue("expected").jsonPrimitive.int, envelope.getValue("move").jsonObject)
                    }
                } catch (_: Exception) { onError("The game sent a message we could not understand.") }
            }
            loadUrl(HOST_URL)
        } else onError("Update Android System WebView to play this game.")
    }
}
