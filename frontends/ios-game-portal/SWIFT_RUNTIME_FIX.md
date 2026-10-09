# Attempted fix for missing libswiftWebKit.dylib

This variant adds `ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES` to the GamePortal **app target** for Debug and Release. This asks Xcode to package Swift runtime compatibility libraries instead of assuming the simulator provides them. No game API or source logic is changed.

## Try it
1. Close the old GamePortal project in Xcode. Unzip this archive and open `frontends/ios-game-portal/GamePortal.xcodeproj` from the newly extracted copy.
2. Product → Clean Build Folder.
3. Build and Run on your iPhone simulator.

This change is **not yet validated in Xcode**. If it still reports `libswiftWebKit.dylib`, search the Xcode build log for an embed/SwiftStdLibTool step and check the selected Xcode installation and iOS simulator runtime. Don't manually copy arbitrary `.dylib` files.
