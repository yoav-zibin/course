#pragma once

#include <jsi/jsi.h>
#include <exception>
#include <functional>
#include <memory>
#include <optional>
#include <string>

// Worklets transfers this host object to the storage runtime. Only native
// storage is retained. Every JS value is created in the calling runtime.
namespace buildplay {
namespace jsi = facebook::jsi;
using Access = std::function<std::optional<std::string>(
    const std::string &, const std::string &, const std::string &)>;

class StorageBinding final : public jsi::HostObject {
 public:
  explicit StorageBinding(Access access) : access_(std::move(access)) {}

  jsi::Value get(jsi::Runtime &runtime, const jsi::PropNameID &name) override {
    if (name.utf8(runtime) != "access") return jsi::Value::undefined();
    return jsi::Function::createFromHostFunction(runtime, name, 3,
        [access = access_](jsi::Runtime &rt, const jsi::Value &,
                           const jsi::Value *args, size_t count) -> jsi::Value {
          if (count != 3) throw jsi::JSError(rt, "Invalid storage arguments");
          try {
            auto result = access(args[0].asString(rt).utf8(rt), args[1].asString(rt).utf8(rt),
                                 args[2].asString(rt).utf8(rt));
            if (!result) return jsi::Value::null();
            return jsi::String::createFromUtf8(rt, *result);
          } catch (const std::exception &error) {
            throw jsi::JSError(rt, error.what());
          }
        });
  }

 private:
  Access access_;
};

inline void installStorageBinding(jsi::Runtime &runtime, Access access) {
  runtime.global().setProperty(runtime, "__buildPlayStorageBinding",
      jsi::Object::createFromHostObject(runtime, std::make_shared<StorageBinding>(std::move(access))));
}
}  // namespace buildplay
