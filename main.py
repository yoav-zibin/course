"""Runs the game platform HTTP server."""

import argparse
import logging
from pathlib import Path

import uvicorn

from game_platform.api import create_app
from game_platform.config import Config, load_config
from game_platform.json_file_store import JsonFileStore
from game_platform.senders import make_email_sender, make_sms_sender
from game_platform.service import GamePlatform

logger = logging.getLogger(__name__)


def warn_about_insecure_setup(config: Config, platform: GamePlatform) -> None:
    """Logs problems that are fine in development and dangerous on the internet."""
    if config.debug_tools and not config.master_password:
        logger.warning(
            "debug_tools is on with no master_password: anyone who can reach this "
            "server can read every user's password via /browse and /debug/all-data"
        )
    weak = [u.id for u in platform.all_data().users if u.password == u.id]
    if weak:
        logger.warning(
            "%d user(s) have their own id as password (example data?): %s. Anyone "
            "can act as them; remove them with --purge-example-data",
            len(weak),
            ", ".join(weak[:10]),
        )


def purge_example_data(platform: GamePlatform) -> None:
    """Deletes the users that the example data file creates (password == id), with
    what they own. Real users' passwords are random, so they never match."""
    for user in platform.all_data().users:
        if user.password == user.id:
            platform.admin_delete_user(user.id)
            print(f"deleted {user.id}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        help="JSON config file (see config.example.json); omitted fields, or all of "
        "them without this flag, take their defaults",
    )
    parser.add_argument(
        "--purge-example-data",
        action="store_true",
        help="delete every user whose password equals their id (the example data's "
        "users) with their games and matches, save, and exit; stop the server first",
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
        data_file,
        min_write_interval_seconds=config.data_file.save_interval_seconds,
        backup_interval_seconds=config.data_file.backup_interval_seconds,
        backup_keep=config.data_file.backup_keep,
    )
    logger.info("Using data file %s", data_file)
    try:
        platform = GamePlatform(store=store)
        if args.purge_example_data:
            purge_example_data(platform)
            return
        warn_about_insecure_setup(config, platform)
        app = create_app(
            platform,
            debug_tools=config.debug_tools,
            master_password=config.master_password,
            model_api_config=config.model_api,
            auth_config=config.auth,
            sms_sender=make_sms_sender(config.auth.sms),
            email_sender=make_email_sender(config.auth.email),
            cors_allow_origins=config.server.cors_allow_origins,
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
