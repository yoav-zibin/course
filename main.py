"""Runs the game platform HTTP server."""

import argparse
import logging
from pathlib import Path

import uvicorn

from game_platform.api import create_app
from game_platform.config import Config, load_config
from game_platform.json_file_store import JsonFileStore
from game_platform.service import GamePlatform

logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        help="JSON config file (see config.example.json); omitted fields, or all of "
        "them without this flag, take their defaults",
    )
    parser.add_argument(
        "--print-config",
        action="store_true",
        help="print the effective config as JSON and exit",
    )
    args = parser.parse_args()
    config = load_config(args.config) if args.config is not None else Config()
    if args.print_config:
        print(config.model_dump_json(indent=2))
        return

    logging.basicConfig(level=config.log_level)
    data_file = config.data_file.path.expanduser()
    data_file.parent.mkdir(parents=True, exist_ok=True)
    store = JsonFileStore(
        data_file, min_write_interval_seconds=config.data_file.save_interval_seconds
    )
    logger.info("Using data file %s", data_file)
    try:
        app = create_app(
            GamePlatform(store=store),
            debug_tools=config.debug_tools,
            master_password=config.master_password,
            model_api_config=config.model_api,
        )
        uvicorn.run(
            app,
            host=config.server.host,
            port=config.server.port,
            timeout_keep_alive=config.server.keep_alive_timeout_seconds,
            log_level=config.log_level.lower(),
        )
    finally:
        # Saves changes made since the last write before exiting.
        store.close()


if __name__ == "__main__":
    main()
