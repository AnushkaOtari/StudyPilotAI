from typing import List, Optional

from pydantic import BaseModel


class SourceRef(BaseModel):
    document: str
    pages: List[int] = []
    description: str = ""


class GraphNode(BaseModel):
    id: str
    label: str
    description: str = ""
    type: str = "concept"
    sources: List[SourceRef] = []


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    relationship: str
    label: str = ""
    documents: List[str] = []


class DocumentStatus(BaseModel):
    filename: str
    status: str
    error: Optional[str] = None
    has_graph: bool = False
    node_count: int = 0
    edge_count: int = 0
    warnings: List[str] = []
    updated_at: Optional[float] = None


class GraphStats(BaseModel):
    node_count: int = 0
    edge_count: int = 0
    document_count: int = 0


class KnowledgeGraphResponse(BaseModel):
    chat_id: str
    status: str
    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []
    documents: List[DocumentStatus] = []
    stats: GraphStats = GraphStats()


class DocumentGraphResponse(BaseModel):
    chat_id: str
    filename: str
    status: str
    error: Optional[str] = None
    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []
    stats: GraphStats = GraphStats()


class GraphStatusResponse(BaseModel):
    chat_id: str
    status: str
    documents: List[DocumentStatus] = []


class RegenerateResponse(BaseModel):
    chat_id: str
    filename: str
    status: str
    message: str


class DeleteGraphResponse(BaseModel):
    message: str
    deleted: bool
