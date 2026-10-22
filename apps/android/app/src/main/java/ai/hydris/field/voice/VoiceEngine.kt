package ai.hydris.field.voice

import ai.hydris.field.glasses.GlassesManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Speech in/out for "Hey Hydris".
 *  - Input: the glasses microphone (DAT Speech, recognised on the glasses) when connected; otherwise the
 *    phone microphone through Android SpeechRecognizer, restarted continuously while listening is on.
 *  - Output: TextToSpeech - plays on the glasses' open-ear speakers whenever they are the connected
 *    Bluetooth audio device.
 */
class VoiceEngine(private val context: Context, private val glasses: GlassesManager) {
  enum class Source { Glasses, Phone, None }
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val _transcripts = MutableSharedFlow<Pair<String, Boolean>>(extraBufferCapacity = 16)
  val transcripts: SharedFlow<Pair<String, Boolean>> = _transcripts.asSharedFlow()
  private val _source = MutableStateFlow(Source.None)
  val source: StateFlow<Source> = _source.asStateFlow()
  private val _listening = MutableStateFlow(false)
  val listening: StateFlow<Boolean> = _listening.asStateFlow()

  private var recognizer: SpeechRecognizer? = null
  private var wanted = false
  private var speaking = false
  private var glassesJob: Job? = null
  private var tts: TextToSpeech? = null
  private var ttsReady = false

  init {
    tts = TextToSpeech(context) { status -> if (status == TextToSpeech.SUCCESS) { tts?.language = Locale.getDefault(); ttsReady = true } }
  }

  /** Start always-on listening. Prefers the glasses microphone. */
  fun start() {
    if (wanted) return
    wanted = true
    scope.launch {
      if (glasses.state.value.registered && glasses.startSpeech()) {
        _source.value = Source.Glasses
        _listening.value = true
        glassesJob = launch { glasses.speech.collect { if (!speaking) _transcripts.tryEmit(it) } }
      } else if (SpeechRecognizer.isRecognitionAvailable(context)) {
        _source.value = Source.Phone
        listenPhone()
      } else _source.value = Source.None
    }
  }

  fun stop() {
    wanted = false
    _listening.value = false
    glassesJob?.cancel()
    glasses.stopSpeech()
    recognizer?.destroy()
    recognizer = null
  }

  private fun listenPhone() {
    if (!wanted || speaking) return
    val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) { _listening.value = true }
      override fun onBeginningOfSpeech() = Unit
      override fun onRmsChanged(rmsdB: Float) = Unit
      override fun onBufferReceived(buffer: ByteArray?) = Unit
      override fun onEndOfSpeech() = Unit
      override fun onError(error: Int) { _listening.value = false; restartSoon(if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) 150 else 1200) }
      override fun onResults(results: Bundle?) {
        results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { _transcripts.tryEmit(it to true) }
        restartSoon(150)
      }
      override fun onPartialResults(partial: Bundle?) {
        partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }?.let { _transcripts.tryEmit(it to false) }
      }
      override fun onEvent(eventType: Int, params: Bundle?) = Unit
    })
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
    runCatching { r.startListening(intent) }
  }

  private fun restartSoon(ms: Long) { scope.launch { delay(ms); if (wanted && _source.value == Source.Phone) listenPhone() } }

  /** Speak and suspend until done (listening pauses meanwhile so we don't transcribe ourselves). */
  suspend fun speak(text: String) {
    val t = tts ?: return
    if (!ttsReady) withTimeoutOrNull(1500) { while (!ttsReady) delay(50) }
    speaking = true
    if (_source.value == Source.Phone) recognizer?.cancel()
    withTimeoutOrNull(30_000) {
      suspendCancellableCoroutine { cont ->
        val id = "hydris-${System.nanoTime()}"
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) = Unit
          override fun onDone(utteranceId: String?) { if (utteranceId == id && cont.isActive) cont.resume(Unit) }
          @Deprecated("Deprecated in Java") override fun onError(utteranceId: String?) { if (utteranceId == id && cont.isActive) cont.resume(Unit) }
        })
        t.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
      }
    }
    speaking = false
    if (wanted && _source.value == Source.Phone) listenPhone()
  }

  fun shutdown() { stop(); tts?.shutdown() }
}
