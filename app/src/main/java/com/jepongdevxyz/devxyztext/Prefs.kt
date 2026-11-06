package com.jepongdevxyz.devxyztext

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** SharedPreferences storage for settings + the recent-jobs log. */
object Prefs {
    private const val FILE = "devxyztext_prefs"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_LOG = "recent_log"
    private const val MAX_LOG_LINES = 30

    private fun prefs(context: Context) =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun serverUrl(context: Context): String =
        prefs(context).getString(KEY_SERVER_URL, "") ?: ""

    fun deviceToken(context: Context): String =
        prefs(context).getString(KEY_DEVICE_TOKEN, "") ?: ""

    fun saveSettings(context: Context, serverUrl: String, deviceToken: String) {
        prefs(context).edit()
            .putString(KEY_SERVER_URL, serverUrl.trim().trimEnd('/'))
            .putString(KEY_DEVICE_TOKEN, deviceToken.trim())
            .apply()
    }

    fun log(context: Context): String =
        prefs(context).getString(KEY_LOG, "") ?: ""

    /** Prepends one timestamped line to the recent-jobs log (newest first). */
    fun appendLog(context: Context, line: String) {
        val stamp = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        val old = log(context)
        val lines = mutableListOf("$stamp  $line")
        if (old.isNotEmpty()) {
            lines.addAll(old.split("\n"))
        }
        val trimmed = lines.take(MAX_LOG_LINES).joinToString("\n")
        prefs(context).edit().putString(KEY_LOG, trimmed).apply()
    }
}
