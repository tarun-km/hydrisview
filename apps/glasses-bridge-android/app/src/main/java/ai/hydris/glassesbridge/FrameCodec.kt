package ai.hydris.glassesbridge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import com.meta.wearable.dat.camera.types.PhotoData
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.roundToInt

/** Converts DAT camera output into JPEG for the web page. */
object FrameCodec {
  private const val PREVIEW_MAX_WIDTH = 640

  fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

  /**
   * Live preview from a raw (decoded) DAT VideoFrame.
   *
   * DAT documents the buffer as "YUV pixel data" without fixing the chroma layout. Every planar or
   * semi-planar 4:2:0 layout (I420, YV12, NV12, NV21) starts with the full-resolution luma plane, so
   * the preview uses luma only: correct for any of them, and all that page detection needs. Row
   * stride is inferred from the buffer size (4:2:0 → total = stride × height × 1.5).
   */
  fun lumaToJpeg(buffer: ByteBuffer, width: Int, height: Int, quality: Int = 70): ByteArray? {
    if (width <= 0 || height <= 0) return null
    val data = buffer.duplicate().apply { rewind() }
    val total = data.remaining()
    val stride = when {
      total >= width * height * 3 / 2 -> max(width, (total / (height * 1.5)).roundToInt())
      total >= width * height -> total / height
      else -> return null
    }
    val step = max(1, (width + PREVIEW_MAX_WIDTH - 1) / PREVIEW_MAX_WIDTH)
    val outW = width / step
    val outH = height / step
    val px = IntArray(outW * outH)
    val row = ByteArray(stride)
    for (y in 0 until outH) {
      data.position(y * step * stride)
      data.get(row, 0, minOf(stride, data.remaining()))
      for (x in 0 until outW) {
        val l = row[x * step].toInt() and 0xFF
        px[y * outW + x] = (0xFF shl 24) or (l shl 16) or (l shl 8) or l
      }
    }
    val bmp = Bitmap.createBitmap(px, outW, outH, Bitmap.Config.ARGB_8888)
    return ByteArrayOutputStream().use { out ->
      bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
      bmp.recycle()
      out.toByteArray()
    }
  }

  /** Full-resolution still from capturePhoto(); HEIC orientation comes from EXIF and must be applied. */
  fun photoToJpeg(photo: PhotoData, quality: Int = 92): ByteArray? {
    val bitmap: Bitmap = when (photo) {
      is PhotoData.Bitmap -> photo.bitmap
      is PhotoData.HEIC -> {
        val buf = photo.data.duplicate().apply { rewind() }
        val bytes = ByteArray(buf.remaining()).also { buf.get(it) }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        val matrix = exifMatrix(bytes)
        if (matrix.isIdentity) decoded
        else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also { if (it != decoded) decoded.recycle() }
      }
    }
    return ByteArrayOutputStream().use { out ->
      bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
      out.toByteArray()
    }
  }

  private fun exifMatrix(bytes: ByteArray): Matrix {
    val m = Matrix()
    val orientation = runCatching {
      ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
    }
    return m
  }
}
