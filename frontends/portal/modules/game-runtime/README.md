# Isolated game runtime

This local Expo module evaluates downloaded game JavaScript in a fresh QuickJS
heap for each call. It exposes no native functions, module loader, filesystem,
network, storage, account credentials or application objects. JSON text is its
only input/output. Calls run off the UI thread and are bounded by 16 MiB heap,
256 KiB stack, a 1.2 second execution deadline, 1.5 MB source and 900 KB output.
The presentation wrapper separately forbids random numbers and the clock.

The browser adapter uses an opaque-origin, network-disabled iframe containing
a fresh terminable Worker for each invocation. It has the same output and time
limits. Browser workers do not provide a configurable heap limit; the native
QuickJS adapter enforces the heap limit directly.

`cpp/quickjs` contains the unmodified source files needed to embed the official
QuickJS 2025-09-13 release (archive `quickjs-2025-09-13-2.tar.xz` from
https://bellard.org/quickjs/). Its MIT license is retained in that directory.
The source archive SHA-256 is
`996c6b5018fc955ad4d06426d0e9cb713685a00c825aa5c0418bd53f7df8b0b4`.
Do not enable QuickJS libc or native module loading for game code.

`npm test` at the portal root compiles these same C files into a temporary host
test executable and checks isolation, time/memory bounds, JSON transport,
fresh contexts, Unicode and the deterministic practice rules contract.
