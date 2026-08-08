from __future__ import annotations

from typing import List
from pydantic import BaseModel, Field


class MindMapNode(BaseModel):
    title: str = Field(..., description="Short topic title")
    summary: str = Field(..., description="1-2 sentence summary")
    key_points: List[str] = Field(default_factory=list)
    related_concepts: List[str] = Field(default_factory=list)
    children: List["MindMapNode"] = Field(default_factory=list)


MindMapNode.model_rebuild()


class MindMapRequest(BaseModel):
    chat_id: str


class MindMapResponse(BaseModel):
    root: MindMapNode