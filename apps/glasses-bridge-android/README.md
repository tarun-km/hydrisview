# Hydris Glasses (Android companion for Ray-Ban Meta)

Ray-Ban Meta glasses expose their **camera, microphone and buttons only to native phone apps**
through Meta's [Wearables Device Access Toolkit](https://wearables.developer.meta.com/docs/develop/)
(DAT 1.0.x, developer preview). Web pages cannot reach them. This app hosts the Hydris glasses web
app in a WebView and bridges the glasses into it:

| Glasses capability (DAT) | Used for |
|---|---|
| `session.addCamera(StreamConfiguration(MEDIUM, 24 fps))` → `videoStream` | Live preview for guided A4 framing (luma plane → grayscale JPEG, ~8 fps) |
| `camera.stream.capturePhoto()` → `PhotoData.Bitmap / HEIC` (EXIF-rotated) | Full-resolution page photo → flattening → OCR |
| `session.addInputs(CAPTURE_BUTTON)` | Short press on the glasses capture button = take the page photo / start a scan |
| `session.addSpeech()` → `transcriptions` | Always-on **"Hey Hydris"** on the glasses microphone (restarted after silence) |
| Phone `TextToSpeech` | Spoken answers, played on the glasses' open-ear speakers |
| Voice Invocations (`isVoiceInvocationsIntent`) | "Hey Meta, start Hydris" opens the assistant |

Page contract: `apps/web/src/glasses/camera.ts` and `apps/web/src/glasses/voice.ts`.

## Requirements
- Android 12+ phone with the **Meta AI app**, Ray-Ban Meta glasses paired to it, glasses firmware supported by DAT.
- **Developer Mode** enabled in the Meta AI app (Settings → developer options). In developer mode the app ID/token are `0`/`0` (the default here).
- For production: register the app in the Wearables Developer Center and put `mwdat_application_id` / `mwdat_client_token` in `local.properties`.
- Speech, Inputs and Voice Invocations are experimental in DAT: enable them for the app in the Developer Center.

## Build and install
```bash
# local.properties
sdk.dir=/path/to/Android/sdk
hydris_url=https://hydrisview.vercel.app      # your deployment
# mwdat_application_id=...  mwdat_client_token=...   (production only)

./gradlew assembleDebug        # or open the folder in Android Studio and Run
adb install app/build/outputs/apk/debug/app-debug.apk
```
Built and verified with AGP 8.11.1, Kotlin 2.2.21, compileSdk 36, JDK 21, DAT `com.meta.wearable:mwdat-*:1.0.1`.

## First run
1. Open **Hydris Glasses** → allow Bluetooth. Pair the glasses to your Hydris account (QR/code on the glasses screen, approve on /pair).
2. Start **Audit scan → Scan a document** (or press the glasses capture button). The first time, the Meta AI app opens to connect Hydris and to allow **Camera**; approve and return.
3. Say **"Hey Hydris"** - the first time, allow **Microphone** in the Meta AI app.

## Status
Compiles against DAT 1.0.1 (all toolkit calls type-checked). The page side was tested end to end with a
stand-in bridge implementing the same contract. **Not yet run on physical glasses** - the luma-preview
stride inference and capture-button press decomposition are the parts to confirm on hardware.
