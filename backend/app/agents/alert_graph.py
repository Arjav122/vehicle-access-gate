from typing import Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from app.services.alert_service import run_visitor_overstay_checks


class AlertAgentState(TypedDict, total=False):
    triggered_visitor_ids: list[str]


def _scan_node(_: AlertAgentState, config: RunnableConfig) -> dict[str, Any]:
    db: Session = config["configurable"]["db"]
    ids = run_visitor_overstay_checks(db)
    return {"triggered_visitor_ids": [str(i) for i in ids]}


def build_alert_agent():
    g = StateGraph(AlertAgentState)
    g.add_node("scan", _scan_node)
    g.set_entry_point("scan")
    g.add_edge("scan", END)
    return g.compile()


def run_alert_agent(db: Session) -> list[str]:
    graph = build_alert_agent()
    final = graph.invoke({}, config={"configurable": {"db": db}})
    return final.get("triggered_visitor_ids") or []
