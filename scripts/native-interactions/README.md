# Native board interaction measurements

The fixture plays Backgammon's checked-in rules through setup and both opening rolls. It chooses a legal single-die move, derives the touch coordinates from the renderer, and calculates the expected checker counts and owners by applying that move. Both platforms use the same saved position and run the release app in local UI test mode.

## Android

Use a disposable, portrait, root-capable Android emulator with the release APK installed. The recorder requires Android's Winscope V2 frame timestamps (tested on API 35). Install PyAV and NumPy in the Python environment, then run from the repository root.

```sh
(cd frontends/portal && npm ci)
frontends/portal/node_modules/.bin/tsx scripts/native-interactions/backgammon.ts /tmp/board-fixture
python3 scripts/native-interactions/android.py --serial emulator-5554 --fixture /tmp/board-fixture --output /tmp/opening
python3 scripts/native-interactions/android.py --serial emulator-5554 --fixture /tmp/board-fixture --output /tmp/tracking --scenario tracking
```

The default package is `fun.buildplay.debug`. Each sample starts a fresh app process, restores the fixture, records the display and timestamps input on the device. The opening scenario verifies the report screenshot, the selected point and the exact saved result after a physical drag. The tracking scenario measures an 850 ms drag down a column without a legal destination. It isolates free movement from the intentional snap to a target. The optional `tap-move` scenario verifies the same legal move using a tap on the checker and a second tap on its highlighted point.

Each sample directory contains the video, input bracket, frame timestamps and metrics. Tap latency starts immediately before input injection and includes the recorded injection overhead. The checker metric detects the first frame with the legal point visibly highlighted. The report metric detects the transition to the visible dialog. Drag intervals measure distinct visible board updates. Emulator load, density, GPU and screen recording affect the absolute numbers. Use the same device configuration for comparisons.

## iOS

Run the **Native interaction benchmark** workflow with a Portal apps workflow run ID that contains a compatible simulator build. An optional full baseline commit runs both revisions on the same iPhone simulator. The workflow installs the same native app with each revision's release Hermes bundle and uses the XCTest bundle in this directory.

XCTest measures checker selection, dragging and opening the report. The wall-clock metric includes UI automation and accessibility waits. XCTest also requests the application hitch metric, whose availability depends on the device. A simulator recording independently measures intervals between visibly distinct checker positions. A separate test starts from a fresh opening and verifies the exact saved result of a legal drop. The artifact includes the individual metrics, drop result, video, simulator model, logs and Xcode result bundles.
