from typing import Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from app.schemas.visitor import VisitorCreate
from app.services.visitor_service import create_visitor_pass


class VisitorAgentState(TypedDict, total=False):
    payload: dict[str, Any]
    result: dict[str, Any]


def _register_node(state: VisitorAgentState, config: RunnableConfig) -> dict[str, Any]:
    db: Session = config["configurable"]["db"]
    data = VisitorCreate.model_validate(state["payload"])
    out = create_visitor_pass(db, data)
    return {"result": out.model_dump()}


def build_visitor_agent():
    g = StateGraph(VisitorAgentState)
    g.add_node("register", _register_node)
    g.set_entry_point("register")
    g.add_edge("register", END)
    return g.compile()


def run_visitor_agent(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    graph = build_visitor_agent()
    final = graph.invoke(
        {"payload": payload},
        config={"configurable": {"db": db}},
    )
    return final.get("result") or {}
