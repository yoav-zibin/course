# BuildPlay release performance

The tests reject a release archive or mean first-draw time that exceeds 150%
of its fixed baseline. Change a baseline, metric, or budget only after a human
explicitly approves the specific change.

| Platform | Release archive baseline | Cold first-draw baseline |
| --- | ---: | ---: |
| Android | 99,183,283 bytes | 797.4 ms |
| iOS | 22,026,653 bytes | 5,325 ms |
| Web | | 130.4 ms |

The size baselines are the standalone release APK and the compressed universal
iOS simulator app from [Portal apps run 45937797895](https://github.com/yoav-zibin/course/actions/runs/45937797895).
App Store delivery sizes depend on packaging and device slicing.

Android uses `am start -S -W` on an installed release APK in offline UI-test
mode on a disposable API 35 x86_64 emulator. Its five baseline times in ms
were 628, 810, 759, 1028, and 762. The reported `TotalTime` measures initial
display.

iOS uses the first frame showing the home title in an iPhone 17, iOS 26.5
simulator video, timed from the first visible SpringBoard transition. Five
baseline times in ms were 3186.7, 3310.0, 5195.0, 6088.3, and 8845.0 from
[run 45842550105](https://github.com/yoav-zibin/course/actions/runs/45842550105)
and [run 45853359008](https://github.com/yoav-zibin/course/actions/runs/45853359008).
This measures the first recognizable app content using one video clock.

Web uses Chromium's first-contentful-paint on the compiled portal. Each sample
opens a fresh browser context and serves fixture data and real release assets
locally. The five baseline times in ms were 152, 128, 124, 124, and 124.

Set `BUILDPLAY_PERF_PLATFORM` to `android`, `ios`, or `web` and
`BUILDPLAY_PERF_INPUT` to the corresponding archive or the sample JSON from
the measurement. Run either of the following from the repository root.

```sh
node --test tests/performance/release-size.test.mjs
node --test tests/performance/cold-startup.test.mjs
```

To collect startup samples, run `measure-android-first-draw.py --serial
<emulator> <output.json>` against an installed release APK, run the iOS
`startup-video` benchmark and take the candidate `startup-video.json`, or run
`node tests/performance/measure-web-first-draw.mjs <output.json>` after compiling
the web portal and installing Playwright Chromium. Compare before and after
builds on the same host, device profile, workload, and artifact type.
