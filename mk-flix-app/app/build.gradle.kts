plugins {
    id("com.android.application")
}

// Release signing. The key and its passwords never live in this repo: they
// are read from Gradle properties, normally ~/.gradle/gradle.properties on
// the machine that publishes releases:
//   BLENDY_RELEASE_STORE_FILE, BLENDY_RELEASE_STORE_PASSWORD,
//   BLENDY_RELEASE_KEY_ALIAS, BLENDY_RELEASE_KEY_PASSWORD
// Without them a release build is left unsigned and debug builds are
// unaffected. Every release must be signed with the same key, or Android
// refuses to install it over an earlier version and the in-app updater
// can't update it.
//
// Blendy Play has its own application id and key, separate from MK-Flix
// (com.w2a.um1c, signed with the old MK-Flix key): it installs alongside an
// existing MK-Flix rather than over it. Neither may change again.
val releaseStoreFile = providers.gradleProperty("BLENDY_RELEASE_STORE_FILE").orNull

android {
    namespace = "com.w2a.um1c"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.mainakimani.blendyplay"
        minSdk = 24
        targetSdk = 34
        versionCode = 140
        versionName = "1.4.0"
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = providers.gradleProperty("BLENDY_RELEASE_STORE_PASSWORD").get()
                keyAlias = providers.gradleProperty("BLENDY_RELEASE_KEY_ALIAS").get()
                keyPassword = providers.gradleProperty("BLENDY_RELEASE_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseStoreFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
