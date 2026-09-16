import os
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..services.hiring_service import (
    generate_assignment,
    match_candidate_to_requirement,
    parse_resume_pdf,
)
from ..services.upload_safety import safe_filename, MAX_UPLOAD_BYTES

router = APIRouter(prefix="/hiring", tags=["hiring"])

UPLOAD_DIR = os.path.join("uploads", "hiring")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/parse-resumes")
async def parse_resumes(files: List[UploadFile] = File(...)):
    """Parses a bulk batch of resume PDFs into structured, ATS-scored candidates."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    candidates = []
    for file in files:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext != ".pdf":
            candidates.append({
                "filename": file.filename, "status": "failed",
                "reason": "Only PDF resumes are supported.",
            })
            continue

        content = await file.read()
        if not content:
            candidates.append({"filename": file.filename, "status": "failed", "reason": "File is empty."})
            continue
        if len(content) > MAX_UPLOAD_BYTES:
            candidates.append({
                "filename": file.filename, "status": "failed",
                "reason": f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB upload limit.",
            })
            continue

        cand_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_DIR, f"{cand_id}_{safe_filename(file.filename)}")
        with open(file_path, "wb") as f:
            f.write(content)

        try:
            fields = parse_resume_pdf(file.filename or cand_id, file_path)
        finally:
            # Resumes aren't retained beyond this pipeline run — nothing downstream
            # links back to the file on disk once parsing has produced structured fields.
            try:
                os.remove(file_path)
            except OSError:
                pass

        candidates.append({"id": cand_id, "status": "parsed", **fields})

    return {"candidates": candidates}


class MatchCandidateIn(BaseModel):
    id: str
    name: Optional[str] = None
    experience: Optional[str] = None
    skills: List[str] = []
    summary: Optional[str] = None
    ats_score: Optional[int] = None


class MatchRequest(BaseModel):
    candidates: List[MatchCandidateIn]
    requirement: str
    role_title: str = "the open role"


@router.post("/match")
async def match_requirement(request: MatchRequest):
    """Scores each parsed candidate against an HR-written requirement brief."""
    results = []
    for c in request.candidates:
        match = match_candidate_to_requirement(c.model_dump(), request.requirement, request.role_title)
        results.append({"id": c.id, **match})
    return {"results": results}


class AssignmentRequest(BaseModel):
    requirement: str
    role_title: str = "the open role"


@router.post("/assignment")
async def assignment(request: AssignmentRequest):
    """Drafts a personalized take-home assignment from an HR requirement brief."""
    return generate_assignment(request.requirement, request.role_title)
