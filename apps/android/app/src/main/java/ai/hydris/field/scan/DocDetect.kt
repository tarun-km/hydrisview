package ai.hydris.field.scan

import android.graphics.Bitmap
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Live A4 page detection + perspective correction (Kotlin port of apps/web/src/lib/docdetect.ts,
 * same thresholds so the phone, glasses and web guide the wearer identically).
 */
data class Pt(val x: Float, val y: Float)

data class Detection(
  val quad: List<Pt>?, // tl, tr, br, bl in 0..1 frame coordinates
  val coverage: Float,
  val aspect: Float,
  val skewDeg: Float,
  val tiltDeg: Float,
  val portrait: Boolean,
  val touchesEdge: Boolean,
  val sharpness: Float,
)

enum class Guide(val message: String, val ok: Boolean = false) {
  NoDocument("Place the A4 sheet in view, on a darker surface"),
  MoveBack("Move back - show all four corners"),
  MoveCloser("Move closer - fill the frame with the page"),
  Rotate("Turn the sheet to portrait"),
  Straighten("Look straight down at the page"),
  Level("Level the page - rotate it upright"),
  Flatten("Hold the sheet flat and square"),
  HoldStill("Hold still…"),
  Ready("Perfect - capturing", ok = true),
}

object DocDetect {
  private const val DW = 200
  private val A4 = sqrt(2f)

  /** Detect on a small grayscale copy of the frame. */
  fun detect(frame: Bitmap): Detection {
    val w = frame.width
    val h = frame.height
    val H = max(1, (DW.toFloat() * h / w).roundToInt())
    val small = Bitmap.createScaledBitmap(frame, DW, H, true)
    val px = IntArray(DW * H)
    small.getPixels(px, 0, DW, 0, 0, DW, H)
    if (small != frame) small.recycle()
    val n = DW * H
    val gray = IntArray(n) { i -> val c = px[i]; (((c shr 16) and 0xFF) * 299 + ((c shr 8) and 0xFF) * 587 + (c and 0xFF) * 114) / 1000 }
    val thr = max(otsu(gray), 90)
    val label = IntArray(n) { -1 }
    var bestId = -1
    var bestSize = 0
    val stack = IntArray(n)
    var id = 0
    for (s in 0 until n) {
      if (gray[s] <= thr || label[s] != -1) continue
      var sp = 0
      stack[sp++] = s
      label[s] = id
      var size = 0
      while (sp > 0) {
        val p = stack[--sp]
        size++
        val x = p % DW
        val y = p / DW
        if (x > 0 && gray[p - 1] > thr && label[p - 1] == -1) { label[p - 1] = id; stack[sp++] = p - 1 }
        if (x < DW - 1 && gray[p + 1] > thr && label[p + 1] == -1) { label[p + 1] = id; stack[sp++] = p + 1 }
        if (y > 0 && gray[p - DW] > thr && label[p - DW] == -1) { label[p - DW] = id; stack[sp++] = p - DW }
        if (y < H - 1 && gray[p + DW] > thr && label[p + DW] == -1) { label[p + DW] = id; stack[sp++] = p + DW }
      }
      if (size > bestSize) { bestSize = size; bestId = id }
      id++
    }
    val none = Detection(null, 0f, 0f, 90f, 0f, true, false, 0f)
    if (bestId < 0 || bestSize < n * 0.06f) return none

    var tlS = Int.MAX_VALUE; var tl = 0
    var brS = Int.MIN_VALUE; var br = 0
    var trS = Int.MIN_VALUE; var tr = 0
    var blS = Int.MAX_VALUE; var bl = 0
    var edge = 0
    for (p in 0 until n) {
      if (label[p] != bestId) continue
      val x = p % DW
      val y = p / DW
      if (x == 0 || y == 0 || x == DW - 1 || y == H - 1) edge++
      val a = x + y
      val d = x - y
      if (a < tlS) { tlS = a; tl = p }
      if (a > brS) { brS = a; br = p }
      if (d > trS) { trS = d; tr = p }
      if (d < blS) { blS = d; bl = p }
    }
    val q = listOf(tl, tr, br, bl).map { p -> Pt(((p % DW) + 0.5f) / DW, ((p / DW) + 0.5f) / H) }
    val pts = q.map { Pt(it.x * w, it.y * h) }
    val top = dist(pts[0], pts[1]); val right = dist(pts[1], pts[2]); val bottom = dist(pts[2], pts[3]); val left = dist(pts[3], pts[0])
    val horiz = (top + bottom) / 2
    val vert = (left + right) / 2
    val angles = listOf(angle(pts[3], pts[0], pts[1]), angle(pts[0], pts[1], pts[2]), angle(pts[1], pts[2], pts[3]), angle(pts[2], pts[3], pts[0]))

    // Sharpness: Laplacian variance inside the quad's bounding box.
    val x0 = floor(q.minOf { it.x } * DW).toInt() + 2; val x1 = ceil(q.maxOf { it.x } * DW).toInt() - 2
    val y0 = floor(q.minOf { it.y } * H).toInt() + 2; val y1 = ceil(q.maxOf { it.y } * H).toInt() - 2
    var m = 0.0; var m2 = 0.0; var k = 0
    for (y in max(1, y0) until min(H - 1, y1)) for (x in max(1, x0) until min(DW - 1, x1)) {
      val i = y * DW + x
      val lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - DW] - gray[i + DW]
      m += lap; m2 += lap.toDouble() * lap; k++
    }
    val sharp = if (k > 0) (m2 / k - (m / k) * (m / k)).toFloat() else 0f
    return Detection(
      quad = q,
      coverage = polyArea(pts) / (w.toFloat() * h),
      aspect = max(horiz, vert) / max(1f, min(horiz, vert)),
      skewDeg = angles.maxOf { abs(it - 90f) },
      tiltDeg = Math.toDegrees(atan2((pts[1].y - pts[0].y).toDouble(), (pts[1].x - pts[0].x).toDouble())).toFloat(),
      portrait = vert >= horiz,
      touchesEdge = edge > (2 * (DW + H)) * 0.08f,
      sharpness = sharp,
    )
  }

  fun guide(d: Detection, stable: Boolean): Guide = when {
    d.quad == null -> Guide.NoDocument
    d.touchesEdge || d.coverage > 0.92f -> Guide.MoveBack
    d.coverage < 0.28f -> Guide.MoveCloser
    !d.portrait -> Guide.Rotate
    d.skewDeg > 10f -> Guide.Straighten
    abs(d.tiltDeg) > 8f -> Guide.Level
    abs(d.aspect - A4) > 0.2f -> Guide.Flatten
    !stable || d.sharpness < 60f -> Guide.HoldStill
    else -> Guide.Ready
  }

  fun motion(a: List<Pt>?, b: List<Pt>?): Float = if (a == null || b == null) 1f else a.indices.maxOf { dist(a[it], b[it]) }

  /** Warp the page inside `quad` (0..1 coordinates) to a flat A4 bitmap (200 dpi by default). */
  fun warpToA4(src: Bitmap, quad: List<Pt>, outW: Int = 1654): Bitmap {
    val sw = src.width
    val sh = src.height
    val s = IntArray(sw * sh)
    src.getPixels(s, 0, sw, 0, 0, sw, sh)
    val outH = (outW * A4).roundToInt()
    val o = IntArray(outW * outH)
    val c = inset(quad).map { Pt(it.x * sw, it.y * sh) }
    val hm = squareToQuad(c)
    for (y in 0 until outH) {
      val v = (y + 0.5f) / outH
      for (x in 0 until outW) {
        val u = (x + 0.5f) / outW
        val ww = hm[6] * u + hm[7] * v + 1f
        val sx = (hm[0] * u + hm[1] * v + hm[2]) / ww - 0.5f
        val sy = (hm[3] * u + hm[4] * v + hm[5]) / ww - 0.5f
        val ix = floor(sx).toInt(); val iy = floor(sy).toInt()
        if (ix < 0 || iy < 0 || ix >= sw - 1 || iy >= sh - 1) { o[y * outW + x] = -0x1; continue }
        val fx = sx - ix; val fy = sy - iy
        val p00 = s[iy * sw + ix]; val p10 = s[iy * sw + ix + 1]; val p01 = s[(iy + 1) * sw + ix]; val p11 = s[(iy + 1) * sw + ix + 1]
        fun ch(sh: Int): Int {
          val a = ((p00 shr sh) and 0xFF) * (1 - fx) + ((p10 shr sh) and 0xFF) * fx
          val b = ((p01 shr sh) and 0xFF) * (1 - fx) + ((p11 shr sh) and 0xFF) * fx
          return (a * (1 - fy) + b * fy).roundToInt().coerceIn(0, 255)
        }
        o[y * outW + x] = (0xFF shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
      }
    }
    return Bitmap.createBitmap(o, outW, outH, Bitmap.Config.ARGB_8888)
  }

  // ------------------------------------------------------------------ helpers
  private fun otsu(gray: IntArray): Int {
    val hist = IntArray(256)
    gray.forEach { hist[it.coerceIn(0, 255)]++ }
    val total = gray.size
    var sum = 0.0
    for (i in 0 until 256) sum += i * hist[i].toDouble()
    var sumB = 0.0; var wB = 0; var best = 0.0; var thr = 128
    for (t in 0 until 256) {
      wB += hist[t]
      if (wB == 0) continue
      val wF = total - wB
      if (wF == 0) break
      sumB += t * hist[t].toDouble()
      val mB = sumB / wB
      val mF = (sum - sumB) / wF
      val between = wB.toDouble() * wF * (mB - mF) * (mB - mF)
      if (between > best) { best = between; thr = t }
    }
    return thr
  }
  private fun dist(a: Pt, b: Pt) = hypot(a.x - b.x, a.y - b.y)
  private fun angle(a: Pt, b: Pt, c: Pt): Float {
    val v1x = a.x - b.x; val v1y = a.y - b.y; val v2x = c.x - b.x; val v2y = c.y - b.y
    val cos = (v1x * v2x + v1y * v2y) / max(1e-6f, hypot(v1x, v1y) * hypot(v2x, v2y))
    return Math.toDegrees(acos(cos.coerceIn(-1f, 1f).toDouble())).toFloat()
  }
  private fun polyArea(q: List<Pt>): Float {
    var s = 0f
    for (i in q.indices) { val p = q[i]; val n = q[(i + 1) % q.size]; s += p.x * n.y - n.x * p.y }
    return abs(s) / 2
  }
  private fun inset(q: List<Pt>, amount: Float = 0.004f): List<Pt> {
    val cx = q.sumOf { it.x.toDouble() }.toFloat() / 4
    val cy = q.sumOf { it.y.toDouble() }.toFloat() / 4
    return q.map { Pt(it.x + Math.signum(cx - it.x) * amount, it.y + Math.signum(cy - it.y) * amount) }
  }
  /** Homography mapping the unit square (0,0),(1,0),(1,1),(0,1) onto quad `q` (pixels). */
  private fun squareToQuad(q: List<Pt>): FloatArray {
    val (p0, p1, p2, p3) = q
    val dx1 = p1.x - p2.x; val dx2 = p3.x - p2.x; val dx3 = p0.x - p1.x + p2.x - p3.x
    val dy1 = p1.y - p2.y; val dy2 = p3.y - p2.y; val dy3 = p0.y - p1.y + p2.y - p3.y
    val den = (dx1 * dy2 - dx2 * dy1).let { if (abs(it) < 1e-9f) 1e-9f else it }
    val g = (dx3 * dy2 - dx2 * dy3) / den
    val hh = (dx1 * dy3 - dx3 * dy1) / den
    return floatArrayOf(p1.x - p0.x + g * p1.x, p3.x - p0.x + hh * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + hh * p3.y, p0.y, g, hh)
  }
}
