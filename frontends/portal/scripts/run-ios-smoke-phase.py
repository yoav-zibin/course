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
    restrictions = []

    def send_group_signal(number):
        try:
            os.killpg(process.pid, number)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            restrictions.append(f"process-group {signal.Signals(number).name} denied (EPERM)")
            # macOS can restrict a group containing protected descendants.
            # Still attempt cleanup of the direct child we created.
            try:
                process.send_signal(number)
            except ProcessLookupError:
                pass
            except PermissionError:
                restrictions.append(f"direct-child {signal.Signals(number).name} denied (EPERM)")
            return False

    group_signalled = send_group_signal(signal.SIGTERM)
    deadline = time.monotonic() + 2
    while group_signalled and time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            group_signalled = False
            break
        except PermissionError:
            restrictions.append("process-group liveness check denied (EPERM)")
            break
        time.sleep(0.05)
    if group_signalled:
        send_group_signal(signal.SIGKILL)
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
        except ProcessLookupError:
            pass
        except PermissionError:
            restrictions.append("direct-child SIGKILL denied (EPERM)")
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            restrictions.append("direct child could not be reaped within cleanup deadline")
    return restrictions


def run_phase(label, timeout_seconds, output_path, command, max_output_bytes=512_000, retain_tail=False):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(f"[{started_at}] {label}: starting (deadline {timeout_seconds:g}s)", flush=True)
    total = written = 0
    timed_out = False
    process = None
    exit_code = 127
    cleanup_attempted = False
    cleanup_restrictions = []
    tail = bytearray()
    console_bytes = 0
    with output_path.open("wb") as output:
        def record(chunk):
            nonlocal total, written, console_bytes
            total += len(chunk)
            if retain_tail:
                tail.extend(chunk)
                del tail[:max(0, len(tail) - max_output_bytes)]
                output.seek(0)
                output.write(tail)
                output.truncate()
                output.flush()
                written = len(tail)
                # Diagnostic files retain their end; keep CI console traffic
                # small so a busy log sink cannot stall high-volume capture.
                visible = chunk[:max(0, 16_384 - console_bytes)]
                if visible:
                    print(visible.decode("utf-8", errors="replace"), end="", flush=True)
                    console_bytes += len(visible)
                return
            kept = chunk[:max(0, max_output_bytes - written)]
            if kept:
                output.write(kept)
                output.flush()
                print(kept.decode("utf-8", errors="replace"), end="", flush=True)
                written += len(kept)

        def cleanup():
            nonlocal cleanup_attempted
            if cleanup_attempted:
                return
            cleanup_attempted = True
            for restriction in stop_process_group(process):
                cleanup_restrictions.append(restriction)
                record(f"Cleanup restricted: {restriction}.\n".encode())

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
                        exit_code = 124
                        cleanup()
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
                drain_until = time.monotonic() + 0.25
                drained = 0
                while time.monotonic() < drain_until and drained < max_output_bytes:
                    try:
                        chunk = os.read(process.stdout.fileno(), 65536)
                    except BlockingIOError:
                        break
                    if not chunk:
                        break
                    record(chunk)
                    drained += len(chunk)
            exit_code = 124 if timed_out else process.wait(timeout=2)
            if exit_code < 0:
                exit_code = 128 - exit_code
        except OSError as error:
            if process is None:
                record(f"Could not start phase ({type(error).__name__}).\n".encode())
            else:
                exit_code = 124 if timed_out else 1
                record(f"Phase I/O failed ({type(error).__name__}).\n".encode())
        finally:
            if process is not None:
                if process.poll() is None:
                    cleanup()
                process.stdout.close()
        if total > written:
            if retain_tail:
                output.seek(0)
                output.write(b"[Earlier output truncated; retaining final bytes.]\n" + tail)
                output.truncate()
            else:
                output.write(b"\n[Output truncated at configured byte limit.]\n")
    result = {"phase": label, "started_at": started_at, "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "elapsed_seconds": round(time.monotonic() - started, 3), "deadline_seconds": timeout_seconds, "exit_code": exit_code, "timed_out": timed_out, "output_bytes": total, "output_truncated": total > written, "output_retention": "tail" if retain_tail else "head", "cleanup_restrictions": cleanup_restrictions}
    with (output_path.parent / "phases.jsonl").open("a") as summary:
        summary.write(json.dumps(result) + "\n")
    print(f"{label}: finished after {result['elapsed_seconds']:.1f}s; exit={exit_code}; timed_out={timed_out}", flush=True)
    return exit_code


if __name__ == "__main__":
    arguments = sys.argv[1:]
    retain_tail = arguments[:1] == ["--tail"]
    if retain_tail:
        arguments = arguments[1:]
    if len(arguments) < 4:
        raise SystemExit("Usage: run-ios-smoke-phase.py [--tail] LABEL SECONDS OUTPUT COMMAND [ARG ...]")
    raise SystemExit(run_phase(arguments[0], float(arguments[1]), arguments[2], arguments[3:], retain_tail=retain_tail))
