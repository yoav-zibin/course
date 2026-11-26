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

Each sample directory contains the video, input bracket, frame timestamps and metrics. Tap latency starts immediately before input injection and includes the recorded injection overhead. The checker selection metric detects the first frame with the legal point visibly highlighted. The report metric detects the transition to the visible dialog. During free dragging, the recorder separately measures when the checker first uncovers the wood beneath it and the intervals between distinct checker positions. On a verified legal drop, it measures the time from the end of input injection until the spent die visibly dims and stays dim. Emulator load, density, GPU and screen recording affect the absolute numbers. Use the same device configuration for comparisons.

For Connect Four, export the six-move native fixture and use a disposable emulator with an empty visitor store or this fixture already installed. Each report trial starts on the same board. The tracking trial follows the yellow reserve disc across the screen and checks that the saved move count stays at six.

```sh
python3 scripts/native-interactions/connect4.py /tmp/connect-four-fixture
python3 scripts/native-interactions/android.py --serial emulator-5554 --fixture /tmp/connect-four-fixture --output /tmp/connect-four-drag --scenario tracking
python3 scripts/native-interactions/android.py --serial emulator-5554 --fixture /tmp/connect-four-fixture --output /tmp/connect-four-report --scenario report
```

## iOS

Run the **Native interaction benchmark** workflow with a Portal apps workflow run ID that contains a compatible simulator build. An optional full baseline commit runs both revisions on the same iPhone simulator. The workflow installs the same native app with each revision's release Hermes bundle and uses the XCTest bundle in this directory.

XCTest measures checker selection, dragging and opening the report. The wall-clock metric includes UI automation and accessibility waits. XCTest also requests the application hitch metric, whose availability depends on the device. A simulator recording independently measures intervals between visibly distinct checker positions. When recorded movement aligns with every XCTest drag, the output also reports visible positions for each gesture, including partial strokes and the initial warm-up. A separate test starts from a fresh opening and verifies the exact saved result of a legal drop. The artifact includes the individual metrics, drop result, video, simulator model, logs and Xcode result bundles.

## Cold launch and uncached Backgammon

The startup fixture serves the opening position and its pinned game package over loopback. It adds 200 ms to each API response. Both revisions use the same fixture, and each trial clears the app's data. A cold match launch must request both the match and the game package and display the wooden board.

For iOS, choose `startup` in the **Native interaction benchmark** workflow. It measures three clean installs per case per revision. The home and catalog milestones use XCTest accessibility. The match milestones also verify a screenshot. A new guest opens the play options, starts a pass-and-play game, and the runner checks that the new match reached the server. The artifact includes individual times and the API request log for every launch.

Choose `startup-video` to measure the first visible launch transition to the rendered home title or Backgammon opening on the iPhone. It alternates the revision order across five pairs. It finds the title in a screenshot with Apple Vision and matches the verified content against individual video frames. Both timestamps come from the same simulator recording. Time before the launcher visibly changes is outside this metric. Each sample includes the recording, screenshots, request log and timestamps.

For Android, install a release benchmark build with `EXPO_PUBLIC_API_URL=http://127.0.0.1:18764` embedded in the bundle and loopback HTTP allowed in the test app. Generate the board fixture as above. Start the server in a separate terminal, then connect the disposable emulator and record each scenario.

```sh
python3 scripts/native-interactions/startup_fixture.py /tmp/board-fixture
```

```sh
adb -s emulator-5554 reverse tcp:18764 tcp:18764
for scenario in home match new; do
  python3 scripts/native-interactions/startup_android.py --serial emulator-5554 \
    --reset-test-app --scenario "$scenario" --output "/tmp/startup-$scenario"
done
```

The Android recording measures the first visible frame after a launch intent or touch. The `home` case also records Android's time to the first activity. The `new` case creates an empty guest account, opens Backgammon from the catalog, starts pass-and-play, and verifies that the first move reached the server. Its game-details and board measurements start at their respective taps.
