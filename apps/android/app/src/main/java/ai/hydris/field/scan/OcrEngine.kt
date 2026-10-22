package ai.hydris.field.scan

import ai.hydris.field.data.OcrLine
import ai.hydris.field.data.OcrReading
import ai.hydris.field.data.OcrWord
import ai.hydris.field.data.ScanPage
import android.graphics.Bitmap
import android.graphics.Rect
import android.util.Base64
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * On-device OCR with Google ML Kit (no network, no image leaves the phone until upload).
 * Two independent readings per page - the photo as captured and a contrast-normalised, ruling-free copy -
 * so the server can cross-check every value (machine half of dual verification). Output matches the
 * web client's format (apps/web/src/lib/ocr.ts) exactly.
 */
object OcrEngine {
  private const val MAX_SIDE = 2400
  private const val MAX_BYTES = 850 * 1024
  private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

  suspend fun scan(page: Bitmap, onStage: (String, Float) -> Unit = { _, _ -> }): ScanPage = withContext(Dispatchers.Default) {
    onStage("Preparing image", 0.05f)
    val (jpeg, img) = prepare(page)
    onStage("Reading text (pass 1 of 2)", 0.15f)
    val a = read("ocr:original", img)
    onStage("Reading text (pass 2 of 2)", 0.55f)
    val enhanced = enhance(img)
    val b = read("ocr:enhanced", enhanced)
    enhanced.recycle()
    onStage("Done", 1f)
    ScanPage("image/jpeg", Base64.encodeToString(jpeg, Base64.NO_WRAP), img.width, img.height, listOf(a, b))
  }

  /** Downscale and JPEG-encode under the upload budget; returns the bytes and the bitmap that was encoded. */
  private fun prepare(src: Bitmap): Pair<ByteArray, Bitmap> {
    var scale = min(1f, MAX_SIDE.toFloat() / max(src.width, src.height))
    repeat(6) {
      val w = (src.width * scale).roundToInt()
      val h = (src.height * scale).roundToInt()
      val bmp = if (w == src.width && h == src.height) src else Bitmap.createScaledBitmap(src, w, h, true)
      for (q in intArrayOf(85, 75, 65)) {
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, q, it) }.toByteArray()
        if (bytes.size <= MAX_BYTES) return bytes to bmp
      }
      scale *= 0.8f
    }
    throw IllegalStateException("This image is too large to upload")
  }

  private suspend fun read(engine: String, bmp: Bitmap): OcrReading {
    val text: Text = suspendCancellableCoroutine { cont ->
      recognizer.process(InputImage.fromBitmap(bmp, 0))
        .addOnSuccessListener { cont.resume(it) }
        .addOnFailureListener { cont.resumeWithException(it) }
    }
    val W = bmp.width.toDouble()
    val H = bmp.height.toDouble()
    fun box(r: Rect?) = r?.let { listOf(it.left / W, it.top / H, it.width() / W, it.height() / H) } ?: listOf(0.0, 0.0, 0.0, 0.0)
    // ML Kit confidence is 0..1; the shared format (Tesseract-compatible) uses 0..100.
    val lines = text.textBlocks.flatMap { b -> b.lines }.map { l ->
      val words = l.elements.map { e -> OcrWord(e.text, (e.confidence * 100.0).coerceIn(0.0, 100.0), box(e.boundingBox)) }
      OcrLine(l.text, (l.confidence * 100.0).coerceIn(0.0, 100.0), box(l.boundingBox), words)
    }.sortedWith(compareBy({ it.bbox[1] }, { it.bbox[0] }))
    val conf = if (lines.isEmpty()) 0.0 else lines.sumOf { it.conf } / lines.size
    return OcrReading(engine, text.text, conf, lines)
  }

  /** Grayscale + 1% contrast stretch + Bradley adaptive threshold + ruling-line removal. */
  private fun enhance(src: Bitmap): Bitmap {
    val W = src.width
    val H = src.height
    val px = IntArray(W * H)
    src.getPixels(px, 0, W, 0, 0, W, H)
    val gray = IntArray(W * H)
    val hist = IntArray(256)
    for (i in px.indices) { val c = px[i]; val v = (((c shr 16) and 0xFF) * 299 + ((c shr 8) and 0xFF) * 587 + (c and 0xFF) * 114) / 1000; gray[i] = v; hist[v]++ }
    var lo = 0; var acc = 0
    while (lo < 255) { acc += hist[lo]; if (acc >= gray.size * 0.01) break; lo++ }
    var hi = 255; acc = 0
    while (hi > 0) { acc += hist[hi]; if (acc >= gray.size * 0.01) break; hi-- }
    val span = max(1, hi - lo)
    for (i in gray.indices) gray[i] = ((gray[i] - lo) * 255 / span).coerceIn(0, 255)
    val integral = LongArray((W + 1) * (H + 1))
    for (y in 1..H) { var row = 0L; for (x in 1..W) { row += gray[(y - 1) * W + (x - 1)]; integral[y * (W + 1) + x] = integral[(y - 1) * (W + 1) + x] + row } }
    val r = max(8, min(W, H) / 32)
    val black = BooleanArray(W * H)
    for (y in 0 until H) for (x in 0 until W) {
      val x0 = max(0, x - r); val y0 = max(0, y - r); val x1 = min(W, x + r + 1); val y1 = min(H, y + r + 1)
      val sum = integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] - integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0]
      val mean = sum.toDouble() / ((x1 - x0) * (y1 - y0))
      black[y * W + x] = gray[y * W + x] < mean * 0.85
    }
    // Remove long horizontal / vertical runs (table borders, underlines) so cell text reads as rows.
    val minH = (W * 0.2).toInt()
    for (y in 0 until H) { var s = -1; for (x in 0..W) { if (x < W && black[y * W + x]) { if (s < 0) s = x; continue }; if (s >= 0 && x - s >= minH) for (i in s until x) black[y * W + i] = false; s = -1 } }
    val minV = (H * 0.028).toInt()
    for (x in 0 until W) { var s = -1; for (y in 0..H) { if (y < H && black[y * W + x]) { if (s < 0) s = y; continue }; if (s >= 0 && y - s >= minV) for (i in s until y) black[i * W + x] = false; s = -1 } }
    for (i in px.indices) px[i] = if (black[i]) -0x1000000 else -0x1
    return Bitmap.createBitmap(px, W, H, Bitmap.Config.ARGB_8888)
  }
}
