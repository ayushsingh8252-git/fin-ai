import os
import sys
import uuid
from dotenv import load_dotenv

# Load env before importing app modules
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

from app.worker import process_document_task


def run_test(file_path: str = None):
    if not file_path:
        file_path = os.getenv("TEST_PDF_PATH", "sample.pdf")
    if not os.path.exists(file_path):
        print(f"File not found at {file_path}. Specify via TEST_PDF_PATH env var or pass as argument.")
        return

    doc_id = str(uuid.uuid4())
    print(f"Starting process_document_task for {file_path} with ID {doc_id}")

    # Call the task synchronously
    result = process_document_task(doc_id, file_path)

    print("\n--- Final Result ---")
    print(result)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else None
    run_test(target)
