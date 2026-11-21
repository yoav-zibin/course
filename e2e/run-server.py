"""Provider fixtures confined to the disposable, loopback Playwright child.

There is no production test endpoint or authentication bypass. Tests establish
normal admin sessions through the real origin and session machinery, while
this child replaces the external Google verification boundary only.
"""

import runpy
import os
import sys
from pathlib import Path


config_path = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(config_path.parent))
from game_platform.config import load_config

config = load_config(config_path)
if (config.server.host != "127.0.0.1" or config.firestore.enabled
        or config.master_password != "e2e-test-master"
        or config.data_file.path.resolve().parent != config_path.parent
        or config.auth.google.client_id):
    raise RuntimeError("Google provider fixtures require the disposable loopback configuration")

from game_platform import admin_auth
from game_platform.oauth import ProviderError


def fixture_google(id_token, client_id):
    if client_id != "loopback-admin-google-client":
        raise ProviderError("Invalid disposable Google fixture")
    if id_token == "loopback-outsider-google-fixture":
        return "loopback-outsider-google-subject", "Not in course", "outsider@loopback.example.test", ""
    if id_token != "loopback-admin-google-fixture":
        raise ProviderError("Invalid disposable Google fixture")
    return "loopback-admin-google-subject", "E2E administrator", "admin@loopback.example.test", ""


# Keep /auth/config and ordinary player Google login unchanged. These replacements
# live in this isolated process, never in application configuration or HTTP input.
admin_auth._google_client_id = lambda request: "loopback-admin-google-client"
admin_auth.verify_google_admin_token = fixture_google
os.environ["GAME_PLATFORM_ADMIN_API_KEY"] = "e2e-test-master"
sys.argv = ["game_platform.main", "--config", str(config_path)]
runpy.run_module("game_platform.main", run_name="__main__")
