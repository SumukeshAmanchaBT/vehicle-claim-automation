"""
VCA centralised runtime configuration.

ALL numeric knobs — timeouts, retry budgets, data-cap limits — live here.
No bare integer literals for these concerns should appear in business-logic
modules.  Import the pre-built singleton and read its attributes::

    from claim_automation.vca_config import cfg

    # pass to requests
    requests.get(url, timeout=cfg.image_fetch_timeout_s)

    # pass to Django settings
    SLOW_REQUEST_MS = cfg.slow_request_threshold_ms

─── How values are computed ────────────────────────────────────────────────

All configuration is read from environment variables (or the project .env
file, which Django loads before any app code runs).

*Primary* knobs are read directly from env vars and have hard-coded safe
defaults that are reasonable without any tuning:

    MYSQL_CONNECT_TIMEOUT   — TCP connect budget for the DB host    (s, int)
    MYSQL_READ_TIMEOUT      — socket-read budget per query          (s, int)
    MYSQL_WRITE_TIMEOUT     — socket-write budget per query         (s, int)
    MYSQL_CONN_MAX_AGE      — persistent-connection reuse window    (s, int)

*Derived* knobs adapt automatically when a primary knob changes.  The
derivation rules are:

    image_fetch_timeout_s
        = max(10, round(mysql_read_timeout_s × IMAGE_FETCH_RATIO))
        Rationale: remote-image fetches finish well within the DB read
        budget; 75 % leaves room without being overly tight.
        Override: IMAGE_FETCH_TIMEOUT (s, int)

    slow_request_threshold_ms
        = max(500, round(mysql_read_timeout_s × 1000 × SLOW_REQUEST_RATIO))
        Rationale: log "slow" when < 10 % of the read budget has elapsed so
        there is still enough time to return a response before the client
        gives up.  7.5 % of a 20 s budget = 1 500 ms.
        Override: DJANGO_SLOW_REQUEST_MS (ms, int)

    eval_records_per_claim_cap
        = max(20, round(mysql_read_timeout_s × EVAL_ROWS_PER_SECOND))
        Rationale: the evaluation-history window query payload grows with
        this cap; 2 rows/s of read budget keeps it bounded under load.
        Override: EVAL_RECORDS_PER_CLAIM (int)

─── Tuning globally ────────────────────────────────────────────────────────

To adjust ALL timeouts at once, change MYSQL_READ_TIMEOUT in .env.
Every derived value recalculates at next server start — no code changes
needed.

To pin a single derived value, set its override env var (see above).

─── Module-level singleton ─────────────────────────────────────────────────

``cfg`` is built once at import time.  Because Django always finishes loading
``settings.py`` (which populates ``os.environ`` from .env) before any
application module is imported, the singleton reflects the final, merged
environment.
"""
from __future__ import annotations

import os
from pathlib import Path

__all__ = ["cfg"]

# ─── Derivation ratio constants ──────────────────────────────────────────────
# Expressed as named module-level constants so they are easy to find and
# understand; they are NOT exposed on ``cfg`` because they are meta-config,
# not runtime values callers need.

# image_fetch_timeout = mysql_read_timeout × this ratio  (min 10 s)
_IMAGE_FETCH_RATIO: float = 0.75

# slow_request_threshold = mysql_read_timeout_ms × this ratio  (min 500 ms)
_SLOW_REQUEST_RATIO: float = 0.075

# eval_records_cap = mysql_read_timeout_s × this multiplier  (min 20 rows)
_EVAL_ROWS_PER_SECOND: float = 2.0

# Absolute floor / ceiling constants (prevent nonsensical values even if env
# vars are set to extremes).
_CONNECT_TIMEOUT_MIN_S: int = 1
_CONNECT_TIMEOUT_MAX_S: int = 120
_READ_WRITE_TIMEOUT_MIN_S: int = 5
_READ_WRITE_TIMEOUT_MAX_S: int = 300
_CONN_MAX_AGE_MIN_S: int = 0
_CONN_MAX_AGE_MAX_S: int = 3_600
_IMAGE_FETCH_MIN_S: int = 5
_IMAGE_FETCH_MAX_S: int = 120
_SLOW_REQUEST_MIN_MS: int = 250
_SLOW_REQUEST_MAX_MS: int = 30_000
_EVAL_RECORDS_MIN: int = 10
_EVAL_RECORDS_MAX: int = 500


# ─── Private helpers ─────────────────────────────────────────────────────────

def _load_env_file(path: Path) -> None:
    """Best-effort load of KEY=VALUE pairs from *path* into os.environ.

    No-ops silently if the file is missing.  Matches the logic in settings.py
    so this module can safely be imported before Django's settings are loaded
    (e.g. in management commands or test runners).
    """
    if not path.is_file():
        return
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)).strip())
    except (TypeError, ValueError):
        return default


def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


# Load .env so this module works correctly even if imported before settings.py
# (e.g. standalone scripts, pytest fixtures).  Django's settings.py also loads
# it, but os.environ assignments are idempotent so the double-load is harmless.
_load_env_file(Path(__file__).resolve().parent.parent / ".env")


# ─── Primary values (directly configurable) ──────────────────────────────────

_MYSQL_CONNECT_TIMEOUT_S: int = _clamp(
    _env_int("MYSQL_CONNECT_TIMEOUT", 5),
    lo=_CONNECT_TIMEOUT_MIN_S,
    hi=_CONNECT_TIMEOUT_MAX_S,
)

_MYSQL_READ_TIMEOUT_S: int = _clamp(
    _env_int("MYSQL_READ_TIMEOUT", 20),
    lo=_READ_WRITE_TIMEOUT_MIN_S,
    hi=_READ_WRITE_TIMEOUT_MAX_S,
)

_MYSQL_WRITE_TIMEOUT_S: int = _clamp(
    _env_int("MYSQL_WRITE_TIMEOUT", _MYSQL_READ_TIMEOUT_S),
    lo=_READ_WRITE_TIMEOUT_MIN_S,
    hi=_READ_WRITE_TIMEOUT_MAX_S,
)

_MYSQL_CONN_MAX_AGE_S: int = _clamp(
    _env_int("MYSQL_CONN_MAX_AGE", 600),
    lo=_CONN_MAX_AGE_MIN_S,
    hi=_CONN_MAX_AGE_MAX_S,
)


# ─── Derived (adaptive) values ────────────────────────────────────────────────

def _derive_image_fetch_timeout(db_read_s: int) -> int:
    """75 % of the DB read timeout, floored at 10 s.

    Allows explicit override via IMAGE_FETCH_TIMEOUT (seconds).
    """
    adaptive_default = max(10, round(db_read_s * _IMAGE_FETCH_RATIO))
    return _clamp(
        _env_int("IMAGE_FETCH_TIMEOUT", adaptive_default),
        lo=_IMAGE_FETCH_MIN_S,
        hi=_IMAGE_FETCH_MAX_S,
    )


def _derive_slow_request_ms(db_read_s: int) -> int:
    """7.5 % of the DB read timeout in ms, floored at 500 ms.

    Allows explicit override via DJANGO_SLOW_REQUEST_MS (milliseconds).
    """
    adaptive_default = max(500, round(db_read_s * 1_000 * _SLOW_REQUEST_RATIO))
    return _clamp(
        _env_int("DJANGO_SLOW_REQUEST_MS", adaptive_default),
        lo=_SLOW_REQUEST_MIN_MS,
        hi=_SLOW_REQUEST_MAX_MS,
    )


def _derive_eval_records_cap(db_read_s: int) -> int:
    """2 rows per second of DB read timeout, floored at 20 rows.

    Keeps the /fraud-claims evaluation-history window-query payload
    proportional to how long we are willing to wait for the DB.
    Allows explicit override via EVAL_RECORDS_PER_CLAIM (integer).
    """
    adaptive_default = max(20, round(db_read_s * _EVAL_ROWS_PER_SECOND))
    return _clamp(
        _env_int("EVAL_RECORDS_PER_CLAIM", adaptive_default),
        lo=_EVAL_RECORDS_MIN,
        hi=_EVAL_RECORDS_MAX,
    )


# ─── Public config class and singleton ───────────────────────────────────────

class _VcaConfig:
    """Immutable snapshot of all VCA numeric configuration values.

    Constructed once at module-import time from the current environment.
    All attributes are plain ``int`` seconds or milliseconds as documented.

    Attributes
    ----------
    mysql_connect_timeout_s : int
        TCP connect timeout for the DB host (seconds).
    mysql_read_timeout_s : int
        Per-query socket-read timeout (seconds).  **Primary knob.**
    mysql_write_timeout_s : int
        Per-query socket-write timeout (seconds).
    mysql_conn_max_age_s : int
        How long Django reuses a persistent DB connection (seconds).
    image_fetch_timeout_s : int
        ``requests.get`` timeout for remote damage-assessment images (seconds).
        Derived: ``max(10, round(mysql_read_timeout_s × 0.75))``.
    slow_request_threshold_ms : int
        Duration above which a request is logged as slow (milliseconds).
        Derived: ``max(500, round(mysql_read_timeout_s × 75))``.
    eval_records_per_claim_cap : int
        Max evaluation-history rows returned per claim in /fraud-claims.
        Derived: ``max(20, round(mysql_read_timeout_s × 2))``.
    """

    __slots__ = (
        "mysql_connect_timeout_s",
        "mysql_read_timeout_s",
        "mysql_write_timeout_s",
        "mysql_conn_max_age_s",
        "image_fetch_timeout_s",
        "slow_request_threshold_ms",
        "eval_records_per_claim_cap",
    )

    def __init__(self) -> None:
        self.mysql_connect_timeout_s: int = _MYSQL_CONNECT_TIMEOUT_S
        self.mysql_read_timeout_s: int = _MYSQL_READ_TIMEOUT_S
        self.mysql_write_timeout_s: int = _MYSQL_WRITE_TIMEOUT_S
        self.mysql_conn_max_age_s: int = _MYSQL_CONN_MAX_AGE_S
        self.image_fetch_timeout_s: int = _derive_image_fetch_timeout(_MYSQL_READ_TIMEOUT_S)
        self.slow_request_threshold_ms: int = _derive_slow_request_ms(_MYSQL_READ_TIMEOUT_S)
        self.eval_records_per_claim_cap: int = _derive_eval_records_cap(_MYSQL_READ_TIMEOUT_S)

    def __repr__(self) -> str:
        pairs = ", ".join(f"{s}={getattr(self, s)!r}" for s in self.__slots__)
        return f"VcaConfig({pairs})"


#: Module-level singleton — import this in all other modules.
cfg: _VcaConfig = _VcaConfig()
