# RAG Diagnostic Report — 2026-08-26

Diagnostic-only pass (no code changes) requested to answer three questions:
(1) why does a resume upload + question sometimes come back with no answer,
and is the `/rag` endpoint connection actually the problem; (2) are CRAG and
ARAG (Adaptive-Corrective RAG) actually working, and how hard would it be to
expose the whole RAG pipeline as an agentic tool call; (3) is hybrid search
implemented. Findings below are either confirmed by reading the exact code
paths, or backed by real artifacts already sitting in the repo (see "Method"
below) — nothing is inferred from symptoms alone without a code citation.

## Method

A live re-run was deliberately **not** attempted this session. This machine
had ~600MB of RAM free out of 7.3GB total at check time, and
`backend/__backend.log` (dated 2026-08-15) already records this exact
backend dying with a `MemoryError` at import time under similar memory
pressure (see Finding B). Forcing another live start today risked
reproducing that crash, so — per your choice when asked — this report is
built from (a) close reading of every file in the `/rag` request path, and
(b) two real end-to-end benchmark runs already recorded in the repo:
`backend/baseline_benchmark_results.json` (2026-08-24, 00:58) and
`backend/adaptive_benchmark_results.json` (2026-08-24, 01:02) — both run
against your actual resume with the same 6 real questions, comparing the
legacy dual-tier reasoning path against the CRAG/ARAG path.

---

## 1. `/rag` end-to-end status

### What's actually working (verified)

- **The CRAG/ARAG pipeline produces real, grounded answers when it runs.**
  The 2026-08-24 benchmark asked 6 real questions against your resume.
  Example: *"What AI systems did Ayush build at OpenEyes and what accuracy
  improvement was achieved?"* → graded `HIGH` confidence 0.92, branch
  `HIGH_DIRECT_RERANK`, answered correctly and specifically (RAG pipelines,
  OCR/PAN fraud checks, 33% ground-truth accuracy improvement) with
  `retrieval_mode: "rules"`. A deliberately out-of-scope question
  ("Microsoft Azure Cognitive Services") correctly graded `LOW`, escalated
  through `LOW_HYDE_SEARCH`, and returned an honest "the provided context
  does not contain any information about..." instead of hallucinating. This
  is real, working retrieval + adaptive reasoning, not a stub.
- **Resilience is real.** Pinecone reads/writes go through a circuit
  breaker + retry (`services/resilience.py`); on an open breaker,
  `retrieval.py::_query_pinecone` (line 80) falls through to
  `local_fallback_retrieval.py`'s in-process cosine search over SQLite
  instead of silently returning nothing. LLM calls round-robin across 4 Groq
  keys and 3 Gemini keys (`key_manager.py`) with automatic 429 cooldown and
  Groq→Gemini fallback. Redis caching fails open if Redis is down
  (`cache.py::get_redis_client`, 30s retry cooldown) — never blocks a query.
- **Guardrails and endpoint wiring are fine** — checked and ruled out as a
  cause (see below).

### Root causes of "upload a resume, ask a question, get nothing"

**A. Race condition: the UI marks a document "completed" before ingestion
has actually run.** `rag/page.tsx:797-802` sets the newly uploaded
document's local status to `"completed"` as soon as the `POST /api/v1/upload`
HTTP call returns — but that response only means "file saved, queued"
(`upload.py:57-61` literally returns `"status": "processing"`). Real
ingestion — PDF parse → chunk → embed → Pinecone upsert → LLM rule
extraction — runs in a background thread
(`_ingestion_executor.submit(process_document_task, ...)`, `upload.py:55`)
and, per the lifespan startup comment in `main.py:15-24`, a cold embedding
model alone can take ~17s, before chunking/embedding/rule-extraction even
starts. There *is* a real completion signal — `rag/page.tsx:753-761` polls
`GET /api/v1/rules` every 2.5s and reads the backend's actual
`Document.metadata_.status` (`rules.py:19`) — but nothing gates the chat
input or `submitQuery()` (`rag/page.tsx:979`, send button disabled logic at
line 1682) on that real status. So a question asked seconds after upload can
easily hit an empty corpus: retrieval returns nothing, CRAG grades it `LOW`
on zero candidates, and `adaptive_rag.py:392-399` correctly (but
unhelpfully) returns `"Required info missing from document context."` This
is the single most likely explanation for "give it a resume and a question,
get no answer" — it isn't that CRAG/ARAG don't work, it's that they're
being asked before there's anything to retrieve.

**B. This backend has a real, reproducible startup crash mode on this
machine.** `services/detection.py:7` runs `spacy.load("en_core_web_sm")`
unconditionally at module import time. `backend/__backend.log` (2026-08-15)
shows this exact call failing with a `MemoryError` inside `srsly`'s JSON
reader — a classic Windows "paging file too small" failure — which took the
whole FastAPI app down before it could bind to a port (the traceback runs
`main.py → api/query.py → services/retrieval.py → services/detection.py`,
i.e. importing the query router is what drags spaCy in). This machine's
live free memory just now (2026-08-26) was ~600MB/7.3GB — tight enough that
the same failure is plausible today, not just a historical artifact. If the
backend fails to import, `/rag` is unreachable, which from the frontend
looks exactly like "no answer" (or the "having trouble reaching the
knowledge engine" error state added in the 2026-08-22 pass).

**C. That spaCy load is dead weight.** The only function that uses `nlp`
(`detect_candidate()` in `detection.py:47-95`) has zero callers anywhere in
`app/` (confirmed by grep across the backend) — `extraction.py`'s actual
rule-extraction path uses an LLM prompt, not `detect_candidate`. So the app
pays the full memory cost and crash risk from Finding B for a code path
nothing currently calls.

**D. Model-name churn re-introduced a known-dead model as first choice.**
Commit `c766bc8` (2026-08-24, 21:30 — **after** the benchmark runs above)
reverted `llm_service.py`'s primary Groq model back to
`llama-3.3-70b-versatile` and primary Gemini model back to
`gemini-2.0-flash` — the exact two IDs the 2026-08-21 audit had confirmed
were retired (404 `model_not_found`) and replaced with `openai/gpt-oss-120b`
/ `gemini-3.6-flash`. It's not fatal today only because the same commit also
added a per-call fallback cascade (Groq tries `llama-3.1-8b-instant` then
`mixtral-8x7b-32768` next; Gemini tries `gemini-1.5-flash` then
`gemini-2.5-flash` next) — so a live call should still eventually succeed,
but every CRAG grade / query rewrite / HyDE / step-back / final-synthesis
call now eats one-to-two guaranteed failed attempts first. Two things worth
noting: this reconciliation happened **after** the benchmark that proves
CRAG/ARAG works, so that proof reflects the pre-revert model list, not
today's; and `fraud_llm.py` / `screening_llm_service.py` got the identical
revert in the same commit, so this isn't RAG-specific.

**E. Not a bug, but explains some "rules" gaps on resumes**:
`extraction.py`'s rule-extraction prompt is policy-document-shaped
(actor/action/condition, OBLIGATION/PROHIBITION/PERMISSION/GUIDELINE) — a
resume won't yield many "rules" in that sense. This degrades gracefully,
though: raw chunks are always indexed regardless
(`canonicalization.py::store_chunks_batch_in_pinecone`), and the benchmark
above shows both `retrieval_mode: "rules"` and `retrieval_mode: "chunks"`
answers coming back correctly for real resume questions — so this isn't the
blocker.

### "Endpoint connection isn't strong" — checked, ruled out

Every product page (`rag/page.tsx`, `hiring-automation/page.tsx`,
`upload/page.tsx`, `AIAssistantWidget.tsx`, etc.) uses the identical pattern
`` `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/v1/...` ``.
`frontend/.env.local` sets `NEXT_PUBLIC_API_URL=http://localhost:8000` (no
`/api/v1` suffix), which is exactly what that pattern expects — the root
`.env`'s comment showing a `/api/v1` suffix is just a stale comment and
doesn't affect the actual frontend build. CORS is wide open in local dev
(`main.py:79-85`, `allow_origins=["*"]`). The endpoint wiring itself is
correct; what actually produces "can't reach it" symptoms is Findings A and
B above — a slow/incomplete backend response, or the backend not running at
all, reads identically to a broken connection from the browser's side.

*Also checked and fine*: `.env`'s numbered key vars
(`GROQ_API_KEY1..4`, `GOOGLE_API_KEY1..3`) don't match `config.py`'s
singular `Settings` field names, but `key_manager.py:78-142` reads
`os.getenv()` directly for the numbered pattern independent of `Settings`,
so this isn't a gap — just worth knowing `Settings.GROQ_API_KEY` /
`GEMINI_API_KEY` themselves are empty by design and only `key_manager` sees
the real keys.

*Side note, not a bug*: `worker.py`'s ingestion functions are decorated
`@celery_app.task`, but `upload.py:55` calls `process_document_task` as a
plain in-process function via `ThreadPoolExecutor.submit()`, never
`.delay()`. Celery/Redis-as-broker is fully configured but never actually
used as a distributed queue for ingestion — worth knowing if you ever plan
to scale ingestion across processes/machines, since right now it's
single-process-only regardless of the Celery scaffolding.

---

## 2. CRAG / ARAG capability check + RAG-as-a-tool

### CRAG (Corrective RAG) — implemented, verified working

`adaptive_rag.py::fast_crag_grader` (line 106) grades retrieved evidence
`HIGH`/`MEDIUM`/`LOW` via an LLM call, with a heuristic score-threshold
fallback (lines 154-160) if that call fails — so grading degrades instead of
breaking. Branching on the grade is real: `MEDIUM` triggers a query rewrite
+ re-search (line 338-341), `LOW` triggers HyDE synthetic-passage generation
+ re-search (343-349), a step-back broaden-and-retry escalates if evidence
is still weak (351-361), and a live Tavily web search corrects for a
still-empty corpus (363-381). All of this was observed actually firing
correctly per-question in the 2026-08-24 benchmark (see `adaptive_trace` in
`adaptive_benchmark_results.json`: `HIGH_DIRECT_RERANK`,
`MEDIUM_REWRITE_SEARCH`, and `LOW_HYDE_SEARCH` all appear across the 6
questions, matching what each question actually needed).

One naming caveat: `cross_encoder_rerank()` (line 269-278) is a plain
sort-by-existing-vector-score — it is **not** an actual cross-encoder model
re-scoring query/passage pairs, despite the pipeline docstring advertising
"Cross-Encoder Fusion." It's cheap and it works, but it can't out-rank
anything the initial retrieval `top_k` didn't already surface, and the name
overstates the capability if you're describing this system externally.

### ARAG (Adaptive RAG / query routing) — implemented, verified working

`execute_adaptive_rag_pipeline` (line 295) genuinely changes strategy per
query rather than always running the same fixed sequence, and falls back to
the legacy dual-tier reasoning (`reasoning.py::generate_legacy_answer`) if
the adaptive path throws (`reasoning.py:33-43`) — so a bug in the adaptive
layer degrades to the older, simpler path instead of losing the response
entirely. The multilingual layer (detect → translate → retrieve in English
→ translate answer back, `query.py:45-79`) and Redis query caching sit
cleanly on top and don't interact with the failure modes above.

### Turning RAG into an agentic tool — assessment, not built

You already have the right pattern elsewhere in this codebase:
`app/mcp/base.py::BaseMCPConnector` — a `ToolDefinition` (name + description
+ JSON-schema input), `_add_tool()` registration, and a `call_tool()`
dispatcher that handles config-checking, logging, and error normalization —
proven across 12 real MCP connectors already. A `rag` tool should follow
that exact shape rather than inventing a new one.

The natural boundary to wrap is not `execute_adaptive_rag_pipeline`
directly (it only reasons over candidates handed to it) — it's the same
sequence `api/query.py::process_query` already runs end to end: input
guardrail → `retrieve_rules_and_chunks_parallel` →
`generate_answer_with_fallback` → output guardrail. Input schema would be
`{query: string, document_id?: string, top_k?: int}`; output is already
`{answer, sources, retrieval_mode, adaptive_trace}` — no reshaping needed,
since that's exactly what `/query` returns today.

Two design decisions worth making deliberately before building it (not
blockers, just things that change agentic behavior versus chat behavior):

1. The input/output guardrails (`guardrails.py`) are tuned for a human chat
   turn — fine to reuse as-is for a tool an agent calls on a user's behalf,
   but worth a conscious yes rather than an accident.
2. The pipeline can silently escalate to a live Tavily web search when
   nothing in the document corpus matches (`reasoning.py` Tier 3,
   `adaptive_rag.py` step 5). `retrieval_mode` already surfaces this in the
   response, so an orchestrating agent *can* branch on "did this leave the
   document corpus" — but only if whatever calls this tool actually checks
   that field, since today nothing enforces it.

No structural blocker found. This is a wrapping exercise — one new
`app/mcp`-shaped connector file calling the existing pipeline function
in-process — not a redesign.

---

## 3. Hybrid search — not implemented (dense-only)

Every retrieval path, both primary (`retrieval.py` → Pinecone) and degraded
(`local_fallback_retrieval.py` → in-memory cosine search), is pure
dense-vector cosine similarity over one embedding model
(`BAAI/bge-base-en-v1.5`, loaded in `detection.py::get_embedding_model`).
There is no BM25, no sparse vector index, no keyword index, and no score
fusion anywhere in the backend — confirmed by grep across `app/` for
BM25/hybrid/sparse-vector/rank-fusion patterns.

The word "hybrid" does appear twice in the code, but means something
narrower than dense+sparse fusion, worth not confusing with real hybrid
search:

- `adaptive_rag.py`'s pipeline docstring calls step 1 "Hybrid Candidate
  Aggregation" — this just merges two separate **dense**-vector partitions
  (Pinecone metadata `vector_type: "rule"` vs `"chunk"`,
  `canonicalization.py:69,137`) into one candidate pool. Still all cosine
  similarity, same embedding model.
- `detection.py::detect_candidate` (line 47) calls itself a "Hybrid
  candidate detection" combining keyword rules + spaCy dependency parsing +
  embedding similarity — but that's for scoring candidate rule *sentences*
  during ingestion, not query-time retrieval, and per Finding C above,
  nothing currently calls it.

Net: if "hybrid search" means combining a sparse/keyword signal (BM25,
SPLADE, or Pinecone's own sparse-dense hybrid index type) with dense
embeddings to catch exact-term/acronym/ID matches embeddings tend to miss,
that does not exist in this codebase today. It would be a genuinely new
capability, not a matter of wiring up something that's already there.

---

## Summary table

| Question | Status |
|---|---|
| Is `/rag`'s endpoint wiring broken? | No — checked, correct on both sides |
| Is CRAG implemented and working? | Yes, verified via real benchmark run |
| Is ARAG implemented and working? | Yes, verified via real benchmark run |
| Why does resume+question sometimes return nothing? | Race condition (UI says "completed" before ingestion finishes) is the most likely everyday cause; a real OOM startup crash is a second, machine-specific cause |
| Is hybrid (dense+sparse) search implemented? | No |
| Can RAG become an agentic tool? | Yes, no structural blocker — wrap `process_query`'s pipeline using the existing `BaseMCPConnector` pattern |

## If/when you want fixes (not done, just a suggested order)

1. Gate the chat input (or at least show a blocking "still indexing…"
   state) on the real `docStatus`/`documents[].status`, not on the
   `/upload` HTTP response — closes the race condition in Finding A.
2. Decide whether `detect_candidate`/spaCy stays. If it's staying unused,
   dropping the top-level `spacy.load()` removes a real, already-observed
   crash mode for zero feature loss (Findings B+C).
3. Reconcile the Groq/Gemini model lists across `llm_service.py`,
   `fraud_llm.py`, and `screening_llm_service.py` against models you've
   actually confirmed live today, rather than relying on the fallback
   cascade to mask dead first choices (Finding D).
4. Build the `rag` MCP-style tool connector per the assessment in section 2,
   once you're ready to wire it into agentic orchestration.
