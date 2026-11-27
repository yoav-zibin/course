#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
typedef NSString *_Nullable (^BPStorageAccess)(NSString *operation, NSString *key, NSString *value,
                                              NSError *_Nullable *_Nonnull error);
FOUNDATION_EXPORT void BPInstallStorageWorklet(void *runtime, BPStorageAccess access);
NS_ASSUME_NONNULL_END
