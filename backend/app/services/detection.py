from sentence_transformers import SentenceTransformer

# Load SentenceTransformer for embeddings (BAAI/bge-base-en-v1.5)
# This model will be downloaded on first run.
# For a production system, you would want to instantiate this once on startup.
# We'll use a global variable to cache it.
_embedding_model = None

def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer("BAAI/bge-base-en-v1.5")
    return _embedding_model
