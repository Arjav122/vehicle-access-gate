from datetime import datetime
from zoneinfo import ZoneInfo

from app.config import get_settings


def app_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().default_timezone)


def now_in_app_tz() -> datetime:
    return datetime.now(app_tz())


def start_of_today_utc_naive_for_query() -> datetime:
    """Window start in app TZ converted to aware datetime for DB comparisons."""
    n = now_in_app_tz()
    start = n.replace(hour=0, minute=0, second=0, microsecond=0)
    return start


def end_of_today_in_app_tz() -> datetime:
    n = now_in_app_tz()
    return n.replace(hour=23, minute=59, second=59, microsecond=999999)
