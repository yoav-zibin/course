The `react-native-svg` 15.16.0 Android patch repairs accessibility rectangles for
nested transforms. The original `mCTM` uses local-before-parent composition,
while drawing uses the actual Canvas stack. On a recorded 1080px device this
put Cell 1's accessibility bounds at `[118,872][358,1112]` while its artwork was
at approximately `[43,735][283,975]`.

The patch records separate Canvas-derived accessibility rectangles for paths
and images, unions those rectangles for groups, and exposes them to Android
accessibility. Rendering, layout, existing `mCTM` values and hit testing stay
unchanged. It does not change iOS or web code.

`npm ci` applies the dependency-free postinstall patch. It accepts only version
15.16.0 and the recorded source hashes, validates all files before writing,
and accepts an already-patched installation. Review and replace or remove it
when upgrading SVG; unknown source fails installation rather than guessing.

The portal tests cover clean installation, idempotence, version/source drift
and the recorded nested-transform regression. Native validation must also
compare accessibility XML with the physical board after compilation.
