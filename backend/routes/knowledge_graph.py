import os
import re

from fastapi import APIRouter, Depends, HTTPException, status

from auth.models import User
from auth.router import get_current_user
from rag.rag_pipeline import is_chat_deleting
from schemas.knowledge_graph_schema import (
    DeleteGraphResponse,
    DocumentGraphResponse,
    GraphStatusResponse,
    KnowledgeGraphResponse,
    RegenerateResponse,
)
from services import knowledge_graph_service as kg_service
from services import knowledge_graph_store as store
from services.knowledge_graph_store import (
    IN_PROGRESS_STATUSES,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_NOT_STARTED,
    STATUS_PROCESSING,
)
from services.knowledge_graph_worker import (
    INTERRUPTED_MESSAGE,
    delete_chat_graphs,
    delete_document_graph,
    get_worker,
)

router = APIRouter(prefix="/knowledge-graph", tags=["Knowledge Graph"])

# Must match BASE_UPLOAD_FOLDER in app.py. Chat ownership is checked by
# looking inside the authenticated user's own upload folder.
BASE_UPLOAD_FOLDER = "uploads"
SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")


# -----------------------------
# Helpers
# -----------------------------

def _chat_upload_folder(user_id, chat_id):
    """Validate the chat and return the user's own upload folder for it.

    The user id comes from the login token only. A chat that has no upload
    folder for THIS user is reported as not found, which is also what
    another user's chat looks like.
    """
    if not SAFE_SEGMENT_RE.fullmatch(str(chat_id)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat id."
        )

    if is_chat_deleting(user_id, chat_id) or store.is_chat_deleted(
        user_id, chat_id
    ):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This chat has been deleted."
        )

    folder = os.path.join(
        BASE_UPLOAD_FOLDER, f"user_{user_id}", f"chat_{chat_id}"
    )

    if not os.path.isdir(folder):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found."
        )

    return folder


def _validate_filename(filename):
    if (
        os.path.basename(filename) != filename
        or not filename.lower().endswith(".pdf")
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF filenames are allowed."
        )


def _pdfs_in(folder):
    return sorted(
        f for f in os.listdir(folder) if f.lower().endswith(".pdf")
    )


def _effective_status(user_id, chat_id, record):
    """Stored status, except that PENDING/PROCESSING with no live job
    (e.g. after a crash) is reported as FAILED instead of hanging forever."""

    stored = record.get("status")
    error = record.get("error")

    if stored in IN_PROGRESS_STATUSES and not get_worker().is_active(
        user_id, chat_id, record["filename"]
    ):
        return STATUS_FAILED, INTERRUPTED_MESSAGE

    return stored, error


def _document_status(user_id, chat_id, filename, record):
    if record is None:
        return {
            "filename": filename,
            "status": STATUS_NOT_STARTED,
            "error": None,
            "has_graph": False,
            "node_count": 0,
            "edge_count": 0,
            "warnings": [],
            "updated_at": None,
        }

    doc_status, error = _effective_status(user_id, chat_id, record)
    nodes = record.get("nodes") or []

    return {
        "filename": filename,
        "status": doc_status,
        "error": error,
        "has_graph": bool(nodes),
        "node_count": len(nodes),
        "edge_count": len(record.get("edges") or []),
        "warnings": record.get("warnings") or [],
        "updated_at": record.get("updated_at"),
    }


def _overall_status(documents):
    if not documents:
        return STATUS_NOT_STARTED

    statuses = {d["status"] for d in documents}

    if statuses & set(IN_PROGRESS_STATUSES):
        return STATUS_PROCESSING

    if statuses == {STATUS_COMPLETED}:
        return STATUS_COMPLETED

    if STATUS_COMPLETED in statuses or any(d["has_graph"] for d in documents):
        return "PARTIAL"

    if STATUS_FAILED in statuses:
        return STATUS_FAILED

    return STATUS_NOT_STARTED


def _chat_documents(user_id, chat_id, folder):
    """(document statuses, records with a graph) for PDFs still in the chat."""
    present = _pdfs_in(folder)
    records = {r["filename"]: r for r in store.list_docs(user_id, chat_id)}

    documents = [
        _document_status(user_id, chat_id, name, records.get(name))
        for name in present
    ]

    with_graph = [
        records[name] for name in present
        if name in records and records[name].get("nodes")
    ]

    return documents, with_graph


# -----------------------------
# Endpoints
# -----------------------------

@router.get("", response_model=KnowledgeGraphResponse)
def get_chat_graph(
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    folder = _chat_upload_folder(current_user.id, chat_id)

    documents, with_graph = _chat_documents(
        current_user.id, chat_id, folder
    )

    nodes, edges = kg_service.merge_documents(with_graph)

    return {
        "chat_id": chat_id,
        "status": _overall_status(documents),
        "nodes": nodes,
        "edges": edges,
        "documents": documents,
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "document_count": len(with_graph),
        },
    }


@router.get("/status", response_model=GraphStatusResponse)
def get_graph_status(
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    folder = _chat_upload_folder(current_user.id, chat_id)

    documents, _ = _chat_documents(current_user.id, chat_id, folder)

    return {
        "chat_id": chat_id,
        "status": _overall_status(documents),
        "documents": documents,
    }


@router.get("/documents/{filename}", response_model=DocumentGraphResponse)
def get_document_graph(
    filename: str,
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    folder = _chat_upload_folder(current_user.id, chat_id)
    _validate_filename(filename)

    if filename not in _pdfs_in(folder):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found in this chat."
        )

    record = store.read_doc(current_user.id, chat_id, filename)

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No knowledge graph exists for this PDF yet. "
                "Use the regenerate endpoint to create it."
            )
        )

    doc_status, error = _effective_status(
        current_user.id, chat_id, record
    )

    nodes, edges = kg_service.merge_documents([record])

    return {
        "chat_id": chat_id,
        "filename": filename,
        "status": doc_status,
        "error": error,
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "document_count": 1 if nodes else 0,
        },
    }


@router.post(
    "/documents/{filename}/regenerate",
    response_model=RegenerateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def regenerate_document_graph(
    filename: str,
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    folder = _chat_upload_folder(current_user.id, chat_id)
    _validate_filename(filename)

    if filename not in _pdfs_in(folder):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found in this chat."
        )

    outcome = get_worker().submit(
        current_user.id,
        chat_id,
        filename,
        os.path.join(folder, filename),
        force=True,
    )

    if outcome["accepted"]:
        return {
            "chat_id": chat_id,
            "filename": filename,
            "status": outcome["status"],
            "message": "Knowledge graph generation started.",
        }

    reason = outcome["reason"]

    if reason == "already_running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Graph generation is already running for this PDF."
        )

    if reason == "chat_deleted":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This chat has been deleted."
        )

    if reason == "not_configured":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Knowledge graph generation is not available because "
                "the AI service is not configured."
            )
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="PDF not found in this chat."
    )


@router.delete(
    "/documents/{filename}", response_model=DeleteGraphResponse
)
def delete_document_graph_route(
    filename: str,
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    _chat_upload_folder(current_user.id, chat_id)
    _validate_filename(filename)

    deleted = delete_document_graph(current_user.id, chat_id, filename)

    return {
        "message": f"Knowledge graph for {filename} deleted.",
        "deleted": deleted,
    }


@router.delete("", response_model=DeleteGraphResponse)
def delete_chat_graph_route(
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    _chat_upload_folder(current_user.id, chat_id)

    deleted = delete_chat_graphs(current_user.id, chat_id)

    return {
        "message": "All knowledge graph data for this chat deleted.",
        "deleted": deleted,
    }
