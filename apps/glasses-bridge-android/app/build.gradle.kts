import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

val localProperties = Properties().apply {
  val f = rootDir.resolve("local.properties")
  if (f.exists()) f.inputStream().use { load(it) }
}

android {
  namespace = "ai.hydris.glassesbridge"
  compileSdk = 36
  defaultConfig {
    applicationId = "ai.hydris.glassesbridge"
    minSdk = 31 // DAT samples target Android 12+
    targetSdk = 36
    versionCode = 1
    versionName = "0.2.0"
    buildConfigField("String", "HYDRIS_URL", "\"${localProperties.getProperty("hydris_url", "https://hydrisview.vercel.app")}\"")
    // Developer Mode in the Meta AI app: "0"/"0". Production: values from Wearables Developer Center.
    manifestPlaceholders["mwdat_application_id"] = localProperties.getProperty("mwdat_application_id", "0")
    manifestPlaceholders["mwdat_client_token"] = localProperties.getProperty("mwdat_client_token", "0")
  }
  buildFeatures { buildConfig = true }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
  packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_17 } }

dependencies {
  val mwdat = "1.0.1"
  implementation("com.meta.wearable:mwdat-core:$mwdat")
  implementation("com.meta.wearable:mwdat-camera:$mwdat")
  implementation("com.meta.wearable:mwdat-speech:$mwdat")
  implementation("com.meta.wearable:mwdat-inputs:$mwdat")
  debugImplementation("com.meta.wearable:mwdat-mockdevice:$mwdat")
  implementation("androidx.activity:activity-ktx:1.13.0")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
  implementation("androidx.exifinterface:exifinterface:1.4.2")
}
