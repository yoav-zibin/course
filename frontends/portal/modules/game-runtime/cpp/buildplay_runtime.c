#include "buildplay_runtime.h"
#include "quickjs/quickjs.h"
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double millis(void) {
  struct timespec time;
  clock_gettime(CLOCK_MONOTONIC, &time);
  return time.tv_sec * 1000.0 + time.tv_nsec / 1000000.0;
}
static int interrupted(JSRuntime *runtime, void *opaque) {
  (void)runtime;
  return millis() > *(double *)opaque;
}
char *bp_runtime_evaluate(const char *source, int *failed) {
  *failed = 1;
  if (!source || strlen(source) > 1500000) return strdup("Game source exceeds its size limit");
  JSRuntime *runtime = JS_NewRuntime();
  if (!runtime) return strdup("Could not allocate game runtime");
  JS_SetMemoryLimit(runtime, 16 * 1024 * 1024);
  JS_SetMaxStackSize(runtime, 256 * 1024);
  double deadline = millis() + 1200;
  JS_SetInterruptHandler(runtime, interrupted, &deadline);
  JSContext *context = JS_NewContext(runtime);
  if (!context) { JS_FreeRuntime(runtime); return strdup("Could not allocate game context"); }
  // No libc, module loader, native host functions, credentials or I/O are
  // installed. Fresh context and heap for every call; only JSON crosses it.
  JSValue result = JS_Eval(context, source, strlen(source), "game.js", JS_EVAL_TYPE_GLOBAL);
  char *output;
  if (JS_IsException(result)) {
    JSValue error = JS_GetException(context);
    const char *message = JS_ToCString(context, error);
    output = strdup(message ? message : "Game exceeded its time or memory limit");
    if (message) JS_FreeCString(context, message);
    JS_FreeValue(context, error);
  } else if (!JS_IsString(result)) {
    output = strdup("Game must return JSON text");
  } else {
    size_t length = 0;
    const char *text = JS_ToCStringLen(context, &length, result);
    if (!text || length > 900000) output = strdup("Game output exceeds its size limit");
    else { output = strdup(text); *failed = 0; }
    if (text) JS_FreeCString(context, text);
  }
  JS_FreeValue(context, result);
  JS_FreeContext(context);
  JS_FreeRuntime(runtime);
  return output;
}
void bp_runtime_free(char *result) { free(result); }
