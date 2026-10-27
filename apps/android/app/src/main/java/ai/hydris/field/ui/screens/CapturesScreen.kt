package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.ScanRequest
import ai.hydris.field.glasses.Capture
import ai.hydris.field.ui.LocalNavPadding
import ai.hydris.field.ui.components.BackButton
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.EmptyCapturesArt
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HButton
import ai.hydris.field.ui.components.HIconButton
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.components.sharedCapture
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import android.graphics.Bitmap
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.DownloadDone
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

private val monthFmt get() = SimpleDateFormat("MMMM yyyy", Locale.getDefault())
private val timeFmt get() = SimpleDateFormat("EEE d MMM yyyy · HH:mm", Locale.getDefault())

/** All captures, newest first, grouped by month. */
@Composable
fun CapturesScreen(nav: NavController) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val items by app.captures.items.collectAsState()
  val groups = remember(items) { items.groupBy { monthFmt.format(Date(it.takenAt)) } }
  Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      BackButton { nav.popBackStack() }
      Spacer(Modifier.size(12.dp))
      Column(Modifier.weight(1f)) {
        Eyebrow("Glasses camera · on this phone")
        Text("Captures", style = HxType.Page.copy(fontSize = 26.sp))
      }
      Chip("${items.size}")
    }
    if (items.isEmpty()) {
      Column(Modifier.fillMaxSize().padding(bottom = LocalNavPadding.current), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        EmptyCapturesArt(Modifier.fillMaxWidth(0.7f).appear(1))
        Text("No captures yet", style = HxType.Section, modifier = Modifier.padding(top = 12.dp).appear(2))
        Text("Take a photo from the Glasses tab or scan a page with the glasses camera; the photos land here.", color = Hx.Muted,
          style = HxType.Label.copy(fontSize = 14.sp, lineHeight = 20.sp), modifier = Modifier.padding(top = 8.dp, start = 24.dp, end = 24.dp).appear(3))
        HButton({ nav.popBackStack() }, Modifier.padding(top = 20.dp).appear(4)) { Text("Back to Glasses") }
      }
      return@Column
    }
    LazyVerticalGrid(
      GridCells.Fixed(3), Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = LocalNavPadding.current),
      horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      var idx = 0
      groups.forEach { (month, list) ->
        item(key = "h-$month", span = { GridItemSpan(maxLineSpan) }) {
          Row(Modifier.padding(top = 18.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(month, style = HxType.Card, modifier = Modifier.weight(1f))
            Text("${list.size} photo${if (list.size == 1) "" else "s"}", color = Hx.Muted, style = HxType.Label)
          }
        }
        items(list, key = { it.id }) { c ->
          val i = idx++
          CaptureThumb(c, Modifier.appear(i)) { nav.navigate("capture/${c.id}") }
        }
      }
    }
  }
}

/** Full-screen viewer: swipe between captures, pinch / double-tap zoom, share, save, send to audit scan, delete. */
@Composable
fun CaptureViewer(startId: String, nav: NavController) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val ctx = LocalContext.current
  val items by app.captures.items.collectAsState()
  if (items.isEmpty()) { LaunchedEffect(Unit) { nav.popBackStack() }; return }
  val start = remember { items.indexOfFirst { it.id == startId }.coerceAtLeast(0) }
  val pager = rememberPagerState(start) { items.size }
  val current = items.getOrNull(pager.currentPage.coerceAtMost(items.lastIndex)) ?: return
  var confirmDelete by remember { mutableStateOf(false) }
  var toast by remember { mutableStateOf<String?>(null) }
  var chrome by remember { mutableStateOf(true) }
  val scope = rememberCoroutineScope()
  LaunchedEffect(toast) { if (toast != null) { kotlinx.coroutines.delay(2500); toast = null } }

  Box(Modifier.fillMaxSize().background(Color.Black)) {
    HorizontalPager(pager, Modifier.fillMaxSize(), key = { items[it].id }, beyondViewportPageCount = 1) { page ->
      ZoomableCapture(items[page]) { chrome = !chrome }
    }
    // top bar
    if (chrome) Column(
      Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.75f), Color.Transparent))).statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        BackButton { nav.popBackStack() }
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
          Text(timeFmt.format(Date(current.takenAt)), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium)
          Text(listOfNotNull(current.device, if (current.width > 0) "${current.width} × ${current.height}" else null).joinToString(" · "), color = Color.White.copy(alpha = 0.7f), fontSize = 12.5.sp)
        }
        Text("${pager.currentPage + 1} / ${items.size}", color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp, style = HxType.Num)
      }
      Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip(if (current.type == "scan") "Audit scan original" else "Photo", Hx.Signal)
        current.auditDocId?.let { Chip("Audit doc ${it.take(8)}", Hx.OkFill) }
        if (current.savedToGallery) Chip("In phone gallery")
      }
    }
    // bottom actions
    if (chrome) Column(
      Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.8f)))).navigationBarsPadding().padding(16.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      toast?.let { Text(it, color = Color.White, fontSize = 13.5.sp, modifier = Modifier.padding(bottom = 12.dp).background(Hx.Surface2, HxShape.Pill).padding(horizontal = 14.dp, vertical = 8.dp)) }
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
        ViewerAction(Icons.Outlined.Share, "Share") { ctx.startActivity(app.captures.shareIntent(current)) }
        ViewerAction(if (current.savedToGallery) Icons.Outlined.DownloadDone else Icons.Outlined.Download, if (current.savedToGallery) "Saved" else "Save to gallery") {
          scope.launch { toast = if (app.captures.saveToGallery(current)) "Saved to Pictures/Hydris" else "Could not save to the gallery" }
        }
        ViewerAction(Icons.Outlined.DocumentScanner, "Audit scan") {
          app.scanRequest.value = ScanRequest.FromCapture(current.id)
          nav.navigate("scan") { popUpTo("home"); launchSingleTop = true }
        }
        ViewerAction(Icons.Outlined.DeleteOutline, "Delete", Hx.CriticalText) { confirmDelete = true }
      }
    }
    if (confirmDelete) AlertDialog(
      onDismissRequest = { confirmDelete = false },
      containerColor = Hx.Surface2, titleContentColor = Hx.Text, textContentColor = Hx.Text2, shape = HxShape.Xl,
      title = { Text("Delete this capture?", style = HxType.Section) },
      text = { Text("It is removed from Hydris on this phone. Copies saved to the phone gallery or uploaded audit documents are not affected.") },
      confirmButton = {
        TextButton({ confirmDelete = false; scope.launch { app.captures.delete(current.id) } }) { Text("Delete", color = Hx.CriticalText, fontWeight = FontWeight.SemiBold) }
      },
      dismissButton = { TextButton({ confirmDelete = false }) { Text("Cancel", color = Hx.Text2) } },
    )
  }
}

@Composable
private fun ViewerAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tint: Color = Color.White, onClick: () -> Unit) {
  Column(horizontalAlignment = Alignment.CenterHorizontally) {
    HIconButton(icon, label, onClick, size = 52.dp, tint = tint)
    Text(label, color = Color.White.copy(alpha = 0.85f), fontSize = 11.5.sp, modifier = Modifier.padding(top = 6.dp))
  }
}

/**
 * Pinch-zoom and pan that cooperates with the pager: single-finger drags pass through to the pager unless the
 * image is zoomed in; double-tap toggles 1x / 2.5x.
 */
@Composable
private fun ZoomableCapture(c: Capture, onTap: () -> Unit) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val thumb by produceState<Bitmap?>(null, c.id) { value = app.captures.thumbnail(c) }
  val full by produceState<Bitmap?>(null, c.id) { value = app.captures.full(c, 3072) }
  val scale = remember { Animatable(1f) }
  var offset by remember { mutableStateOf(Offset.Zero) }
  val scope = rememberCoroutineScope()
  Box(
    Modifier.fillMaxSize()
      .pointerInput(c.id) {
        detectTapGestures(onTap = { onTap() }, onDoubleTap = { p ->
          scope.launch {
            if (scale.value > 1.05f) { scale.animateTo(1f); offset = Offset.Zero }
            else { offset = (Offset(size.width / 2f, size.height / 2f) - p) * 1.5f; scale.animateTo(2.5f) }
          }
        })
      }
      .pointerInput(c.id) {
        awaitEachGesture {
          awaitFirstDown(requireUnconsumed = false)
          do {
            val e = awaitPointerEvent()
            val pointers = e.changes.count { it.pressed }
            if (pointers >= 2 || scale.value > 1.01f) {
              val z = e.calculateZoom(); val pan = e.calculatePan()
              val ns = (scale.value * z).coerceIn(1f, 5f)
              scope.launch { scale.snapTo(ns) }
              val maxX = (ns - 1f) * size.width / 2f; val maxY = (ns - 1f) * size.height / 2f
              offset = Offset((offset.x + pan.x).coerceIn(-maxX, maxX), (offset.y + pan.y).coerceIn(-maxY, maxY))
              if (ns <= 1f) offset = Offset.Zero
              e.changes.forEach { if (it.positionChanged()) it.consume() }
            }
          } while (e.changes.any { it.pressed })
        }
      },
    contentAlignment = Alignment.Center,
  ) {
    val bmp = full ?: thumb
    bmp?.let {
      Image(it.asImageBitmap(), "Capture", Modifier.fillMaxSize().sharedCapture(c.id).graphicsLayer {
        scaleX = scale.value; scaleY = scale.value; translationX = offset.x; translationY = offset.y
      }, contentScale = ContentScale.Fit)
    }
  }
}
