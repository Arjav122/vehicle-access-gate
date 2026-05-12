from pydantic import BaseModel, Field


class AssistantRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)


class AssistantResponse(BaseModel):
    reply: str
