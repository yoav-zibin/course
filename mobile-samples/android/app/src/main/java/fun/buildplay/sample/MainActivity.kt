package `fun`.buildplay.sample

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Tiny pipeline-proof app for BuildPlay: one screen, no libraries.
 * It proves the cloud build works and that the installed app can reach
 * the live platform at https://buildplay.fun.
 */
class MainActivity : Activity() {

    private lateinit var statusView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val padding = (24 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(padding, padding * 2, padding, padding)
        }

        val title = TextView(this).apply {
            text = "BuildPlay Sample"
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        val subtitle = TextView(this).apply {
            text = "Android sample for buildplay.fun\nBuilt in the cloud with GitHub Actions — no local machine involved."
            textSize = 16f
            gravity = Gravity.CENTER
        }
        statusView = TextView(this).apply {
            text = "Tap the button to check the live server."
            textSize = 16f
            gravity = Gravity.CENTER
        }
        val checkButton = Button(this).apply {
            text = "Check server"
            setOnClickListener { checkServer() }
        }
        val openButton = Button(this).apply {
            text = "Open buildplay.fun"
            setOnClickListener {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://buildplay.fun/portal")))
            }
        }

        root.addView(title)
        root.addView(subtitle)
        root.addView(checkButton)
        root.addView(openButton)
        root.addView(statusView)
        setContentView(root)
    }

    private fun checkServer() {
        statusView.text = "Contacting https://buildplay.fun/health …"
        thread {
            val result = try {
                val connection = URL("https://buildplay.fun/health").openConnection()
                    as HttpURLConnection
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                "Server replied (HTTP ${connection.responseCode}):\n$body"
            } catch (e: Exception) {
                "Could not reach the server:\n${e.message}"
            }
            runOnUiThread { statusView.text = result }
        }
    }
}
