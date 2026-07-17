#!/usr/bin/env python3
"""
memory.py — Lukas associative long-term memory via ChromaDB + sentence-transformers.

Persistent vector store in BASE_DIR/chroma_db.
Embedding model: all-MiniLM-L6-v2 (384-dim, CPU-only, ~80 MB).

Public API
----------
    add_memory(text, metadata={})    → None          (upsert by content hash)
    search_memory(query, n=5)        → list[dict]    (sorted by cosine similarity)
    memory_count()                   → int

Install on VPS (one time):
    pip install chromadb sentence-transformers
"""
import hashlib
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
_CHROMA_DIR = str(BASE_DIR / "chroma_db")
_COLLECTION_NAME = "lukas_memories"
_EMBED_MODEL = "all-MiniLM-L6-v2"

_client = None
_collection = None


def _get_collection():
    global _client, _collection
    if _collection is not None:
        return _collection
    import chromadb
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

    ef = SentenceTransformerEmbeddingFunction(model_name=_EMBED_MODEL)
    _client = chromadb.PersistentClient(path=_CHROMA_DIR)
    _collection = _client.get_or_create_collection(
        name=_COLLECTION_NAME,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"}
    )
    return _collection


def add_memory(text: str, metadata: dict = None) -> None:
    """
    Store a memory as a semantic vector.
    Silently deduplicated: same content hash → upsert (no duplicates).
    text is truncated to 2000 chars before embedding.
    """
    if not text or not text.strip():
        return
    try:
        col = _get_collection()
        mem_id = hashlib.sha256(text.encode()).hexdigest()[:32]
        meta = {}
        for k, v in (metadata or {}).items():
            if v is not None:
                meta[k] = str(v)
        if "date" not in meta:
            meta["date"] = datetime.now().strftime("%Y-%m-%d %H:%M")
        col.upsert(
            ids=[mem_id],
            documents=[text[:2000]],
            metadatas=[meta]
        )
    except Exception as e:
        print(f"  [memory] add_memory error: {e}")


def search_memory(query: str, n: int = 5, mem_type: str = None) -> list:
    """
    Retrieve the n most semantically similar memories.

    Returns: list of {"document": str, "metadata": dict, "distance": float}
             sorted ascending by cosine distance (lower = more similar).
    Returns [] if ChromaDB not installed or collection is empty.
    """
    if not query or not query.strip():
        return []
    try:
        col = _get_collection()
        count = col.count()
        if count == 0:
            return []
        kwargs = {
            "query_texts": [query],
            "n_results": min(n, count),
            "include": ["documents", "metadatas", "distances"]
        }
        if mem_type:
            kwargs["where"] = {"type": {"$eq": mem_type}}
        results = col.query(**kwargs)
        hits = []
        for doc, meta, dist in zip(
            results.get("documents", [[]])[0],
            results.get("metadatas", [[]])[0],
            results.get("distances", [[]])[0],
        ):
            hits.append({"document": doc, "metadata": meta, "distance": round(dist, 4)})
        return hits
    except Exception as e:
        print(f"  [memory] search_memory error: {e}")
        return []


def memory_count() -> int:
    """Return total number of stored memories (0 if ChromaDB not installed)."""
    try:
        return _get_collection().count()
    except Exception:
        return 0
