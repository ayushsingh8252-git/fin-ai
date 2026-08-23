from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from ..services.retrieval import retrieve_rules_and_chunks_parallel
from ..services.reasoning import generate_answer_with_fallback
from ..services.cache import get_cached_query, set_cached_query
from ..services.guardrails import check_input, check_output
from ..services.multilingual import (
    detect_language,
    get_language_name,
    translate_to_english,
    translate_from_english
)

router = APIRouter()

class QueryRequest(BaseModel):
    query: str
    top_k: int = 5
    document_id: str | None = None

@router.post("/query")
async def process_query(request: QueryRequest):
    try:
        raw_query = request.query.strip()
        if not raw_query:
            raise HTTPException(status_code=400, detail="Query string cannot be empty.")

        # 0a. Input guardrail — length cap, control-char stripping, and a
        # small prompt-injection phrase blocklist. Regex-only, so this adds
        # no measurable latency to a normal query.
        input_check = check_input(raw_query)
        if not input_check.allowed:
            return {
                "answer": "I can't process that request. Please rephrase your question about the platform or its policies.",
                "sources": [],
                "retrieval_mode": "blocked",
            }
        raw_query = input_check.text

        # 0b. Redis Query Cache Check
        cached_result = get_cached_query(request.document_id, raw_query, request.top_k)
        if cached_result:
            return cached_result
            
        # 1. Language Detection via langdetect
        detected_lang = detect_language(raw_query)
        language_name = get_language_name(detected_lang)
        
        search_query = raw_query
        translated_to_english = False
        
        # 2. If non-English, translate query to English for vector search & reasoning
        if detected_lang != "en":
            print(f"[Multilingual Pipeline] Non-English detected ({language_name} - {detected_lang}). Translating to English...")
            search_query = translate_to_english(raw_query, detected_lang)
            translated_to_english = True
            print(f"[Multilingual Pipeline] Translated Query: '{search_query}'")
            
        # 3. Parallel Vector Retrieval for Rules AND Raw Chunks
        retrieved_rules, retrieved_chunks = retrieve_rules_and_chunks_parallel(
            search_query, request.top_k, request.document_id
        )
        
        # 4. Adaptive-Corrective Reasoning Layer (CRAG + HyDE + Step-Back + Cross-Encoder Fusion)
        answer_data = generate_answer_with_fallback(
            search_query, retrieved_rules, retrieved_chunks, document_id=request.document_id
        )
        
        # 5. Translate English answer back into user's language if non-English
        if detected_lang != "en" and answer_data.get("answer") and answer_data["answer"] != "Required info missing from document context.":
            print(f"[Multilingual Pipeline] Translating answer back into {language_name} ({detected_lang})...")
            answer_data["answer"] = translate_from_english(answer_data["answer"], detected_lang)
            
        # 6. Attach Multilingual Metadata
        answer_data["detected_language"] = detected_lang
        answer_data["language_name"] = language_name
        if translated_to_english:
            answer_data["original_query"] = raw_query
            answer_data["translated_query"] = search_query

        # 6b. Output guardrail — redacts anything credential/PII-shaped that
        # slipped into the generated answer (e.g. from a crawled web result).
        if answer_data.get("answer"):
            answer_data["answer"] = check_output(answer_data["answer"]).text

        # 7. Write Result to Redis Cache
        set_cached_query(request.document_id, raw_query, answer_data, request.top_k)
        
        return answer_data
        
    except Exception as e:
        print(f"[Query API Error]: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
