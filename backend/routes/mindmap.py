from fastapi import APIRouter, Depends
from auth.models import User
from auth.router import get_current_user
from schemas.mindmap_schema import MindMapRequest
from services.mindmap_service import (
    generate_mindmap,
    regenerate_mindmap,
    get_mindmap,
    delete_mindmap,
)

router = APIRouter(prefix="/mindmap", tags=["Mind Map"])


@router.post("/generate")
def generate_mindmap_route(
    request: MindMapRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        mindmap = generate_mindmap(
            user_id=current_user.id,
            chat_id=request.chat_id,
        )
    except Exception as e:
        print(f"Unexpected error in /mindmap/generate: {e}")
        return {
            "error": "Something went wrong while generating your mind map. Please try again."
        }

    return mindmap


@router.post("/regenerate")
def regenerate_mindmap_route(
    request: MindMapRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        mindmap = regenerate_mindmap(
            user_id=current_user.id,
            chat_id=request.chat_id,
        )
    except Exception as e:
        print(f"Unexpected error in /mindmap/regenerate: {e}")
        return {
            "error": "Something went wrong while regenerating your mind map. Please try again."
        }

    return mindmap


@router.get("/{chat_id}")
def get_mindmap_route(
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    try:
        mindmap = get_mindmap(
            user_id=current_user.id,
            chat_id=chat_id,
        )
    except Exception as e:
        print(f"Unexpected error in GET /mindmap/{{chat_id}}: {e}")
        return {
            "error": "Something went wrong while fetching your mind map. Please try again."
        }

    return mindmap


@router.delete("/{chat_id}")
def delete_mindmap_route(
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    try:
        result = delete_mindmap(
            user_id=current_user.id,
            chat_id=chat_id,
        )
    except Exception as e:
        print(f"Unexpected error in DELETE /mindmap/{{chat_id}}: {e}")
        return {
            "error": "Something went wrong while deleting your mind map. Please try again."
        }

    return result
