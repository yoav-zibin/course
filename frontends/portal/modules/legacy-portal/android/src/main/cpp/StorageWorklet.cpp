#include <fbjni/fbjni.h>
#include "StorageWorkletBinding.h"

namespace jni = facebook::jni;

// Hermes may release the last reference on a thread started outside the JVM.
struct StorageReference {
  explicit StorageReference(jobject object) : target(jni::make_global(jni::wrap_alias(object))) {}
  ~StorageReference() { jni::ThreadScope thread; target.reset(); }
  jni::global_ref<jobject> target;
};

extern "C" JNIEXPORT void JNICALL
Java_com_buildplay_legacyportal_StorageWorklet_install(JNIEnv *, jobject instance, jlong pointer) {
  auto storage = std::make_shared<StorageReference>(instance);
  auto method = storage->target->getClass()->getMethod<jstring(jstring, jstring, jstring)>("access");
  buildplay::installStorageBinding(*reinterpret_cast<facebook::jsi::Runtime *>(pointer),
      [storage, method](const auto &op, const auto &key, const auto &value) -> std::optional<std::string> {
        jni::ThreadScope thread;
        auto result = method(storage->target, jni::make_jstring(op).get(), jni::make_jstring(key).get(),
                             jni::make_jstring(value).get());
        if (!result) return std::nullopt;
        return result->toStdString();
      });
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  return jni::initialize(vm, [] {});
}
