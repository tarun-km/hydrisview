plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "ai.hydris.glassesbridge"
  compileSdk = 35
  defaultConfig {
    applicationId = "ai.hydris.glassesbridge"
    minSdk = 29 // Android 10 (DAT minimum)
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
    buildConfigField("String", "HYDRIS_URL", "\"https://hydrisview.vercel.app\"")
  }
  buildFeatures { buildConfig = true }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  val mwdat = "1.0.1"
  implementation("com.meta.wearable:mwdat-core:$mwdat")
  implementation("com.meta.wearable:mwdat-camera:$mwdat")
  debugImplementation("com.meta.wearable:mwdat-mockdevice:$mwdat")
  implementation("androidx.activity:activity-ktx:1.9.3")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
}
