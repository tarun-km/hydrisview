package ai.hydris.field.glasses

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** One photo taken through Hydris with the glasses camera. */
@Serializable
data class Capture(
  val id: String,
  val file: String,
  val takenAt: Long,
  val device: String? = null,
  /** "photo" (quick capture) or "scan" (original photo of an audit scan). */
  val type: String = "photo",
  val width: Int = 0,
  val height: Int = 0,
  /** Audit document this photo was uploaded as, once sent. */
  val auditDocId: String? = null,
  val savedToGallery: Boolean = false,
)

/**
 * Hydris' own captures gallery: JPEGs in app-private storage (files/captures) plus a JSON index.
 * Nothing leaves the phone unless the user shares it, saves it to the phone gallery or sends it as an audit scan.
 */
class CaptureStore(private val context: Context) {
  private val dir = File(context.filesDir, "captures").apply { mkdirs() }
  private val thumbs = File(context.cacheDir, "capture_thumbs").apply { mkdirs() }
  private val index = File(dir, "index.json")
  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
  private val ser = ListSerializer(Capture.serializer())
  private val _items = MutableStateFlow(load())
  /** Newest first. */
  val items: StateFlow<List<Capture>> = _items.asStateFlow()

  private fun load(): List<Capture> = runCatching { json.decodeFromString(ser, index.readText()) }.getOrDefault(emptyList())
    .filter { File(dir, it.file).exists() }.sortedByDescending { it.takenAt }

  @Synchronized private fun write(list: List<Capture>) {
    val sorted = list.sortedByDescending { it.takenAt }
    val tmp = File(dir, "index.json.tmp")
    tmp.writeText(json.encodeToString(ser, sorted))
    tmp.renameTo(index)
    _items.value = sorted
  }

  fun get(id: String): Capture? = _items.value.firstOrNull { it.id == id }
  fun fileOf(c: Capture): File = File(dir, c.file)

  suspend fun save(bitmap: Bitmap, type: String, device: String?): Capture = withContext(Dispatchers.IO) {
    val id = UUID.randomUUID().toString().take(12)
    val name = "hydris_${System.currentTimeMillis()}_$id.jpg"
    File(dir, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 92, it) }
    val c = Capture(id, name, System.currentTimeMillis(), device, type, bitmap.width, bitmap.height)
    write(listOf(c) + _items.value)
    c
  }

  fun linkAuditDoc(ids: Collection<String>, docId: String) {
    if (ids.isEmpty()) return
    write(_items.value.map { if (it.id in ids) it.copy(auditDocId = docId) else it })
  }

  suspend fun delete(id: String) = withContext(Dispatchers.IO) {
    val c = get(id) ?: return@withContext
    fileOf(c).delete(); File(thumbs, "${c.id}.jpg").delete()
    write(_items.value.filterNot { it.id == id })
  }

  /** Small cached thumbnail for grids (square-ish, ~360 px). */
  suspend fun thumbnail(c: Capture, px: Int = 360): Bitmap? = withContext(Dispatchers.IO) {
    val t = File(thumbs, "${c.id}.jpg")
    if (t.exists()) return@withContext BitmapFactory.decodeFile(t.path)
    val src = fileOf(c)
    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(src.path, o)
    var sample = 1
    while (minOf(o.outWidth, o.outHeight) / (sample * 2) >= px) sample *= 2
    val bmp = BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return@withContext null
    runCatching { t.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) } }
    bmp
  }

  /** Full image, downsampled to fit [maxPx] on the long side (viewer / OCR). */
  suspend fun full(c: Capture, maxPx: Int = 4096): Bitmap? = withContext(Dispatchers.IO) {
    val src = fileOf(c)
    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(src.path, o)
    var sample = 1
    while (maxOf(o.outWidth, o.outHeight) / sample > maxPx) sample *= 2
    BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 })
  }

  fun uri(c: Capture): Uri = FileProvider.getUriForFile(context, "${context.packageName}.captures", fileOf(c))

  fun shareIntent(c: Capture): Intent = Intent.createChooser(
    Intent(Intent.ACTION_SEND).apply {
      type = "image/jpeg"
      putExtra(Intent.EXTRA_STREAM, uri(c))
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }, "Share capture",
  )

  /** Copies the photo into the phone gallery (Pictures/Hydris) through MediaStore - no storage permission needed. */
  suspend fun saveToGallery(c: Capture): Boolean = withContext(Dispatchers.IO) {
    val cr = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, c.file)
      put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
      put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Hydris")
      put(MediaStore.Images.Media.DATE_TAKEN, c.takenAt)
      put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return@withContext false
    val ok = runCatching { cr.openOutputStream(uri)!!.use { out -> fileOf(c).inputStream().use { it.copyTo(out) } } }.isSuccess
    if (ok) {
      cr.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
      write(_items.value.map { if (it.id == c.id) it.copy(savedToGallery = true) else it })
    } else cr.delete(uri, null, null)
    ok
  }
}
