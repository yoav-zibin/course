#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include "buildplay_runtime.h"

JNIEXPORT jbyteArray JNICALL Java_com_buildplay_runtime_BuildPlayRuntimeModule_evaluateNative(JNIEnv *env, jobject instance, jbyteArray source) {
  (void)instance;
  jsize length = (*env)->GetArrayLength(env, source);
  if (length > 1500000) {
    (*env)->ThrowNew(env, (*env)->FindClass(env, "java/lang/IllegalArgumentException"), "Game source exceeds its size limit");
    return NULL;
  }
  char *text = malloc((size_t)length + 1);
  if (!text) return NULL;
  (*env)->GetByteArrayRegion(env, source, 0, length, (jbyte *)text);
  text[length] = 0;
  int failed = 0;
  char *result = bp_runtime_evaluate(text, &failed);
  free(text);
  if (!result) {
    (*env)->ThrowNew(env, (*env)->FindClass(env, "java/lang/IllegalStateException"), "Game runtime allocation failed");
    return NULL;
  }
  // JNI's NewStringUTF uses modified UTF-8 and corrupts emoji. Return ordinary
  // UTF-8 bytes, plus a status byte, and decode using Kotlin's UTF-8 decoder.
  size_t result_length = strlen(result);
  jbyteArray output = (*env)->NewByteArray(env, (jsize)result_length + 1);
  if (output) {
    jbyte status = (jbyte)failed;
    (*env)->SetByteArrayRegion(env, output, 0, 1, &status);
    (*env)->SetByteArrayRegion(env, output, 1, (jsize)result_length, (const jbyte *)result);
  }
  bp_runtime_free(result);
  return output;
}
