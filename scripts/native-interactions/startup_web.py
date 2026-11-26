"""Time navigation to the populated fixture board in an empty Chromium context."""
import argparse
import asyncio
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

from startup_frames import opening_bounds


class MissedBoardFrame(Exception):
    """The board was painted, but Chromium omitted it from the screencast."""


async def trial(browser, origin, output):
    context = await browser.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True,
                                        has_touch=True, device_scale_factor=1, service_workers='block')
    try:
        await context.request.post(origin + '/__reset')
        page = await context.new_page()
        session = await context.new_cdp_session(page)
        recorded, acks = [], []
        populated = asyncio.get_running_loop().create_future()

        def frame(event):
            acks.append(asyncio.create_task(session.send('Page.screencastFrameAck', {'sessionId': event['sessionId']})))
            png = base64.b64decode(event['data'])
            stamp = event['metadata']['timestamp'] * 1000
            recorded.append(stamp)
            if not populated.done():
                image = np.asarray(Image.open(io.BytesIO(png)).convert('RGB'))
                if opening_bounds(image) is not None:
                    populated.set_result((stamp, png))

        session.on('Page.screencastFrame', frame)
        await session.send('Page.startScreencast', {'format': 'png', 'everyNthFrame': 1})
        try:
            await page.goto(origin + '/portal#match=benchmark-opening', wait_until='commit')
            await page.get_by_test_id('game-stage').wait_for(timeout=20_000)
            try:
                stamp, png = await asyncio.wait_for(populated, timeout=20)
            except asyncio.TimeoutError as error:
                screenshot = await page.screenshot()
                image = np.asarray(Image.open(io.BytesIO(screenshot)).convert('RGB'))
                if opening_bounds(image) is None:
                    raise RuntimeError('The Backgammon board did not appear') from error
                (output / 'unmeasured-board.png').write_bytes(screenshot)
                raise MissedBoardFrame('The populated board was absent from the recorded frames') from error
        finally:
            await session.send('Page.stopScreencast')
            await asyncio.gather(*acks)
        start = await page.evaluate('performance.timeOrigin')
        requests = await (await context.request.get(origin + '/__requests')).json()
        paths = {request['path'] for request in requests}
        if stamp <= start or '/matches/benchmark-opening' not in paths or not {'/matches/benchmark-opening/game','/games/5f5293c3-2a3a-4eec-b631-9debf59be0ca/versions/10'}.intersection(paths):
            raise RuntimeError('The recorded frame did not follow an uncached match and package request')
        elapsed = round(stamp - start, 1)
        (output / 'board.png').write_bytes(png)
        (output / 'timing.json').write_text(json.dumps({
            'board_ms': elapsed, 'time_origin_ms': start, 'board_timestamp_ms': stamp,
            'frame_timestamps_ms': recorded, 'requests': requests}, indent=2) + '\n')
        return elapsed
    finally:
        await context.close()


async def run(args):
    origins = {'current': args.origin}
    if args.baseline:
        origins = {'baseline': args.baseline, **origins}
    samples = {name: [] for name in origins}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        for index in range(1, args.samples + 1):
            for name in origins if index % 2 else reversed(origins):
                output = args.output / name / str(index)
                output.mkdir(parents=True)
                try:
                    elapsed = await trial(browser, origins[name], output)
                except MissedBoardFrame:
                    print(name, index, 'missing compositor frame, retrying in a fresh context', flush=True)
                    elapsed = await trial(browser, origins[name], output)
                samples[name].append(elapsed)
                print(name, index, elapsed, flush=True)
        await browser.close()
    (args.output / 'startup-web.json').write_text(json.dumps(samples, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin', help='Loopback startup fixture serving the current web build')
    parser.add_argument('output', type=Path)
    parser.add_argument('--baseline', help='Second fixture serving the previous web build')
    parser.add_argument('--samples', type=int, choices=range(1, 11), default=5)
    asyncio.run(run(parser.parse_args()))
