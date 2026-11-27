#pragma once

#include <jsi/jsi.h>
#include <exception>
#include <functional>
#include <memory>
#include <optional>
#include <string>

// A transferable native endpoint for a dedicated Worklet runtime. Every JS
// value is created in the calling runtime. Each endpoint retains its own target.
namespace buildplay {
namespace jsi = facebook::jsi;
using Access = std::function<std::optional<std::string>(
    const std::string &, const std::string &, const std::string &)>;

class WorkletBinding final : public jsi::HostObject {
 public:
  explicit WorkletBinding(Access access) : access_(std::move(access)) {}

  jsi::Value get(jsi::Runtime &runtime, const jsi::PropNameID &name) override {
    if (name.utf8(runtime) != "access") return jsi::Value::undefined();
    return jsi::Function::createFromHostFunction(runtime, name, 3,
        [access = access_](jsi::Runtime &rt, const jsi::Value &,
                           const jsi::Value *args, size_t count) -> jsi::Value {
          if (count != 3) throw jsi::JSError(rt, "Invalid native worklet arguments");
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

inline void installBinding(jsi::Runtime &runtime, const char *name, Access access) {
  runtime.global().setProperty(runtime, name,
      jsi::Object::createFromHostObject(runtime, std::make_shared<WorkletBinding>(std::move(access))));
}

inline void installStorageBinding(jsi::Runtime &runtime, Access access) {
  installBinding(runtime, "__buildPlayStorageBinding", std::move(access));
}

inline void installAnalyticsBinding(jsi::Runtime &runtime, Access access) {
  installBinding(runtime, "__buildPlayAnalyticsBinding", std::move(access));
}
}  // namespace buildplay
