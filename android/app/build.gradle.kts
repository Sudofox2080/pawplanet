// 应用模块构建脚本：单 Activity 的 WebView 壳，仅依赖 AndroidX 基础库与 Material
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.pawplanet.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.pawplanet.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        // 仓库里不放 keystore。想签 release 包就自己生成 keystore/pawplanet.jks，
        // 密码通过环境变量 PP_STORE_PASS / PP_KEY_ALIAS / PP_KEY_PASS 传入。
        create("release") {
            val ks = rootProject.file("keystore/pawplanet.jks")
            if (ks.exists()) {
                storeFile = ks
                storePassword = System.getenv("PP_STORE_PASS")
                keyAlias = System.getenv("PP_KEY_ALIAS") ?: "pawplanet"
                keyPassword = System.getenv("PP_KEY_PASS")
            }
        }
    }

    buildTypes {
        release {
            // 壳应用没有需要保留的自定义类，先关闭混淆，避免 WebView 相关调用被裁掉
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // 本地有 keystore 就顺手签掉，没有就出未签名包
            if (rootProject.file("keystore/pawplanet.jks").exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = false
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("com.google.android.material:material:1.12.0")
}
