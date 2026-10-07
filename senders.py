"""Sends login codes by text message and email.

The "log" provider writes codes to the server log: fine for development, useless for
real users. Real sending needs credentials: Twilio for SMS, any SMTP server for
email. See config.example.json.
"""

import logging
import smtplib
from email.message import EmailMessage
from typing import Protocol

import httpx

from game_platform.config import EmailAuthConfig, SmsAuthConfig

logger = logging.getLogger(__name__)


class SenderError(Exception):
    """The code couldn't be sent."""


class CodeSender(Protocol):
    def send_login_code(self, destination: str, code: str) -> None:
        """Sends [code] to a phone number or email address. Raises [SenderError]."""
        ...


class LogSender:
    """Pretends to send by logging the code. For development only."""

    def send_login_code(self, destination: str, code: str) -> None:
        logger.info("login code for %s: %s", destination, code)


class TwilioSender:
    """Sends texts through Twilio (https://www.twilio.com)."""

    def __init__(
        self, *, account_sid: str, auth_token: str, from_number: str
    ) -> None:
        self._account_sid = account_sid
        self._auth_token = auth_token
        self._from_number = from_number

    def send_login_code(self, destination: str, code: str) -> None:
        try:
            response = httpx.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{self._account_sid}/Messages.json",
                auth=(self._account_sid, self._auth_token),
                data={
                    "From": self._from_number,
                    "To": destination,
                    "Body": (
                        f"Your game platform login code is {code}. "
                        "It expires in 10 minutes."
                    ),
                },
                timeout=10,
            )
        except httpx.HTTPError as error:
            raise SenderError(f"couldn't reach Twilio: {error}") from error
        if response.status_code >= 300:
            raise SenderError(f"Twilio refused to send: {response.text[:200]}")


class SmtpSender:
    """Sends email through any SMTP server."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        from_address: str,
        use_tls: bool,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._from_address = from_address
        self._use_tls = use_tls

    def send_login_code(self, destination: str, code: str) -> None:
        message = EmailMessage()
        message["Subject"] = "Your game platform login code"
        message["From"] = self._from_address
        message["To"] = destination
        message.set_content(
            f"Your game platform login code is {code}. It expires in 10 minutes.\n\n"
            "If you didn't ask for this, just ignore this email."
        )
        try:
            with smtplib.SMTP(self._host, self._port, timeout=10) as smtp:
                if self._use_tls:
                    smtp.starttls()
                if self._username:
                    smtp.login(self._username, self._password)
                smtp.send_message(message)
        except (smtplib.SMTPException, OSError) as error:
            raise SenderError(f"couldn't send the email: {error}") from error


def make_sms_sender(config: SmsAuthConfig) -> CodeSender:
    if config.provider == "twilio":
        return TwilioSender(
            account_sid=config.twilio_account_sid,
            auth_token=config.twilio_auth_token,
            from_number=config.twilio_from_number,
        )
    return LogSender()


def make_email_sender(config: EmailAuthConfig) -> CodeSender:
    if config.provider == "smtp":
        return SmtpSender(
            host=config.smtp_host,
            port=config.smtp_port,
            username=config.smtp_username,
            password=config.smtp_password,
            from_address=config.smtp_from_address,
            use_tls=config.smtp_use_tls,
        )
    return LogSender()
