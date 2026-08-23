import sys
from app.services.canonicalization import get_pinecone_index

try:
    index = get_pinecone_index()
    stats = index.describe_index_stats()
    print("Pinecone is working. Dimension:", stats.get("dimension"))
except Exception as e:
    print("Pinecone is NOT working:", e)
