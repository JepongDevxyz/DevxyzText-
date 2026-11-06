package com.jepongdevxyz.devxyztext

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/** One queued SMS job returned by GET /api/device/jobs. */
data class SmsJob(val id: String, val to: String, val message: String)

/** Minimal HTTP client for the DevxyzText backend (no external libraries). */
class ApiClient(private val serverUrl: String, private val deviceToken: String) {

    /** Pairs with the server using the dashboard pairing code. Returns the device token. */
    fun pair(pairingCode: String, deviceName: String): String {
        val body = JSONObject()
            .put("code", pairingCode)
            .put("name", deviceName)
        val json = request("POST", "/api/devices/pair", body, useDeviceToken = false)
        val token = json.optString("device_token", "")
        if (token.isEmpty()) {
            throw IllegalStateException("Pairing failed: " + json.optString("error", "unknown error"))
        }
        return token
    }

    /** Polls for pending jobs. The server marks returned jobs as picked. */
    fun fetchJobs(): List<SmsJob> {
        val json = request("GET", "/api/device/jobs", null, useDeviceToken = true)
        val jobs = mutableListOf<SmsJob>()
        val array = json.optJSONArray("jobs") ?: return jobs
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            jobs.add(
                SmsJob(
                    id = item.optString("id"),
                    to = item.optString("to"),
                    message = item.optString("message")
                )
            )
        }
        return jobs
    }

    /** Reports the outcome of a job back to the server. */
    fun reportStatus(jobId: String, sent: Boolean, error: String?, resultCode: Int?) {
        val body = JSONObject()
            .put("status", if (sent) "sent" else "failed")
        if (error != null) body.put("error", error)
        if (resultCode != null) body.put("resultCode", resultCode)
        request("POST", "/api/device/jobs/$jobId/status", body, useDeviceToken = true)
    }

    private fun request(
        method: String,
        path: String,
        body: JSONObject?,
        useDeviceToken: Boolean
    ): JSONObject {
        val base = serverUrl.trim().trimEnd('/')
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            connection.setRequestProperty("Content-Type", "application/json")
            if (useDeviceToken && deviceToken.isNotEmpty()) {
                connection.setRequestProperty("x-device-token", deviceToken)
            }
            if (body != null) {
                connection.doOutput = true
                val writer = OutputStreamWriter(connection.outputStream, Charsets.UTF_8)
                writer.write(body.toString())
                writer.flush()
                writer.close()
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = if (stream != null) {
                val reader = BufferedReader(InputStreamReader(stream, Charsets.UTF_8))
                val sb = StringBuilder()
                var line: String? = reader.readLine()
                while (line != null) {
                    sb.append(line)
                    line = reader.readLine()
                }
                reader.close()
                sb.toString()
            } else {
                ""
            }
            if (code !in 200..299) {
                val err = try {
                    JSONObject(text).optString("error", "")
                } catch (e: Exception) {
                    ""
                }
                throw IllegalStateException(
                    if (err.isNotEmpty()) "HTTP $code: $err" else "HTTP $code"
                )
            }
            return if (text.isEmpty()) JSONObject() else JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }
}
