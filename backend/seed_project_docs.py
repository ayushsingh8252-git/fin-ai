"""
One-off ingestion script: pushes docs/agenticflow-overview.md through the exact
same pipeline a PDF upload goes through (chunk -> store in SQL -> embed +
upsert into Pinecone -> LLM rule extraction), so the assistant can answer
questions about the AgenticFlow product itself, not just HR policy PDFs.

Run from backend/ with the venv active:
    venv\\Scripts\\python.exe seed_project_docs.py
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import Document
from app.worker import _process_text_blocks

MD_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "agenticflow-overview.md")
DOC_NAME = "AgenticFlow — Platform Overview"


def blocks_from_markdown(path: str) -> list[dict]:
    """
    Splits the overview doc into (heading, paragraph) blocks. Heading lines are
    short, single-line, and ALL CAPS, which is exactly the heuristic
    chunk_document() uses to detect a new section — so these become the
    "section" tag on every chunk that follows, the same way a real PDF's
    all-caps headers would.
    """
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()

    paragraphs = [p.strip() for p in raw.split("\n\n") if p.strip()]

    blocks = []
    for i, para in enumerate(paragraphs):
        blocks.append({"page": i + 1, "text": para, "bbox": None, "page_dim": None})
    return blocks


def main():
    blocks = blocks_from_markdown(MD_PATH)
    print(f"Parsed {len(blocks)} blocks from {MD_PATH}")

    db = SessionLocal()
    try:
        existing = db.query(Document).filter(Document.name == DOC_NAME).first()
        if existing:
            print(f"Document already exists (id={existing.id}); skipping re-ingest to avoid duplicate vectors.")
            print("Delete it first (DB row + matching Pinecone vectors) if you want to re-run.")
            return

        doc_id = str(uuid.uuid4())
        doc = Document(id=doc_id, name=DOC_NAME, metadata_={"status": "processing", "source": "project_overview_md"})
        db.add(doc)
        db.commit()

        print(f"Created document {doc_id}, running ingestion pipeline...")
        result = _process_text_blocks(doc_id, blocks, db)
        print("Result:", result)
    finally:
        db.close()


if __name__ == "__main__":
    main()
