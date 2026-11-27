package expo.modules.skoratext

import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import org.tensorflow.lite.Interpreter
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

class PhotoNotOpenedException(uri: String, cause: Throwable?) :
  CodedException("Could not open the photo $uri", cause)

class TextNotReadException(cause: Throwable?) :
  CodedException("Could not read the writing on the photo: ${cause?.message}", cause)

class GrayImageException(message: String) : CodedException(message, null)

class ReaderException(message: String) : CodedException(message, null)

/**
 * Skora's own native helpers:
 * - readTextAsync: reads the writing on a photo with ML Kit, on the phone and without internet.
 *   Returns every line with its box (left, top, right, bottom in pixels), ML Kit's confidence
 *   from 0 to 1, and the words in it, so the app can find answers such as "12. B".
 * - grayImageAsync / saveGrayJpegAsync: turn a photo into greyscale pixels and back into a JPEG,
 *   much faster than doing it in JavaScript. The pixels pass through a file (one byte each).
 * - hasReaderAsync / classifyAsync: Skora's own model (assets/skora-reader.tflite, trained by
 *   tools/model/train.py) reads cut-outs of single handwritten characters. The app prepares the
 *   32 x 32 inputs (src/lib/reader/normalize.ts) and passes them through a file as float32.
 */
class SkoraTextModule : Module() {
  private var recognizer: TextRecognizer? = null
  private var reader: Interpreter? = null
  private var readerMissing = false

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

    // Decodes an upright JPEG or PNG (as saved by expo-image-manipulator) and writes one grey byte per pixel to outUri.
    AsyncFunction("grayImageAsync") Coroutine { uri: String, outUri: String ->
      val bitmap = BitmapFactory.decodeFile(pathOf(uri)) ?: throw GrayImageException("Could not open the photo $uri")
      try {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        val gray = ByteArray(pixels.size)
        for (i in pixels.indices) {
          val p = pixels[i]
          // Same integer formula as the app's rgbaToGray: 0.299 R + 0.587 G + 0.114 B.
          gray[i] = ((((p shr 16) and 0xff) * 77 + ((p shr 8) and 0xff) * 150 + (p and 0xff) * 29) shr 8).toByte()
        }
        File(pathOf(outUri)).writeBytes(gray)
        mapOf<String, Any>("width" to width, "height" to height)
      } finally {
        bitmap.recycle()
      }
    }

    // Reads one grey byte per pixel from rawUri and saves them as a JPEG at outUri.
    AsyncFunction("saveGrayJpegAsync") Coroutine { rawUri: String, width: Int, height: Int, quality: Int, outUri: String ->
      val gray = File(pathOf(rawUri)).readBytes()
      if (width <= 0 || height <= 0 || gray.size != width * height) {
        throw GrayImageException("Expected ${width}x$height grey pixels, found ${gray.size} bytes")
      }
      val pixels = IntArray(gray.size)
      for (i in gray.indices) {
        val v = gray[i].toInt() and 0xff
        pixels[i] = (0xff shl 24) or (v shl 16) or (v shl 8) or v
      }
      val bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
      try {
        FileOutputStream(pathOf(outUri)).use { out ->
          if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), out)) {
            throw GrayImageException("Could not save the JPEG")
          }
        }
      } finally {
        bitmap.recycle()
      }
      outUri
    }

    // True when the app has Skora's own reader model.
    AsyncFunction("hasReaderAsync") Coroutine { ->
      readerModel() != null
    }

    // Reads `count` inputs (count x 32 x 32 float32, little-endian) from inputUri and returns the
    // model's probabilities, `classes` numbers per input, one input after another.
    AsyncFunction("classifyAsync") Coroutine { inputUri: String, count: Int ->
      val model = readerModel() ?: throw ReaderException("Skora's reader model is not in this app")
      val bytes = File(pathOf(inputUri)).readBytes()
      if (count <= 0 || bytes.size != count * INPUT_SIZE * INPUT_SIZE * 4) {
        throw ReaderException("Expected $count inputs, found ${bytes.size} bytes")
      }
      val input = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.LITTLE_ENDIAN)
      input.put(bytes)
      input.rewind()
      synchronized(model) {
        model.resizeInput(0, intArrayOf(count, INPUT_SIZE, INPUT_SIZE, 1))
        model.allocateTensors()
        val classes = model.getOutputTensor(0).shape()[1]
        val output = Array(count) { FloatArray(classes) }
        model.run(input, output)
        val probs = ArrayList<Double>(count * classes)
        for (row in output) for (v in row) probs.add(v.toDouble())
        mapOf<String, Any>("classes" to classes, "probs" to probs)
      }
    }

    OnDestroy {
      recognizer?.close()
      recognizer = null
      reader?.close()
      reader = null
    }
  }

  private fun readerModel(): Interpreter? {
    reader?.let { return it }
    if (readerMissing) return null
    val context = appContext.reactContext ?: return null
    return try {
      val bytes = context.assets.open(MODEL_FILE).use { it.readBytes() }
      val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
      buffer.put(bytes)
      buffer.rewind()
      Interpreter(buffer, Interpreter.Options().setNumThreads(2)).also { reader = it }
    } catch (e: Exception) {
      readerMissing = true
      null
    }
  }

  private fun pathOf(uri: String): String =
    if (uri.startsWith("file:")) Uri.parse(uri).path ?: uri.removePrefix("file://") else uri

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
        "confidence" to word.confidence.toDouble(),
        "symbols" to word.symbols.map { symbol ->
          mapOf<String, Any>(
            "text" to symbol.text,
            "box" to box(symbol.boundingBox),
            "confidence" to symbol.confidence.toDouble()
          )
        }
      )
    }
  )

  companion object {
    private const val MODEL_FILE = "skora-reader.tflite"
    private const val INPUT_SIZE = 32
  }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
  addOnSuccessListener { result -> continuation.resume(result) }
  addOnFailureListener { error -> continuation.resumeWithException(error) }
  addOnCanceledListener { continuation.cancel() }
}
