# Glasses Integration

## 1. Capability matrix

| Capability | Ray-Ban Meta Gen 1 | Ray-Ban Meta Gen 2 | Oakley Meta (HSTN / Vanguard) | Meta Ray-Ban Display | Browser simulator (`/simulator`) |
|---|---|---|---|---|---|
| Supported by DAT 1.0 | Yes | Yes | Yes | Yes | n/a ([DAT docs](https://wearables.developer.meta.com/docs/develop/)) |
| Camera stream / photo to the phone app (DAT) | Yes | Yes (12 MP ultrawide, video up to 3K30 on-glasses recording) | Yes | Yes | Simulated (sample A4 sheet) |
| Mic → speech transcription (DAT Speech) | Yes | Yes (5-mic array) | Yes | Yes | Web Speech API |
| Open-ear speakers (phone TTS over BT) | Yes | Yes | Yes | Yes | `speechSynthesis` |
| Capture button input (DAT Inputs) | Yes | Yes | Yes | Yes | Keyboard / postMessage `hydris:input` |
| In-lens display | No | No | No | Yes (Web Apps on glasses; display access in developer preview) | Full HUD viewport |
| Hydris HUD rendering | Phone layout only | Phone layout only | Phone layout only | **Planned** native/web-app HUD | Yes |
| Battery (vendor) | ~4 h | up to ~8 h typical use ([Tom's Guide](https://www.tomsguide.com/uk/computing/smart-glasses/ray-ban-meta-ai-glasses-gen-1-vs-gen-2)) | varies | ~6 h | n/a |

Gen 2 specs (12 MP camera, 3K/30 video, 5 mics, ~8 h battery, IPX4, 32 GB) come from [Android Central](https://androidcentral.com/wearables/ray-ban-meta-gen-2) and [Tom's Guide](https://www.tomsguide.com/uk/computing/smart-glasses/ray-ban-meta-ai-glasses-gen-1-vs-gen-2). Confirm them against Meta's spec sheet before quoting to customers. Displayless glasses have **no HUD**: on them, Hydris is a phone app plus an audio and camera peripheral. The web "glasses viewport" (`/glasses`) is the HUD design target for display glasses and the simulator.

**Web Apps vs DAT:** per Meta's index, "Only the Device Access Toolkit can use the glasses' camera or capture microphone audio". Web Apps on Meta Ray-Ban Display receive speech only as dictated text, or as WebMCP tool calls ([llms.txt](https://wearables.developer.meta.com/llms.txt?full=true)). So audit scans from glasses always need a phone app with DAT.

## 2. Meta AI app dependency
Verified against Meta documentation (Oct 2026):
- "the Meta AI app must be used to pair your glasses" ([FAQ](https://developers.meta.com/wearables/faq)).
- Developer Mode is enabled in the Meta AI app. It "allows your unpublished app to register and interact with your AI glasses" ([setup](https://wearables.developer.meta.com/docs/develop/)).
- Meta AI app and glasses software versions must meet the DAT version dependencies (same page). Firmware updates are delivered through the Meta AI app.
- Registration and capability permissions (camera) are confirmed in the Meta AI app, which redirects back to the requesting app. Our bridge implements this (`Wearables.startRegistration`, `RequestPermissionContract`, `hydrisglasses://` intent filter).

**Precise product statement:** *The Hydris Field app cannot replace the Meta AI app. The Meta AI app must stay installed and signed in on the operator's phone. It pairs the glasses, registers Hydris as a permitted integration, grants camera access and updates the firmware. Once that one-time setup is done, operators use only Hydris Field; the Meta AI app runs in the background as the connection service.*

## 3. Bridge contract (web page ↔ native host)
Defined in `apps/web/src/glasses/camera.ts` and `apps/web/src/glasses/voice.ts`. It is implemented by `apps/glasses-bridge-android/.../MainActivity.kt`.

### Camera (preference order)
1. **Android JavascriptInterface `window.HydrisNative`**
   - Page → host: `startPreview()`, `stopPreview()`, `capturePhoto(requestId)`, `deviceName()`.
   - Host → page: `window.__hydrisCameraFrame(jpegBase64, w, h)` (~8 fps grayscale preview), `window.__hydrisCameraPhoto(requestId, jpegBase64)`, `window.__hydrisCameraError(requestId, message)`. The page times out a capture after 20 s.
2. **Injected promise API `window.HydrisWearables`** (iOS WKWebView hosts): `capturePhoto(): Promise<{dataUrl}>`, `startPreview?(onFrame)`, `stopPreview?()`, `deviceName?`.
3. **postMessage protocol**: page → `{type:'hydris:camera-start'|'hydris:camera-stop'|'hydris:camera-capture', requestId}`. Host → `{type:'hydris:camera-ready', deviceName}`, `hydris:camera-frame {dataUrl}`, `hydris:camera-photo {requestId, dataUrl}`, `hydris:camera-error {requestId, message}`.
4. Fallbacks: `getUserMedia` (environment camera, 1920×1440 ideal), then a simulated camera.

### Voice
- `HydrisNative.startSpeech()`, `stopSpeech()`, `speak(text)`.
- Host → page: `window.__hydrisSpeech(text, isFinal)`, `window.__hydrisSpeechState(state, detail)`, `window.__hydrisSpoken()` (TTS finished).
- Fallback: Web Speech API, then typed questions.

### Events and inputs
- `window` CustomEvents: `hydris:voice-activate {question?}` (also fired by DAT Voice Invocations) and `hydris:glasses-capture-button` (capture button).
- postMessage (same origin): `hydris:input {key: up|down|left|right|select|back}`, `hydris:network {online}`, `hydris:profile {config}` (console live preview, demo), `hydris:preview-ready`, `hydris:event` (outbound telemetry of the HUD).

## 4. DAT setup steps
1. Create an organization and app in the **Wearables Developer Center** (full access is limited to "AI glasses supported countries": confirm India eligibility with Meta).
2. Phone: Android 10+ (the bridge targets minSdk 31), with the Meta AI app installed and signed in, and the glasses paired and on supported firmware.
3. Meta AI app → Settings → enable **Developer Mode** (development builds use `APPLICATION_ID=0`, `CLIENT_TOKEN=0`).
4. Gradle: `com.meta.wearable:mwdat-core|camera|speech|inputs:1.0.1` (GitHub Packages Maven, token with `read:packages`), and `mwdat-mockdevice` for debug.
5. Manifest: `com.meta.wearable.mwdat.APPLICATION_ID` / `CLIENT_TOKEN` meta-data, a callback scheme intent filter, and the `BLUETOOTH`, `BLUETOOTH_CONNECT`, `INTERNET` permissions (plus `CAMERA` and `RECORD_AUDIO` for phone fallbacks).
6. Developer Center: enable the experimental capabilities used (Speech, Inputs, Voice Invocations; see the bridge README), add testers to a **release channel** (reported up to 100 testers per channel, [Auganix](https://www.auganix.org/?p=18402)).
7. Production: request the app ID and client token after review. Submit for publishing when Meta opens submissions.

## 5. Limitations and known gaps
- The bridge is **not yet run on physical glasses**. Unverified: luma-preview stride inference, capture-button press decomposition, and speech restart behaviour.
- Camera frames go through Bluetooth/Wi-Fi to the phone, so preview resolution and frame rate are well below on-glasses recording. Guided capture runs on the phone with a ~200 px detector and a full-resolution `capturePhoto()`.
- `capturePhoto()` works only on an active stream, and the stream must be stopped to release battery.
- Hardware gestures (Neural Band pinch/swipe, temple touchpad) are not delivered to the web runtime (`glasses/input.ts` keeps a placeholder).
- Mock Device Kit does not simulate display glasses.
- DAT public publishing is not yet generally available. Pilots rely on Developer Mode or release channels.
- The capture LED is controlled by Meta firmware and cannot be suppressed (good for bystander privacy).
