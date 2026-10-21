# Hydris glasses bridge (Android)

Ray-Ban Meta glasses expose their camera **only** to native phone apps through Meta's
[Wearables Device Access Toolkit](https://wearables.developer.meta.com/docs/develop/) (DAT, developer preview).
Web apps cannot open the glasses camera. This companion app hosts the Hydris glasses web app in a
WebView and bridges the DAT camera into it, so **Audit scan** uses the glasses camera with the
same guided A4 capture used everywhere else.

```
Ray-Ban Meta ──BT/Wi-Fi──► Meta AI app ──DAT──► Hydris bridge (this app)
                                                   │ WebView: https://<your-host>/glasses
                                                   │ HydrisNative.startPreview()  → window.__hydrisCameraFrame(jpeg)  ~8 fps
                                                   │ HydrisNative.capturePhoto(id) → window.__hydrisCameraPhoto(id, jpeg)
                                                   ▼
                                     guided capture → A4 flattening → on-device OCR → console verification
```

## Requirements (from Meta's DAT docs)
- Android 10+, Android Studio, Kotlin 2.2+.
- Ray-Ban Meta glasses on a supported firmware, the Meta AI app, **developer mode enabled** in the Meta AI app.
- A Wearables Developer Center account and an application ID (`com.meta.wearable.mwdat.APPLICATION_ID` in the manifest).

## Build
1. Open this folder in Android Studio.
2. Set `HYDRIS_URL` in `app/build.gradle.kts` (e.g. `https://hydrisview.vercel.app`) and your DAT application ID in `AndroidManifest.xml`.
3. Run on the phone paired with the glasses. Approve the Meta AI registration and the camera permission.
4. In the web app: pair the glasses (QR flow), open **Audit scan → Scan a document**. The menu says "Ray-Ban Meta camera" when the bridge is active.

No glasses? DAT's Mock Device Kit (`mwdat-mockdevice`) simulates the camera; the web app also has
a built-in **Simulated glasses camera** for the same purpose.

## Status
Written against the DAT 1.0.x API (`Wearables.initialize`, `startRegistration`, `RequestPermissionContract`,
`createSession(AutoDeviceSelector())`, `session.addCamera(StreamConfiguration(...))`, `camera.stream.videoStream`,
`camera.stream.capturePhoto()` → `PhotoData.Bitmap | PhotoData.HEIC`). **It has not been compiled or run against
hardware yet** - verify the YUV frame layout (`VideoFrame.buffer`) and type names against the DAT reference
for your SDK version before shipping.
