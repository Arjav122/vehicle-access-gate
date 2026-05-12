from typing import Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from app.services.entry_service import process_plate_access


class EntryAgentState(TypedDict, total=False):
    plate_raw: str
    result: dict[str, Any]


def _entry_node(state: EntryAgentState, config: RunnableConfig) -> dict[str, Any]:
    db: Session = config["configurable"]["db"]
    out = process_plate_access(db, state.get("plate_raw", ""))
    return {"result": out.model_dump()}


def build_entry_agent():
    g = StateGraph(EntryAgentState)
    g.add_node("entry", _entry_node)
    g.set_entry_point("entry")
    g.add_edge("entry", END)
    return g.compile()


def run_entry_agent(db: Session, plate_raw: str) -> dict[str, Any]:
    graph = build_entry_agent()
    final = graph.invoke(
        {"plate_raw": plate_raw},
        config={"configurable": {"db": db}},
    )
    return final.get("result") or {}
