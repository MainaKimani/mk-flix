plugins {
    id("com.android.application")
}

android {
    namespace = "com.w2a.um1c"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.w2a.um1c"
        minSdk = 24
        targetSdk = 34
        versionCode = 130
        versionName = "1.3.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
