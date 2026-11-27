#include <fbjni/fbjni.h>
#include "StorageWorkletBinding.h"

namespace jni = facebook::jni;

// Hermes may release the last reference on a thread started outside the JVM.
struct NativeReference {
  explicit NativeReference(jobject object) : target(jni::make_global(jni::wrap_alias(object))) {}
  ~NativeReference() { jni::ThreadScope thread; target.reset(); }
  jni::global_ref<jobject> target;
};

static buildplay::Access retainedAccess(jobject instance) {
  auto endpoint = std::make_shared<NativeReference>(instance);
  auto method = endpoint->target->getClass()->getMethod<jstring(jstring, jstring, jstring)>("access");
  return [endpoint, method](const auto &op, const auto &key, const auto &value) -> std::optional<std::string> {
    jni::ThreadScope thread;
    auto result = method(endpoint->target, jni::make_jstring(op).get(), jni::make_jstring(key).get(),
                         jni::make_jstring(value).get());
    if (!result) return std::nullopt;
    return result->toStdString();
  };
}

extern "C" JNIEXPORT void JNICALL
Java_com_buildplay_legacyportal_StorageWorklet_install(JNIEnv *, jobject instance, jlong pointer) {
  buildplay::installStorageBinding(*reinterpret_cast<facebook::jsi::Runtime *>(pointer), retainedAccess(instance));
}

extern "C" JNIEXPORT void JNICALL
Java_com_buildplay_legacyportal_AnalyticsWorklet_install(JNIEnv *, jobject instance, jlong pointer) {
  buildplay::installAnalyticsBinding(*reinterpret_cast<facebook::jsi::Runtime *>(pointer), retainedAccess(instance));
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  return jni::initialize(vm, [] {});
}
