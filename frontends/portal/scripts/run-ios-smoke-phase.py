#!/usr/bin/env python3
"""Run one simulator phase with streamed, bounded output and a process deadline."""

import datetime
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time


def stop_process_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.05)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=2)


def run_phase(label, timeout_seconds, output_path, command, max_output_bytes=512_000):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(f"[{started_at}] {label}: starting (deadline {timeout_seconds:g}s)", flush=True)
    total = written = 0
    timed_out = False
    process = None
    exit_code = 127
    with output_path.open("wb") as output:
        def record(chunk):
            nonlocal total, written
            total += len(chunk)
            kept = chunk[:max(0, max_output_bytes - written)]
            if kept:
                output.write(kept)
                output.flush()
                print(kept.decode("utf-8", errors="replace"), end="", flush=True)
                written += len(kept)

        try:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            os.set_blocking(process.stdout.fileno(), False)
            with selectors.DefaultSelector() as watcher:
                watcher.register(process.stdout, selectors.EVENT_READ)
                next_progress = started + 30
                while watcher.get_map() or process.poll() is None:
                    remaining = timeout_seconds - (time.monotonic() - started)
                    if remaining <= 0:
                        timed_out = True
                        stop_process_group(process)
                        break
                    for key, _ in watcher.select(min(1, remaining)):
                        chunk = os.read(key.fd, 65536)
                        if chunk:
                            record(chunk)
                        else:
                            watcher.unregister(key.fileobj)
                    if time.monotonic() >= next_progress:
                        print(f"{label}: still running after {time.monotonic() - started:.1f}s", flush=True)
                        next_progress = time.monotonic() + 30
                # Preserve bytes already buffered at the deadline without
                # waiting for descendants to close inherited output pipes.
                while True:
                    try:
                        chunk = os.read(process.stdout.fileno(), 65536)
                    except BlockingIOError:
                        break
                    if not chunk:
                        break
                    record(chunk)
            exit_code = 124 if timed_out else process.wait(timeout=2)
            if exit_code < 0:
                exit_code = 128 - exit_code
        except OSError as error:
            record(f"Could not start phase ({type(error).__name__}).\n".encode())
        finally:
            if process is not None:
                if process.poll() is None:
                    stop_process_group(process)
                process.stdout.close()
        if total > written:
            output.write(b"\n[Output truncated at configured byte limit.]\n")
    result = {"phase": label, "started_at": started_at, "elapsed_seconds": round(time.monotonic() - started, 3), "deadline_seconds": timeout_seconds, "exit_code": exit_code, "timed_out": timed_out, "output_bytes": total, "output_truncated": total > written}
    with (output_path.parent / "phases.jsonl").open("a") as summary:
        summary.write(json.dumps(result) + "\n")
    print(f"{label}: finished after {result['elapsed_seconds']:.1f}s; exit={exit_code}; timed_out={timed_out}", flush=True)
    return exit_code


if __name__ == "__main__":
    if len(sys.argv) < 5:
        raise SystemExit("Usage: run-ios-smoke-phase.py LABEL SECONDS OUTPUT COMMAND [ARG ...]")
    raise SystemExit(run_phase(sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4:]))
