import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AccessLog, Visitor, VisitorStatus
from app.services.dashboard_service import build_dashboard
from app.services.reports_service import overstayed_visitors_summary, weekly_traffic_summary

logger = logging.getLogger(__name__)


def _make_tools(db: Session):
    @tool
    def today_entries() -> str:
        """Count of entry and exit events today (Asia/Kolkata calendar day)."""
        d = build_dashboard(db)
        return json.dumps(
            {"entries_today": d.entries_today, "exits_today": d.exits_today},
            default=str,
        )

    @tool
    def visitors_overstayed() -> str:
        """Visitors whose active pass window has passed."""
        rows = overstayed_visitors_summary(db)
        return json.dumps(rows, default=str)

    @tool
    def weekly_traffic() -> str:
        """Last 7 days entry/exit counts."""
        return json.dumps(weekly_traffic_summary(db), default=str)

    @tool
    def most_frequent_plates(limit: int = 10) -> str:
        """Most frequent plates in access logs."""
        lim = min(max(limit, 1), 50)
        q = (
            select(AccessLog.plate_normalized, func.count().label("c"))
            .group_by(AccessLog.plate_normalized)
            .order_by(func.count().desc())
            .limit(lim)
        )
        rows = db.execute(q).all()
        return json.dumps([{"plate": r[0], "count": int(r[1])} for r in rows], default=str)

    @tool
    def suspicious_unknown_repeats(min_count: int = 3) -> str:
        """Plates often in logs without linked vehicle (heuristic)."""
        q = (
            select(AccessLog.plate_normalized, func.count().label("c"))
            .where(AccessLog.user_type == "VISITOR")
            .group_by(AccessLog.plate_normalized)
            .having(func.count() >= min_count)
            .order_by(func.count().desc())
            .limit(20)
        )
        rows = db.execute(q).all()
        return json.dumps([{"plate": r[0], "count": int(r[1])} for r in rows], default=str)

    @tool
    def active_visitors_count() -> str:
        """Visitors with ACTIVE status."""
        n = db.scalar(
            select(func.count()).select_from(Visitor).where(Visitor.status == VisitorStatus.VALID)
        ) or 0
        return json.dumps({"active_visitors": int(n)}, default=str)

    return [
        today_entries,
        visitors_overstayed,
        weekly_traffic,
        most_frequent_plates,
        suspicious_unknown_repeats,
        active_visitors_count,
    ]


def run_assistant(db: Session, user_message: str) -> str:
    settings = get_settings()
    if not settings.openai_api_key:
        return "OPENAI_API_KEY is not configured. Set it in the environment to use the AI assistant."

    tools = _make_tools(db)
    llm_tools = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.2,
        api_key=settings.openai_api_key,
    ).bind_tools(tools)
    llm_plain = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.2,
        api_key=settings.openai_api_key,
    )

    tz = settings.default_timezone
    sys = SystemMessage(
        content=(
            "You are the AI assistant for an AI Vehicle Access Management admin dashboard. "
            f"All business dates use timezone {tz}. "
            "Answer concisely. When the user asks for data, call the appropriate tools first, "
            "then summarize results in plain language."
        )
    )
    messages: list = [sys, HumanMessage(content=user_message)]

    try:
        ai = llm_tools.invoke(messages)
        if getattr(ai, "tool_calls", None):
            messages.append(ai)
            name_to_fn = {t.name: t for t in tools}
            for tc in ai.tool_calls:
                name = tc.get("name")
                tid = tc.get("id") or ""
                args = tc.get("args") or {}
                fn = name_to_fn.get(name)
                if fn:
                    out = fn.invoke(args)
                    messages.append(ToolMessage(content=str(out), tool_call_id=tid))
            final = llm_plain.invoke(messages)
            return str(final.content)
        return str(ai.content)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Assistant error: %s", exc)
        return f"Assistant error: {exc}"
