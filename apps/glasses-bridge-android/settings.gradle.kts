pluginManagement {
  repositories { google(); mavenCentral(); gradlePluginPortal() }
  plugins {
    id("com.android.application") version "8.7.3"
    id("org.jetbrains.kotlin.android") version "2.2.0"
  }
}
dependencyResolutionManagement {
  repositories { google(); mavenCentral() }
}
rootProject.name = "hydris-glasses-bridge"
include(":app")
