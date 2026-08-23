import json
import re
from .llm_service import generate_json_resilient as generate_json
from .web_service import tavily_search
from ..database import SessionLocal
from ..models import Chunk

def _is_truthy(val) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes")
    return bool(val)

# The LLM occasionally emits a markdown bold wrapper around a field that
# resolves to nothing (e.g. an empty citation title), leaving a bare "****" or
# "**  **" in the answer text. Real markdown can never contain zero-width bold
# emphasis (CommonMark requires non-whitespace content between "**" pairs), so
# collapsing only "**" pairs that have nothing but whitespace between them is
# safe — the immediate-reappearance requirement means it can never match into
# legitimate "**bold text**" content. Scoped to "**"/"__" only (not single
# "*"/"_", which also appear in list markers and would be ambiguous).
_EMPTY_BOLD_RE = re.compile(r"(\*\*|__)(\s*)\1")

def strip_empty_emphasis(text: str) -> str:
    return _EMPTY_BOLD_RE.sub(lambda m: m.group(2), text)

def generate_answer_with_fallback(query: str, retrieved_rules: list[dict], retrieved_chunks: list[dict], document_id: str | None = None) -> dict:
    """
    Adaptive-Corrective RAG reasoning pipeline (CRAG + HyDE + Step-Back + Cross-Encoder Fusion).
    Falls back gracefully to legacy reasoning if adaptive pipeline errors.
    """
    try:
        from .adaptive_rag import execute_adaptive_rag_pipeline
        return execute_adaptive_rag_pipeline(
            query=query,
            initial_rules=retrieved_rules,
            initial_chunks=retrieved_chunks,
            document_id=document_id
        )
    except Exception as e:
        print(f"[Adaptive RAG Engine Error, falling back to legacy reasoning]: {e}")
        return generate_legacy_answer(query, retrieved_rules, retrieved_chunks)


def generate_legacy_answer(query: str, retrieved_rules: list[dict], retrieved_chunks: list[dict]) -> dict:
    """
    Dual-tier legacy reasoning pipeline:
    1. First tries answering using retrieved Rules.
    2. If Rules context does not contain the answer, falls back to Normal Chunk context.
    3. If neither contains the required info, returns "Required info missing".
    """
    
    # ── Tier 1: Try Rule-Based Reasoning ──
    rules_text_list = []
    rule_sources = []
    for r in retrieved_rules:
        meta = r.get("metadata", {})
        rule_str = meta.get("canonical_rule") or meta.get("key_finding", "")
        # Include match if score > 0.45 (BGE cosine similarity below this is
        # typically unrelated content, not a genuine match)
        if rule_str and r.get("score", 0) > 0.45:
            rules_text_list.append(
                f"- [Rule ID: {meta.get('rule_id', r.get('rule_id', 'N/A'))}] ({meta.get('type', 'GUIDELINE')}): {rule_str}. Section: {meta.get('section', 'General')}"
            )
            bbox = meta.get("bbox")
            page_dim = meta.get("page_dim")
            if isinstance(bbox, str):
                try: bbox = json.loads(bbox)
                except: pass
            if isinstance(page_dim, str):
                try: page_dim = json.loads(page_dim)
                except: pass
            rule_sources.append({
                "document_id": meta.get("document_id"),
                "page": meta.get("page"),
                "bbox": bbox,
                "page_dim": page_dim
            })

    if rules_text_list:
        rules_context = "\n".join(rules_text_list)
        prompt_rules = f"""
        You are an AI Policy Intelligence Engine. Answer the user question using the extracted policy rules context below.

        User Question: "{query}"

        Extracted Policy Rules Context:
        {rules_context}

        Instructions:
        1. If the rules context contains relevant information or allows answering the user question, provide a detailed answer and set "has_info": true.
        2. Set "has_info": false unless the rules context explicitly and directly answers the question.

        Return ONLY a JSON object:
        {{
          "has_info": true,
          "answer": "Your comprehensive answer based on rules"
        }}
        """
        try:
            res_rules = generate_json(prompt_rules)
            if isinstance(res_rules, dict):
                has_info = _is_truthy(res_rules.get("has_info"))
                answer = strip_empty_emphasis(res_rules.get("answer", "").strip())
                if has_info and answer and "required info missing" not in answer.lower():
                    return {
                        "answer": answer,
                        "sources": rule_sources,
                        "retrieval_mode": "rules"
                    }
        except Exception as e:
            print(f"[Reasoning Tier 1 Error]: {e}")
            # Direct text fallback from top matched rule
            top_rule_strs = [r.get("metadata", {}).get("canonical_rule", "") for r in retrieved_rules if r.get("metadata", {}).get("canonical_rule")]
            if top_rule_strs:
                return {
                    "answer": f"Based on policy rules: {top_rule_strs[0]}",
                    "sources": rule_sources,
                    "retrieval_mode": "rules"
                }

    # ── Tier 2: Fallback to Normal Chunk-Based RAG ──
    chunks_text_list = []
    chunk_sources = []
    
    # Expand chunk content from DB if needed
    db = SessionLocal()
    try:
        for c in retrieved_chunks:
            meta = c.get("metadata", {})
            chunk_id = meta.get("chunk_id")
            content = meta.get("content", "")
            
            # Fetch full content from DB if the metadata preview was truncated.
            # canonicalization.py stores at most content[:1000] in Pinecone
            # metadata, so anything at or above that length is a truncated
            # preview, not the full chunk.
            if chunk_id and len(content) >= 1000:
                db_chunk = db.query(Chunk).filter(Chunk.id == chunk_id).first()
                if db_chunk and db_chunk.content:
                    content = db_chunk.content

            if content and c.get("score", 0) > 0.45:
                chunks_text_list.append(f"- [Section: {meta.get('section', 'General')}, Page {meta.get('page', 1)}]: {content}")
                bbox = meta.get("bbox")
                page_dim = meta.get("page_dim")
                if isinstance(bbox, str):
                    try: bbox = json.loads(bbox)
                    except: pass
                if isinstance(page_dim, str):
                    try: page_dim = json.loads(page_dim)
                    except: pass
                chunk_sources.append({
                    "document_id": meta.get("document_id"),
                    "page": meta.get("page"),
                    "bbox": bbox,
                    "page_dim": page_dim,
                    "is_audio": meta.get("is_audio", False),
                    "timestamp_str": meta.get("timestamp_str", ""),
                    "start_time": meta.get("start_time"),
                    "end_time": meta.get("end_time")
                })
    finally:
        db.close()

    if chunks_text_list:
        chunks_context = "\n".join(chunks_text_list)
        prompt_chunks = f"""
        You are an AI Document Assistant. Answer the user question using the raw document text context below.

        User Question: "{query}"

        Document Text Context:
        {chunks_context}

        Instructions:
        1. If the document context contains relevant information or allows answering the question, provide a complete response and set "has_info": true.
        2. Set "has_info": false unless the document context explicitly and directly answers the question.

        Return ONLY a JSON object:
        {{
          "has_info": true,
          "answer": "Your detailed answer based on document text"
        }}
        """
        try:
            res_chunks = generate_json(prompt_chunks)
            if isinstance(res_chunks, dict):
                has_info = _is_truthy(res_chunks.get("has_info"))
                answer = strip_empty_emphasis(res_chunks.get("answer", "").strip())
                if has_info and answer and "required info missing" not in answer.lower():
                    return {
                        "answer": answer,
                        "sources": chunk_sources,
                        "retrieval_mode": "chunks"
                    }
        except Exception as e:
            print(f"[Reasoning Tier 2 Error]: {e}")
            top_chunk_strs = [c.get("metadata", {}).get("content", "") for c in retrieved_chunks if c.get("metadata", {}).get("content")]
            if top_chunk_strs:
                return {
                    "answer": f"Based on document context: {top_chunk_strs[0][:300]}...",
                    "sources": chunk_sources,
                    "retrieval_mode": "chunks"
                }

    # ── Tier 3: Live Web Search (Tavily) — for questions outside the indexed
    # documents entirely (general knowledge, current info), rather than giving up.
    web_results = tavily_search(query)
    if web_results:
        web_context = "\n\n".join(
            f"- [{r['title']}]({r['url']}): {r['content'][:600]}" for r in web_results
        )
        prompt_web = f"""
        You are an AI assistant answering from live web search results because the
        organization's own documents did not cover this question.

        User Question: "{query}"

        Web Search Results:
        {web_context}

        Instructions:
        1. Answer using only the web results above. If they don't answer the question, set "has_info": false.
        2. Make clear this came from the web, not internal policy documents.

        Return ONLY a JSON object:
        {{
          "has_info": true,
          "answer": "Your answer based on the web results"
        }}
        """
        try:
            res_web = generate_json(prompt_web)
            if isinstance(res_web, dict):
                has_info = _is_truthy(res_web.get("has_info"))
                answer = strip_empty_emphasis(res_web.get("answer", "").strip())
                if has_info and answer:
                    return {
                        "answer": answer,
                        "sources": [{"title": r["title"], "url": r["url"]} for r in web_results],
                        "retrieval_mode": "web"
                    }
        except Exception as e:
            print(f"[Reasoning Tier 3 (Web) Error]: {e}")
            return {
                "answer": f"From the web: {web_results[0]['content'][:400]}",
                "sources": [{"title": r["title"], "url": r["url"]} for r in web_results],
                "retrieval_mode": "web"
            }

    # ── Tier 4: Final Fallback - Required info missing ──
    return {
        "answer": "Required info missing from document context.",
        "sources": [],
        "retrieval_mode": "missing"
    }

def generate_answer(query: str, retrieved_rules: list[dict]) -> dict:
    return generate_answer_with_fallback(query, retrieved_rules, [])
