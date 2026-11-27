#import "BPStorageWorklet.h"
#include "../cpp/StorageWorkletBinding.h"
#include <stdexcept>

static NSString *toNSString(const std::string &value) {
  return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding];
}

void BPInstallStorageWorklet(void *runtime, BPStorageAccess access) {
  BPStorageAccess nativeAccess = [access copy];
  buildplay::installStorageBinding(*static_cast<facebook::jsi::Runtime *>(runtime),
      [nativeAccess](const auto &operation, const auto &key, const auto &value) -> std::optional<std::string> {
        @autoreleasepool {
          NSError *error = nil;
          NSString *result = nativeAccess(toNSString(operation), toNSString(key), toNSString(value), &error);
          if (error) throw std::runtime_error(error.localizedDescription.UTF8String);
          if (!result) return std::nullopt;
          return std::string(result.UTF8String, [result lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
        }
      });
}
