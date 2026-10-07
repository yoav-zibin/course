"""Server configuration, read from a JSON file. Every field has a default."""

import ipaddress
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]


class _Section(BaseModel):
    # Typos in a config file should fail loudly, not be silently ignored.
    model_config = ConfigDict(extra="forbid", frozen=True)


class ServerConfig(_Section):
    host: str = "127.0.0.1"
    port: Annotated[int, Field(ge=1, le=65535)] = 8000
    # How long an idle keep-alive connection stays open. uvicorn's own default (5s) is
    # shorter than the pauses between a person's clicks, and proxies that reuse
    # connections without noticing they were closed (and don't retry) then fail the next
    # request with errors like "Connection closed by remote host".
    keep_alive_timeout_seconds: Annotated[int, Field(ge=1)] = 3600


class DataFileConfig(_Section):
    # "~" is expanded; relative paths are relative to the config file's directory.
    path: Path = Path("~/.local/share/game-platform/data.json")
    # After a change, the file is rewritten at most once per this many seconds.
    save_interval_seconds: Annotated[float, Field(ge=0)] = 1.0


class ModelApiConfig(_Section):
    # Meta Model API key (get one at https://dev.meta.ai). Empty disables
    # model features. Prefer the MUSE_SPARK_API_KEY environment variable
    # over storing the key in this file.
    api_key: str = ""
    model: str = "muse-spark-1.3"
    base_url: str = "https://api.ai.meta.com/v1"


class GoogleAuthConfig(_Section):
    # Google OAuth client ID for the website (Google Cloud Console > APIs & Services >
    # Credentials > Create Credentials > OAuth client ID, type "Web application", with
    # the site's origin as an authorized JavaScript origin). Empty disables Google login.
    client_id: str = ""


class SmsAuthConfig(_Section):
    # How login codes are texted. "log" writes them to the server log (development
    # only); "twilio" sends real texts (https://www.twilio.com).
    provider: Literal["log", "twilio"] = "log"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    # The Twilio number texts come from, in E.164 format, e.g. +15551234567.
    twilio_from_number: str = ""


class EmailAuthConfig(_Section):
    # How login codes are emailed. "log" writes them to the server log (development
    # only); "smtp" sends real email through any SMTP server.
    provider: Literal["log", "smtp"] = "log"
    smtp_host: str = ""
    smtp_port: Annotated[int, Field(ge=1, le=65535)] = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_address: str = ""
    smtp_use_tls: bool = True


class AuthConfig(_Section):
    google: GoogleAuthConfig = GoogleAuthConfig()
    sms: SmsAuthConfig = SmsAuthConfig()
    email: EmailAuthConfig = EmailAuthConfig()


class Config(_Section):
    server: ServerConfig = ServerConfig()
    data_file: DataFileConfig = DataFileConfig()
    # Serve the /console and /browse pages and /debug/all-data, which expose all data.
    debug_tools: bool = True
    # Protects /browse and /debug/all-data (HTTP basic auth, any username). Empty means
    # no password, which is only allowed when [server.host] is a numeric IP address.
    master_password: str = ""
    log_level: LogLevel = "INFO"
    model_api: ModelApiConfig = ModelApiConfig()
    auth: AuthConfig = AuthConfig()

    @model_validator(mode="after")
    def _require_master_password_for_hostnames(self) -> "Config":
        if (
            self.debug_tools
            and not self.master_password
            and not _is_ip_address(self.server.host)
        ):
            raise ValueError(
                f"master_password must be set when server.host ({self.server.host!r}) "
                "is a hostname rather than a numeric IP address"
            )
        return self


def _is_ip_address(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def load_config(path: Path) -> Config:
    """Raises [pydantic.ValidationError] if the file is invalid."""
    config = Config.model_validate_json(path.read_bytes())
    data_file = config.data_file.path.expanduser()
    if not data_file.is_absolute():
        data_file = path.parent / data_file
    return config.model_copy(
        update={
            "data_file": config.data_file.model_copy(
                update={"path": data_file.resolve()}
            )
        }
    )
