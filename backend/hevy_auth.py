"""Local sign-in support: password verification and browser session tokens.

The browser only ever holds a random session token.  The Hevy password is kept
in server memory (needed to refresh data from Hevy) and, once verified, as a
salted scrypt hash on disk so later sign-ins can be checked without calling Hevy.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

SESSION_TTL_SECONDS = 30 * 24 * 60 * 60


class AuthError(Exception):
    """Raised when credentials or a session token are not valid."""


@dataclass(frozen=True)
class HevyCredentials:
    email_or_username: str
    password: str


def _normalize(identifier: str) -> str:
    return identifier.strip().casefold()


def _hash(password: str, salt: bytes) -> str:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32).hex()


class PasswordStore:
    """Salted password hashes keyed by sign-in identifier (username or email)."""

    def __init__(self, path: Path) -> None:
        self._path = Path(path)
        self._lock = threading.Lock()

    def _read(self) -> dict[str, dict[str, str]]:
        try:
            data = json.loads(self._path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def check(self, identifier: str, password: str) -> bool | None:
        """True/False if this identifier is known, None if it has never been verified."""
        with self._lock:
            entry = self._read().get(_normalize(identifier))
        if not isinstance(entry, dict) or "salt" not in entry or "hash" not in entry:
            return None
        try:
            expected = entry["hash"]
            actual = _hash(password, bytes.fromhex(entry["salt"]))
        except ValueError:
            return None
        return hmac.compare_digest(expected, actual)

    def remember(self, identifiers: Iterable[str], password: str) -> None:
        salt = secrets.token_bytes(16)
        entry = {"salt": salt.hex(), "hash": _hash(password, salt)}
        with self._lock:
            data = self._read()
            for identifier in identifiers:
                if identifier and identifier.strip():
                    data[_normalize(identifier)] = entry
            tmp = self._path.with_suffix(self._path.suffix + ".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as handle:
                json.dump(data, handle)
            os.replace(tmp, self._path)


class SessionStore:
    """In-memory session tokens.  Restarting the backend signs everyone out."""

    def __init__(self, ttl: int = SESSION_TTL_SECONDS, clock: Callable[[], float] = time.time) -> None:
        self._ttl = ttl
        self._clock = clock
        self._sessions: dict[str, tuple[HevyCredentials, float]] = {}
        self._lock = threading.Lock()

    def create(self, credentials: HevyCredentials) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._sessions[token] = (credentials, self._clock() + self._ttl)
        return token

    def get(self, token: str) -> HevyCredentials | None:
        with self._lock:
            entry = self._sessions.get(token)
            if entry is None:
                return None
            if entry[1] < self._clock():
                del self._sessions[token]
                return None
            return entry[0]

    def revoke(self, token: str) -> None:
        with self._lock:
            self._sessions.pop(token, None)
