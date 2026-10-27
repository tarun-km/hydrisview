import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("org.jetbrains.kotlin.plugin.serialization")
}

val localProperties = Properties().apply {
  val f = rootDir.resolve("local.properties")
  if (f.exists()) f.inputStream().use { load(it) }
}

android {
  namespace = "ai.hydris.field"
  compileSdk = 36
  defaultConfig {
    applicationId = "ai.hydris.field"
    minSdk = 31 // Android 12+, matches Meta DAT
    targetSdk = 36
    versionCode = 1
    versionName = "1.0.0"
    buildConfigField("String", "HYDRIS_URL", "\"${localProperties.getProperty("hydris_url", "https://hydrisview.vercel.app")}\"")
    // Meta Wearables DAT. Developer Mode in the Meta AI app: 0/0. Production: Wearables Developer Center values.
    // Exactly as Meta's DAT docs: placeholders "0" in Developer Mode (attestation unused; DAT logs that it
    // read no credentials - expected). Production builds set real values in local.properties.
    manifestPlaceholders["mwdat_application_id"] = localProperties.getProperty("mwdat_application_id", "0")
    manifestPlaceholders["mwdat_client_token"] = localProperties.getProperty("mwdat_client_token", "0")
  }
  buildTypes {
    release {
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = signingConfigs.getByName("debug") // replace with the release keystore for distribution
    }
  }
  buildFeatures { buildConfig = true; compose = true }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
  packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_17 } }

dependencies {
  // Compose
  implementation(platform("androidx.compose:compose-bom:2026.05.01"))
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.compose.ui:ui-tooling-preview")
  debugImplementation("androidx.compose.ui:ui-tooling")
  implementation("androidx.activity:activity-compose:1.13.0")
  implementation("androidx.navigation:navigation-compose:2.9.5")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
  implementation("androidx.core:core-ktx:1.17.0")
  // Data
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("androidx.datastore:datastore-preferences:1.1.7")
  // Camera + on-device OCR
  val camerax = "1.4.2"
  implementation("androidx.camera:camera-camera2:$camerax")
  implementation("androidx.camera:camera-lifecycle:$camerax")
  implementation("androidx.camera:camera-view:$camerax")
  implementation("com.google.mlkit:text-recognition:16.0.1")
  implementation("androidx.exifinterface:exifinterface:1.4.2")
  // Meta Wearables Device Access Toolkit (Ray-Ban Meta)
  val mwdat = "1.0.1"
  implementation("com.meta.wearable:mwdat-core:$mwdat")
  implementation("com.meta.wearable:mwdat-camera:$mwdat")
  implementation("com.meta.wearable:mwdat-speech:$mwdat")
  implementation("com.meta.wearable:mwdat-inputs:$mwdat")
  implementation("com.meta.wearable:mwdat-display:$mwdat")
  debugImplementation("com.meta.wearable:mwdat-mockdevice:$mwdat")
}
