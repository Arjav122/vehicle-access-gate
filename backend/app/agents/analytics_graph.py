from typing import Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from app.services.dashboard_service import build_dashboard
from app.services.reports_service import weekly_traffic_summary


class AnalyticsAgentState(TypedDict, total=False):
    summary: dict[str, Any]


def _collect_node(_: AnalyticsAgentState, config: RunnableConfig) -> dict[str, Any]:
    db: Session = config["configurable"]["db"]
    dash = build_dashboard(db).model_dump(mode="json")
    week = weekly_traffic_summary(db)
    return {"summary": {"dashboard": dash, "weekly_traffic": week}}


def build_analytics_agent():
    g = StateGraph(AnalyticsAgentState)
    g.add_node("collect", _collect_node)
    g.set_entry_point("collect")
    g.add_edge("collect", END)
    return g.compile()


def run_analytics_agent(db: Session) -> dict[str, Any]:
    graph = build_analytics_agent()
    final = graph.invoke({}, config={"configurable": {"db": db}})
    return final.get("summary") or {}
