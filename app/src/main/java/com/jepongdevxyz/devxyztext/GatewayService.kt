package com.jepongdevxyz.devxyztext

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat

/**
 * Foreground service that polls the backend every 5 seconds for SMS jobs,
 * sends each one through this phone's SIM via SmsManager, and reports the
 * result back. Polling (instead of a socket) keeps it reliable on any
 * network and behind any NAT.
 */
class GatewayService : Service() {

    private var workerThread: HandlerThread? = null
    private var workerHandler: Handler? = null
    @Volatile
    private var running = false

    private val pollRunnable = object : Runnable {
        override fun run() {
            if (!running) return
            try {
                pollOnce()
            } catch (e: Exception) {
                Prefs.appendLog(applicationContext, "Poll error: ${e.message}")
                broadcastLogUpdate()
            }
            workerHandler?.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification("Gateway running — polling for jobs"))
        if (!running) {
            running = true
            isRunning = true
            val thread = HandlerThread("devxyztext-poll")
            thread.start()
            workerThread = thread
            workerHandler = Handler(thread.looper)
            workerHandler?.post(pollRunnable)
            Prefs.appendLog(applicationContext, "Gateway started")
            broadcastLogUpdate()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        isRunning = false
        workerHandler?.removeCallbacks(pollRunnable)
        workerThread?.quitSafely()
        Prefs.appendLog(applicationContext, "Gateway stopped")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun pollOnce() {
        val serverUrl = Prefs.serverUrl(applicationContext)
        val token = Prefs.deviceToken(applicationContext)
        if (serverUrl.isEmpty() || token.isEmpty()) {
            Prefs.appendLog(applicationContext, "Not configured: set server URL + device token")
            broadcastLogUpdate()
            return
        }
        val client = ApiClient(serverUrl, token)
        val jobs = client.fetchJobs()
        for (job in jobs) {
            sendJob(client, job)
        }
    }

    @Suppress("DEPRECATION")
    private fun smsManager(): SmsManager {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            applicationContext.getSystemService(SmsManager::class.java)
        } else {
            SmsManager.getDefault()
        }
    }

    private fun sendJob(client: ApiClient, job: SmsJob) {
        try {
            val smsManager: SmsManager = smsManager()
            // NOTE: with no sent PendingIntent, a call that does not throw means
            // the message was handed to the radio — it is not a telco delivery
            // receipt. Failures that throw are reported as failed.
            val parts = smsManager.divideMessage(job.message)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(job.to, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(job.to, null, job.message, null, null)
            }
            client.reportStatus(job.id, true, null, Activity.RESULT_OK)
            Prefs.appendLog(applicationContext, "SENT -> ${job.to}: ${preview(job.message)}")
        } catch (e: Exception) {
            try {
                client.reportStatus(job.id, false, e.message ?: e.javaClass.simpleName, null)
            } catch (ignored: Exception) {
                // Server unreachable; the job stays "picked" server-side and the
                // failure is still recorded in the local log below.
            }
            Prefs.appendLog(applicationContext, "FAILED -> ${job.to}: ${e.message}")
        }
        broadcastLogUpdate()
    }

    private fun preview(message: String): String {
        val oneLine = message.replace("\n", " ")
        return if (oneLine.length > 40) oneLine.substring(0, 40) + "…" else oneLine
    }

    private fun broadcastLogUpdate() {
        val intent = Intent(ACTION_LOG_UPDATE)
        intent.setPackage(packageName)
        sendBroadcast(intent)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "DevxyzText Gateway",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("DevxyzText")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val ACTION_LOG_UPDATE = "com.jepongdevxyz.devxyztext.LOG_UPDATE"
        private const val CHANNEL_ID = "devxyztext_gateway"
        private const val NOTIFICATION_ID = 1001
        private const val POLL_INTERVAL_MS = 5000L

        @Volatile
        var isRunning: Boolean = false
            private set
    }
}
