package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.data.Repository
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay

/** Loaded data with error text and a reload trigger; optionally refreshed on an interval (live screens). */
class Loadable<T>(val data: MutableState<T?>, val error: MutableState<String?>, val nonce: MutableState<Int>) {
  fun reload() { nonce.value++ }
}

@Composable
fun repo(): Repository = (LocalContext.current.applicationContext as HydrisApp).repo

@Composable
fun <T> rememberLoad(vararg keys: Any?, refreshMs: Long = 0, load: suspend Repository.() -> T): Loadable<T> {
  val r = repo()
  val l = remember(*keys) { Loadable<T>(mutableStateOf(null), mutableStateOf(null), mutableStateOf(0)) }
  LaunchedEffect(*keys, l.nonce.value) {
    while (true) {
      runCatching { r.load() }.onSuccess { l.data.value = it; l.error.value = null }.onFailure { l.error.value = it.message ?: "Could not load" }
      if (refreshMs <= 0) break
      delay(refreshMs)
    }
  }
  return l
}
