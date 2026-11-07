package com.pawplanet.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.google.android.material.button.MaterialButton
import java.net.URI

// 爪爪星球的 WebView 壳：全站 Cookie 保持、站内导航自己吃、返回键优先回退网页历史。
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var loadProgress: ProgressBar
    private lateinit var splashOverlay: View
    private lateinit var errorOverlay: View
    private lateinit var errorDetail: TextView
    private lateinit var retryButton: MaterialButton

    // 网页里点 <input type="file"> 时挂起的回调，同一时刻只会有一个
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    // 上次按返回键的时间，用来实现「再按一次退出」
    private var lastBackPressedAt = 0L

    private var splashHidden = false
    private var requestedUrl: String? = null
    private var failedUrl: String? = null

    // 系统文件选择器，必须在 Activity 构造阶段注册
    private val fileChooserLauncher: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = pendingFileCallback
            pendingFileCallback = null
            if (callback == null) {
                return@registerForActivityResult
            }
            if (result.resultCode != Activity.RESULT_OK) {
                // 用户取消：必须回 null，否则 WebView 会一直以为这次选择没结束
                callback.onReceiveValue(null)
                return@registerForActivityResult
            }
            val uris = collectUris(result.data)
            callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
        }

    private val baseUrl: String by lazy { getString(R.string.base_url) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.web_view)
        loadProgress = findViewById(R.id.load_progress)
        splashOverlay = findViewById(R.id.splash_overlay)
        errorOverlay = findViewById(R.id.error_overlay)
        errorDetail = findViewById(R.id.error_detail)
        retryButton = findViewById(R.id.retry_button)

        setupInsets()
        setupWebView()
        setupBackHandling()

        retryButton.setOnClickListener {
            hideError()
            val target = failedUrl ?: requestedUrl ?: baseUrl
            webView.loadUrl(target)
        }

        if (savedInstanceState == null) {
            webView.loadUrl(baseUrl)
        }
        // 网络一直不回来时，别让启动层永远盖着屏幕
        splashOverlay.postDelayed({ hideSplash() }, SPLASH_TIMEOUT_MS)
    }

    private fun setupInsets() {
        val root = findViewById<View>(R.id.root_container)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.updatePadding(
                left = bars.left,
                top = bars.top,
                right = bars.right,
                bottom = maxOf(bars.bottom, ime.bottom)
            )
            insets
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = userAgentString.replace("; wv", "")
        }
        webView.setBackgroundColor(getColor(R.color.bg))
        webView.overScrollMode = View.OVER_SCROLL_NEVER

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                return handleUrl(url)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                hideSplash()
                loadProgress.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (!request.isForMainFrame) return
                failedUrl = request.url.toString()
                showError(error.description?.toString().orEmpty())
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                if (newProgress >= 100) {
                    loadProgress.visibility = View.GONE
                } else {
                    loadProgress.visibility = View.VISIBLE
                    loadProgress.progress = newProgress
                }
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = pickMimeType(params.acceptTypes)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                return try {
                    fileChooserLauncher.launch(Intent.createChooser(intent, getString(R.string.app_name)))
                    true
                } catch (e: ActivityNotFoundException) {
                    pendingFileCallback = null
                    Toast.makeText(this@MainActivity, R.string.no_file_picker, Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        webView.loadUrl("about:blank")
    }

    private fun pickMimeType(acceptTypes: Array<String>?): String {
        val first = acceptTypes?.firstOrNull { it.contains("/") }
        return first ?: "image/*"
    }

    private fun collectUris(data: Intent?): List<Uri> {
        if (data == null) return emptyList()
        val clip = data.clipData
        if (clip != null) {
            return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        }
        val single = data.data
        return if (single != null) listOf(single) else emptyList()
    }

    private fun handleUrl(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme == "http" || scheme == "https") {
            if (isInternalHost(uri)) return false
            openExternally(uri)
            return true
        }
        if (scheme == "tel" || scheme == "mailto" || scheme == "sms") {
            openExternally(uri)
            return true
        }
        // intent:// 之类交给系统
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (e: ActivityNotFoundException) {
            true
        }
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, getString(R.string.no_app_for_link, uri.toString()), Toast.LENGTH_SHORT).show()
        }
    }

    // 站内判定：配置文件里的 base_url 主机 + 端口，加上 Cloudflare 隧道域名
    private fun isInternalHost(uri: Uri): Boolean {
        val host = uri.host?.lowercase() ?: return false
        val baseHost = runCatching { URI(baseUrl).host?.lowercase() }.getOrNull()
        if (baseHost != null && host == baseHost) {
            val basePort = if (uri.port > 0) uri.port else defaultPort(uri.scheme)
            val wantPort = runCatching { URI(baseUrl).port }.getOrNull() ?: -1
            if (wantPort <= 0 || basePort == wantPort) return true
        }
        return host == "trycloudflare.com" || host.endsWith(".trycloudflare.com")
    }

    private fun defaultPort(scheme: String?): Int = if (scheme == "https") 443 else 80

    private fun setupBackHandling() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                    return
                }
                val now = System.currentTimeMillis()
                if (now - lastBackPressedAt <= EXIT_WINDOW_MS) {
                    finish()
                    return
                }
                lastBackPressedAt = now
                Toast.makeText(this@MainActivity, R.string.press_again_to_exit, Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun hideSplash() {
        if (splashHidden) return
        splashHidden = true
        splashOverlay.animate().alpha(0f).setDuration(220).withEndAction {
            splashOverlay.visibility = View.GONE
        }.start()
    }

    private fun showError(detail: String) {
        hideSplash()
        errorDetail.text = getString(R.string.error_detail, detail)
        errorOverlay.alpha = 0f
        errorOverlay.visibility = View.VISIBLE
        errorOverlay.animate().alpha(1f).setDuration(160).start()
    }

    private fun hideError() {
        errorOverlay.visibility = View.GONE
    }

    override fun onResume() {
        super.onResume()
        CookieManager.getInstance().flush()
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val SPLASH_TIMEOUT_MS = 10_000L
        const val EXIT_WINDOW_MS = 2_000L
    }
}
