"""RAG tool — thin wrapper around api/query.py::process_query. No retrieval,
reasoning, or reranking logic lives here; this file only translates between
the tool-call contract (dict params -> dict result) and process_query's own
QueryRequest/return-dict shape."""
from typing import Any, Dict, List

from fastapi import HTTPException

from ..api.query import QueryRequest, process_query
from ..mcp.base import BaseMCPConnector, MCPToolError


class RAGConnector(BaseMCPConnector):
    name = "rag"
    display_name = "RAG (Document Q&A)"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        # process_query itself fails soft per-provider (Groq -> Gemini -> web
        # search fallback chain in services/llm_service.py / adaptive_rag.py)
        # rather than hard-requiring one specific key, so there's no single
        # env var whose absence makes this tool unusable the way Sarvam/
        # WhatsApp/Google are all-or-nothing. Always "configured" from the
        # tool layer's point of view; a real call still fails with a clear
        # error if literally no LLM key is present anywhere.
        return []

    def register_tools(self) -> None:
        self._add_tool(
            name="query_documents",
            description=(
                "Search the internal knowledge base (ingested policy/rule documents) and "
                "return a grounded answer with source citations for a natural-language query. "
                "Use this to answer questions about the content of uploaded documents."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The natural-language question to answer."},
                    "document_id": {
                        "type": "string",
                        "description": "Restrict retrieval to one previously-uploaded document's ID. Omit to search across all documents.",
                    },
                    "top_k": {"type": "integer", "default": 5, "description": "How many candidate chunks/rules to retrieve before answering."},
                },
                "required": ["query"],
            },
            handler=self._query_documents,
        )

    def _query_documents(self, params: Dict[str, Any]) -> Dict[str, Any]:
        query = (params.get("query") or "").strip()
        if not query:
            raise MCPToolError("`query` is required", code="validation_error", status_code=400)

        request = QueryRequest(
            query=query,
            top_k=int(params.get("top_k", 5)),
            document_id=params.get("document_id"),
            request_id=params.get("request_id"),
        )
        try:
            result = process_query(request)
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            raise MCPToolError(
                detail.get("message", "RAG query failed"),
                code="business_logic_error",
                status_code=e.status_code,
            ) from None

        # Normalize to the tool-response shape without dropping anything
        # process_query already returns (sources/citations included as-is).
        return {
            "answer": result.get("answer"),
            "sources": result.get("sources", []),
            "retrieval_mode": result.get("retrieval_mode"),
            "document_status": result.get("document_status"),
            "request_id": result.get("request_id"),
            "detected_language": result.get("detected_language"),
        }


connector = RAGConnector()
