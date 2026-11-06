package com.jepongdevxyz.devxyztext

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity

/**
 * Branded splash screen: shows the DevxyzText mark briefly, then hands off
 * to MainActivity. Kept dependency-free (no splashscreen library needed).
 */
class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)
        Handler(Looper.getMainLooper()).postDelayed({
            if (!isFinishing) {
                startActivity(Intent(this, MainActivity::class.java))
                finish()
            }
        }, SPLASH_MS)
    }

    companion object {
        private const val SPLASH_MS = 900L
    }
}
