package expo.modules.skoratext

import android.graphics.Rect
import android.net.Uri
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class PhotoNotOpenedException(uri: String, cause: Throwable?) :
  CodedException("Could not open the photo $uri", cause)

class TextNotReadException(cause: Throwable?) :
  CodedException("Could not read the writing on the photo: ${cause?.message}", cause)

/**
 * Reads the writing on a photo with ML Kit, on the phone and without internet.
 * Returns every line with its box (left, top, right, bottom in pixels), ML Kit's confidence
 * from 0 to 1, and the words in it, so the app can find answers such as "12. B".
 */
class SkoraTextModule : Module() {
  private var recognizer: TextRecognizer? = null

  private fun client(): TextRecognizer =
    recognizer ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { recognizer = it }

  override fun definition() = ModuleDefinition {
    Name("SkoraText")

    AsyncFunction("readTextAsync") Coroutine { uri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))
      } catch (e: Exception) {
        throw PhotoNotOpenedException(uri, e)
      }
      val text = try {
        client().process(image).await()
      } catch (e: Exception) {
        throw TextNotReadException(e)
      }
      val lines = ArrayList<Map<String, Any>>()
      text.textBlocks.forEachIndexed { blockIndex, block ->
        for (line in block.lines) lines.add(lineToMap(blockIndex, line))
      }
      mapOf<String, Any>(
        "width" to image.width,
        "height" to image.height,
        "lines" to lines
      )
    }

    OnDestroy {
      recognizer?.close()
      recognizer = null
    }
  }

  private fun box(r: Rect?): List<Int> =
    if (r == null) emptyList() else listOf(r.left, r.top, r.right, r.bottom)

  private fun lineToMap(block: Int, line: Text.Line): Map<String, Any> = mapOf(
    "text" to line.text,
    "block" to block,
    "box" to box(line.boundingBox),
    "confidence" to line.confidence.toDouble(),
    "angle" to line.angle.toDouble(),
    "words" to line.elements.map { word ->
      mapOf<String, Any>(
        "text" to word.text,
        "box" to box(word.boundingBox),
        "confidence" to word.confidence.toDouble()
      )
    }
  )
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
  addOnSuccessListener { result -> continuation.resume(result) }
  addOnFailureListener { error -> continuation.resumeWithException(error) }
  addOnCanceledListener { continuation.cancel() }
}
