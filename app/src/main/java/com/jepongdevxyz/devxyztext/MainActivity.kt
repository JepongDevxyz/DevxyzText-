package com.jepongdevxyz.devxyztext

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.jepongdevxyz.devxyztext.databinding.ActivityMainBinding
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val logReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshUi()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.serverUrlInput.setText(Prefs.serverUrl(this))
        binding.deviceTokenInput.setText(Prefs.deviceToken(this))

        binding.saveButton.setOnClickListener {
            saveFromInputs()
            toast("Settings saved")
        }

        binding.pairButton.setOnClickListener {
            val serverUrl = binding.serverUrlInput.text?.toString()?.trim() ?: ""
            val code = binding.pairingCodeInput.text?.toString()?.trim() ?: ""
            if (serverUrl.isEmpty() || code.isEmpty()) {
                showMessage("Pairing", "Enter the server URL and the pairing code from the dashboard first.")
                return@setOnClickListener
            }
            binding.pairButton.isEnabled = false
            thread {
                try {
                    val token = ApiClient(serverUrl, "").pair(code, "DevxyzText Android")
                    runOnUiThread {
                        binding.deviceTokenInput.setText(token)
                        Prefs.saveSettings(this, serverUrl, token)
                        binding.pairButton.isEnabled = true
                        toast("Paired — device token saved")
                        refreshUi()
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        binding.pairButton.isEnabled = true
                        showMessage("Pairing failed", e.message ?: "Unknown error")
                    }
                }
            }
        }

        binding.startButton.setOnClickListener {
            saveFromInputs()
            if (Prefs.serverUrl(this).isEmpty() || Prefs.deviceToken(this).isEmpty()) {
                showMessage("Not configured", "Save a server URL and device token (or pair first) before starting.")
                return@setOnClickListener
            }
            if (!ensureSmsPermission()) {
                return@setOnClickListener
            }
            val intent = Intent(this, GatewayService::class.java)
            ContextCompat.startForegroundService(this, intent)
            binding.statusText.text = "Service: starting…"
        }

        binding.stopButton.setOnClickListener {
            stopService(Intent(this, GatewayService::class.java))
            binding.statusText.text = "Service: stopped"
            refreshUi()
        }

        binding.batteryButton.setOnClickListener {
            requestBatteryExemption()
        }

        refreshUi()
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter(GatewayService.ACTION_LOG_UPDATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(logReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(logReceiver, filter)
        }
        refreshUi()
    }

    override fun onPause() {
        super.onPause()
        try {
            unregisterReceiver(logReceiver)
        } catch (ignored: IllegalArgumentException) {
            // Receiver was not registered.
        }
    }

    private fun saveFromInputs() {
        val serverUrl = binding.serverUrlInput.text?.toString() ?: ""
        val token = binding.deviceTokenInput.text?.toString() ?: ""
        Prefs.saveSettings(this, serverUrl, token)
    }

    private fun refreshUi() {
        binding.statusText.text =
            if (GatewayService.isRunning) "Service: running (polling every 5s)" else "Service: stopped"
        val log = Prefs.log(this)
        binding.logText.text = if (log.isEmpty()) "No jobs yet." else log
    }

    private fun ensureSmsPermission(): Boolean {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.SEND_SMS)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.RECEIVE_SMS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), REQUEST_PERMISSIONS)
            toast("Grant the SMS permission, then tap Start again")
            return false
        }
        return true
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PERMISSIONS) {
            val smsIndex = permissions.indexOf(Manifest.permission.SEND_SMS)
            if (smsIndex >= 0 && grantResults.getOrNull(smsIndex) != PackageManager.PERMISSION_GRANTED) {
                showMessage(
                    "SMS permission needed",
                    "DevxyzText cannot send SMS without the SEND_SMS permission. Grant it in system Settings, then start the gateway again."
                )
            }
        }
    }

    private fun requestBatteryExemption() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            powerManager.isIgnoringBatteryOptimizations(packageName)
        ) {
            toast("Battery exemption is already on")
            return
        }
        try {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        } catch (e: Exception) {
            showMessage("Battery exemption", "Open system Settings > Battery and set DevxyzText to Unrestricted.")
        }
    }

    /** Modern Material dialog — no default system alert styling. */
    private fun showMessage(title: String, message: String) {
        MaterialAlertDialogBuilder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    private fun toast(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
    }

    companion object {
        private const val REQUEST_PERMISSIONS = 42
    }
}
