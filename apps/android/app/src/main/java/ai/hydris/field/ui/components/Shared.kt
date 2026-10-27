package ai.hydris.field.ui.components

import ai.hydris.field.ui.theme.LocalReducedMotion
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed

/** Shared-element plumbing between navigation destinations (gallery thumbnail -> full-screen viewer). */
@OptIn(ExperimentalSharedTransitionApi::class)
val LocalSharedScope = staticCompositionLocalOf<SharedTransitionScope?> { null }
val LocalNavScope = compositionLocalOf<AnimatedVisibilityScope?> { null }

/** Marks a capture image as the same element on every screen; no-op without a scope or with reduced motion. */
@OptIn(ExperimentalSharedTransitionApi::class)
fun Modifier.sharedCapture(id: String): Modifier = composed {
  val s = LocalSharedScope.current
  val a = LocalNavScope.current
  if (s == null || a == null || LocalReducedMotion.current) this
  else with(s) { this@composed.sharedElement(rememberSharedContentState("capture-$id"), a) }
}
