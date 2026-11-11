plugins {
    id("com.android.application")
}

// Release signing. The key and its passwords never live in this repo: they
// are read from Gradle properties, normally ~/.gradle/gradle.properties on
// the machine that publishes releases:
//   MKFLIX_RELEASE_STORE_FILE, MKFLIX_RELEASE_STORE_PASSWORD,
//   MKFLIX_RELEASE_KEY_ALIAS, MKFLIX_RELEASE_KEY_PASSWORD
// Without them a release build is left unsigned and debug builds are
// unaffected. Every release must be signed with the same key, or Android
// refuses to install it over an earlier version.
val releaseStoreFile = providers.gradleProperty("MKFLIX_RELEASE_STORE_FILE").orNull

android {
    namespace = "com.blendystudio.mkflix"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.blendystudio.mkflix"
        minSdk = 24
        targetSdk = 36
        versionCode = 130
        versionName = "1.3.0"
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = providers.gradleProperty("MKFLIX_RELEASE_STORE_PASSWORD").get()
                keyAlias = providers.gradleProperty("MKFLIX_RELEASE_KEY_ALIAS").get()
                keyPassword = providers.gradleProperty("MKFLIX_RELEASE_KEY_PASSWORD").get()
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
