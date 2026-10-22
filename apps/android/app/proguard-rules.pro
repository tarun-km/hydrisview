# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class ai.hydris.field.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class ai.hydris.field.**$$serializer { *; }
-keepclassmembers class ai.hydris.field.** { *** Companion; }
# Meta Wearables DAT + ML Kit ship their own consumer rules.
-dontwarn org.slf4j.**
