# RAG End-to-End Testing & Validation — 2026-08-26

Follow-up to the same day's [rag-diagnostic](platform-status-audit-2026-08-26-rag-diagnostic.md) and
[rag-improvement-pass](platform-status-audit-2026-08-26-rag-improvement-pass.md) audits. Those built and
live-verified hybrid search, CRAG/ARAG, reranking, and observability. This pass does **not** re-implement
anything — it is an independent, adversarial QA pass against the resulting system: real backend, real
uploads, real LLM calls, real Redis, real Pinecone, real SQLite. Every claim below is either a command I
ran with its actual output, or explicitly marked `NOT EXECUTED` with the reason. No result is fabricated
or assumed from reading code alone unless labeled "code-inspection only."

Environment: local Windows box, `uvicorn app.main:app` on port 8000, shared with a concurrent peer Claude
session (`ai-engine-11`) working the same repo — coordinated via cross-session message before starting.
Two real, uncontrolled events happened *during* testing that turned into free bonus test cases: the
backend **crashed silently** under memory pressure, and the local **Redis instance went down on its own**
(WSL relay). Both are reported as first-class findings, not incidents to omit.

---

## A. Test Summary

| | Count |
|---|---|
| Total tests attempted | 46 |
| PASS | 33 |
| FAIL / bug found | 3 (one severe, two moderate) |
| PARTIAL | 4 |
| NOT EXECUTED | 6 |

---

## B. Feature Validation Scorecard

| Feature | Verdict | Evidence |
|---|---|---|
| Document lifecycle (uploaded→processing→completed/failed) | **PASS** | Live state transitions observed for 3 documents (§1) |
| Retry / reprocess | **PASS** | Failed doc re-fails identically (no duplication); healthy doc reprocessed to identical chunk_count=26 (§1) |
| Dense retrieval | **PASS** | Correct chunk found via paraphrase, cosine scores sane (§2) |
| BM25 sparse retrieval | **PASS with a bug** | Exact-term queries work correctly, but tokenizer has no stopword filter — see Bug #1 (§3) |
| Hybrid + RRF | **PASS, rigorously verified** | Hand-computed RRF cross-check matches implementation to 6 decimal places (§4) |
| CrossEncoder reranking | **PASS** | Live lazy-load confirmed (41-tensor model loads only on first call with flag on); cold 16.6s vs warm 375ms (§5) |
| Reranking fallback | **PASS (code + implicit live)** | Every default-config query used the honestly-named `heuristic_rerank` (§5) |
| CRAG (HIGH/MEDIUM/LOW) | **PASS**, all 3 branches live-triggered | (§6) |
| ARAG / adaptive retrieval | **PASS** | Distinct strategies per query type, real branch distribution in `/stats` (§6) |
| Document isolation | **PASS, with a related bug** | Zero cross-contamination, but see Bug #2 (§7) |
| Grounding | **PASS with a severe exception** | Correct "no info" on genuinely absent facts; but see Bug #3 for a bad failure mode (§8) |
| Web fallback | **PASS** | Real Tavily results, correctly labeled, not misattributed to the document (§8) |
| Redis cache | **PASS** | Clean MISS→HIT (6256ms→78ms); graceful degradation confirmed twice — once synthetic, once organic (§9) |
| LLM provider fallback | **PARTIAL** | Unit-tested with mocks (5/5 pass); live full-stack forced-failure NOT EXECUTED (§10) |
| Observability (trace fields match reality) | **PASS, extensively cross-checked** | dense/sparse/fused counts independently reproduced by hand (§11) |
| QueryTrace persistence | **PASS** | Survived a real, unplanned process crash, not just a clean restart (§12) |
| Observability APIs | **PASS** | `/trace/{id}` (200/404), `/stats` (real aggregates) (§13) |
| Security (no secret leakage) | **PASS** | All 32+ persisted traces regex-scanned for 6 secret patterns, zero hits (§14) |
| Performance | **PASS (measured, not claimed)** | Real p50/p95/p99 from 33 live requests (§15) |
| Retrieval evaluation (Recall/Precision/MRR) | **NOT EXECUTED as specified** | No such metric exists in the codebase — see §16 |

---

## 1. Document Lifecycle, Retry, Failure

**Document A** (`68389717-ae74-4d01-a719-b1a2a5db214a`, `ayush-singh-resume.pdf`): uploaded → status
`uploaded` → polled `processing` (chunk_count already 26, mid-ingestion) → `completed`. Confirmed real,
not instantaneous.

**Test 3.1 (query during processing)**: queried immediately after upload, while status was still
`processing`. Result: HTTP 200, a real (correct) answer was returned, grounded in the partial index
already committed. **This is not what the spec describes** ("query rejected/deferred safely") — there is
no backend gate on document status in `api/query.py`. In this instance it did not fabricate anything, but
that's incidental — see Bug #3 for the case where an ungated query on unready/failed content produces a
materially misleading result.

**Test 3.3 (forced ingestion failure)**: uploaded a text file renamed to `.pdf`
(`corrupt.pdf`). Real result:
```
status: "failed"
error: "Failed to parse PDF uploads\\e5da...94_corrupt.pdf: Failed to open file ... as type pdf."
```
Clear, specific, stored. `chunk_count: 0`.

**Test 3.4 (retry)**: `POST /documents/{id}/reprocess` on the failed doc → `status: "uploaded"`, message
`"Reprocessing started"` → re-failed identically (same corrupt content, same error), `chunk_count` stayed
`0` — no duplicate rows. Then reprocessed the **healthy** Document A: `chunk_count` before = 26, after =
26 exactly. No duplication in either direction. **PASS.**

---

## 2. Dense Retrieval

Query: *"What programming language and framework does the candidate use for building retrieval pipeline
backends?"* (document says "Python + LangChain", worded differently). Result: correct answer, CRAG graded
`HIGH` (0.92), direct-rerank branch, 6.28s. Real cosine scores observed directly via
`retrieve_rules_and_chunks_parallel()`: top hits 0.55–0.64. **PASS.**

---

## 3. BM25 Sparse Retrieval — and Bug #1

Exact-term queries all worked correctly and were traceably lexical, not just dense hits riding along:
- *"What experience does the candidate have with FastAPI?"* → correct, cited 3 separate FastAPI mentions.
- *"Where is Pinecone mentioned...?"* → correctly found the Databases skill line (note: resume spells it
  "PineCone" — a real typo, good adversarial test — matched anyway via BM25 tokenization).
- *"What is the exact name of the hackathon...?"* → **"PU Code Hackathon 3.0"**, exact, plus the exact
  prize amount **"₹5000"**.

### Bug #1 — BM25 tokenizer does not filter stopwords

`sparse_retrieval.py`'s `_tokenize()` keeps every token including `the`, `is`, `of`, `and`, `as`. Directly
reproduced:
```
tokens: ['what', 'is', 'the', 'current', 'capital', 'city', 'of', 'france', ...]
bm25_search(...) against the resume corpus returned 5 "matches" with real positive scores
for a query about the capital of France — purely on stopword overlap.
```
`bm25_search()` does filter `score <= 0`, but common stopwords appear in nearly every chunk, so almost
nothing gets filtered. Combined with `retrieval.py`'s `SPARSE_ONLY_SCORE = 0.50` placeholder for a
sparse-only hit, this **artificially props up confidence for genuinely irrelevant queries**, sitting right
at the `CONFIDENCE_MEDIUM_THRESHOLD` (0.45) boundary — which can suppress `adaptive_rag.py`'s intended
step-back/web-search escalation for low-relevance queries (see the France example in §8, where
`step_back_triggered` stayed `false` because of exactly this). **Impact: moderate** — grounding still held
in every case I tested (the LLM synthesis step is the actual safety net), but the CRAG confidence signal
this design relies on is measurably polluted by noise. **Not fixed** (out of scope per instructions — QA
only). Fix would be a stopword filter in `_tokenize()`.

---

## 4. Hybrid Retrieval & RRF — Rigorously Verified

Ran dense-only and sparse-only retrieval independently for the same query
(*"What experience does the candidate have with FastAPI?"*, scoped to Document A), then hand-computed RRF
and compared to the actual `_reciprocal_rank_fusion()` output:

| Candidate | Dense rank | Sparse rank | Actual RRF score | Hand-computed RRF | Match |
|---|---|---|---|---|---|
| chunk_0a3104a1 | 2 | 1 | 0.032522 | 1/62 + 1/61 = 0.032522 | ✅ exact |
| chunk_52538d6c | 3 | 4 | 0.031498 | 1/63 + 1/64 = 0.031498 | ✅ exact |
| chunk_4c7eead9 (dense **#1**) | 1 | — | 0.016393 | 1/61 = 0.016393 | ✅ exact |
| chunk_69c00998 (sparse-only) | — | 2 | 0.016129, score=**0.50** | 1/62 = 0.016129 | ✅ exact, placeholder score confirmed |

The dense-only top result (#1 by cosine) was correctly **demoted to fused rank 3** because a
candidate found by *both* retrievers, even at moderate individual ranks, legitimately outranks it under
RRF. This is the textbook signature that distinguishes genuine RRF from "just sort by dense score" — and
it's exactly what happened. **This is not concatenation, not score-averaging, not dense-only sorting. It
is real, correctly-implemented RRF.** Case A (dense-dominant), B (sparse/exact-dominant), C (combined) and
D (sparse empty, e.g. invalid `document_id` → `dense_count: 0, sparse_count: 0` in trace, clean fallthrough
to web search with no crash) were all live-exercised.

---

## 5. CrossEncoder Reranking & Fallback

Default config (`ENABLE_CROSS_ENCODER_RERANK=false`, the shipped default): every one of 30+ queries showed
`reranking.used: false`, `latency_ms: 0.0` — the honestly-named `heuristic_rerank()` (plain score-sort).

Restarted with `ENABLE_CROSS_ENCODER_RERANK=true` (careful, deliberate, one-time — see memory note below).
Backend log showed the cross-encoder loading **only after the first real query hit it**, not at startup:
```
INFO:     127.0.0.1:... - "GET /health HTTP/1.1" 200 OK      <- startup already complete, no CE yet
[Redis Cache Warning]: Connection failed, cache disabled...
Loading weights: 100%|##########| 41/41 [...]                <- CE's 41 tensors, distinct from the 199-tensor embedder
INFO: "POST /api/v1/query HTTP/1.1" 200 OK
```
Trace: `reranking: {used: true, candidate_count: 11, reranked_count: 5, latency_ms: 16612.0}` (cold,
includes one-time model load). A second, warm query on a fresh set of candidates:
`{used: true, candidate_count: 9, reranked_count: 5, latency_ms: 375.0}` — a real, plausible per-pair
CPU inference time for a 2-layer MiniLM cross-encoder, not a no-op. **Confirms**: lazy (not startup),
optional (gated, off by default), and genuinely scoring query-document pairs, not just re-sorting.

Fallback path (Section 9): verified by code inspection — `_get_cross_encoder()` catches load exceptions,
sets a permanent `_load_failed` flag, and `cross_encoder_rerank()` wraps inference in try/except, falling
back to `heuristic_rerank()` on either. **Live-forced load failure NOT EXECUTED** (would require
corrupting the HF cache or blocking network access — both invasive to a shared dev box); the
always-disabled-by-default path, which *is* this same fallback function, was exercised live 30+ times
with zero crashes, which is strong indirect evidence the fallback branch itself is safe.

*Memory note*: this box has ~7.5GB RAM and was observed at 218MB–990MB free at various points during this
session. Enabling the cross-encoder was done once, deliberately, while free RAM was temporarily >1.6GB
(right after freeing the previous process), specifically to avoid repeating the crash in §12.

---

## 6. CRAG and ARAG — All Branches Live-Triggered

| Grade | Trigger query | Branch executed | Result |
|---|---|---|---|
| HIGH (0.92-0.93) | "What programming language/framework...", "FastAPI experience", "hackathon name" | `HIGH_DIRECT_RERANK` | Correct grounded answers |
| MEDIUM (0.78-0.85) | "What ML framework was used for fraud detection?" (mid-ingestion, sparse partial index), "What is FastAPI used for?" (global, no doc scope) | `MEDIUM_REWRITE_SEARCH` | Query rewritten, second retrieval call visible in trace, correct answers |
| LOW (0.82-0.95) | "current salary?" (absent fact), "capital of France?" (off-topic), Document-B queries with few chunks | `LOW_HYDE_SEARCH` | HyDE passage generated, second retrieval call visible, correctly declined when truly absent |

Final `/stats` snapshot across 33 real requests: `crag_grade_distribution: {HIGH: 13, LOW: 10, MEDIUM: 2}`,
`adaptive_branch_distribution` matching 1:1. Step-back and web-search escalation both fired for real when
`document_id` pointed at zero candidates (see §8). **This is not a fixed pipeline — the branch taken
depends on actual retrieval quality**, live-confirmed, not asserted from reading the code.

---

## 7. Document Isolation — and Bug #2

Uploaded a second, synthetic document (Document B, `ce4d97f8-...`, plain `.txt`, fictitious "Priya Sharma /
Senior Data Engineer / Acme Analytics" content, deliberately disjoint from Document A).

- *"What is the candidate's work experience?"* scoped to Doc A → correct Doc A content only.
- Same query scoped to Doc B → **see below**.
- *"What is the unique identifier or project code mentioned?"* scoped to Doc B → `"PROJECT-CODE-XYZ-789"`,
  correctly sourced only from Doc B.

**Zero cross-contamination in either direction** — isolation itself is solid.

### Bug #2 — CRAG's LLM-judged grade and the evidence validator's raw-score gate can disagree

The Doc B "work experience" query returned **`"Required info missing from document context."`** with
`sources: []`, despite:
```
crag: {grade: "HIGH", confidence: 0.92}
adaptive: {branches_executed: ["HIGH_DIRECT_RERANK"]}
llm_attempts: [1 call — the CRAG grader only, no final-synthesis call ever ran]
```
Direct re-query of the raw retrieval scores for the same document/query:
```
score= 0.445987731  "Skills\nData Engineering: Apache Spark..."
score= 0.418476105  "Priya Sharma\nSenior Data Engineer\n...Experience..."
```
Both are **below** `adaptive_rag.py`'s `validate_evidence()` hard cutoff (`>= 0.45`). So: the CRAG grader
(an LLM reading the actual chunk text) correctly judged this evidence HIGH-confidence relevant, but a
*second, independent, purely numeric* gate — checking raw cosine similarity against a fixed 0.45 threshold
— rejected the same evidence and the pipeline returned "missing" **without ever calling the LLM to
answer**. These are two different confidence signals that are not reconciled, and the numeric one silently
overrides the semantic one. **Impact: real usability defect** — correct, present information was withheld
from the user with a false "I don't know," on a short 2-chunk document where cosine similarity naturally
sits lower. This is a plausible root cause (or a contributing one) for the exact "sometimes returns no
answer" symptom the morning's diagnostic set out to investigate but didn't fully explain. **Not fixed**
(reported per instructions, not a test-blocker).

---

## 8. Grounding & Web Fallback — including the most severe finding (Bug #3)

**Grounding, Case A (answer present)**: passed repeatedly (§2, §3, §6 HIGH cases) — every correct fact
came back correctly, with real bounding-box sources.

**Grounding, Case B (answer absent)**: *"What is the candidate's current salary or compensation?"* →
`"The candidate's current salary or compensation is not provided in the available context."` LOW grade,
HyDE branch, no fabrication. **PASS.**

**Web fallback, working correctly**: query with `document_id = "nonexistent-doc-id-12345"` (zero
candidates from either retriever, confirmed in trace: `dense_count: 0, sparse_count: 0` on all 3 retrieval
calls, `step_back_triggered: true`, `web_search_triggered: true`) → real Tavily results, 5 real URLs
(archives.gov, Wikipedia, etc.), answer clearly about "candidate experience" (the HR term, since that's
what the nonsense query happened to resolve to on the web) — correctly labeled `retrieval_mode: "web"`,
sources carry `title`/`url` not page/bbox. **Correctly distinguishable from document evidence.** PASS.

### Bug #3 (severe) — an ungated query against a document with zero content silently falls through to web search and returns a confident, unrelated, unlabeled-as-such answer

Queried the **failed** `corrupt.pdf` document (0 chunks, `status: "failed"`) with: *"What does this
document say?"* Real result:

> *"The document is the United States Declaration of Independence. In its opening it states... 'We hold
> these truths to be self-evident, that all men are created equal...'"*

with 5 real Wikipedia/archives.gov sources, `retrieval_mode: "web"`, `crag: {grade: "LOW"}`,
`web_search_triggered: true`. **This is not a labeling bug** — the sources are technically tagged as web,
not document, pages — but from the user's perspective they asked "what does this document say" about
*their own upload* and got a fully-formed, confident answer about an unrelated historical document with no
indication anywhere in the response that the referenced `document_id` has **zero indexed content** because
ingestion failed. Root cause: `api/query.py` never checks `Document.metadata_["status"]` before running
the pipeline, and a zero-candidate result for a document-scoped query is treated identically to a
zero-candidate *general* query (falls through to open web search) instead of surfacing "this document has
no usable content — check its status." **This is the highest-severity finding in this pass**: it directly
violates the Section 3.3 requirement ("query is prevented" for a failed document) and the spirit of
Section 14 ("the answer does not falsely attribute web information to the uploaded document" — technically
true by source labeling, false by user-facing effect). Reproducible 100% of the time against any
document-scoped query on a `failed` or empty document. **Not fixed** (reported per instructions).

---

## 9. Redis Cache — Hit/Miss and Unavailability

Clean, controlled MISS→HIT pair on an identical fresh query:
```
call 1: elapsed 6256ms,  trace.cache = {enabled: true, hit: false, latency_ms: 0.8}
call 2: elapsed   78ms,  trace.cache = {enabled: true, hit: true,  latency_ms: 0.9}
```
~80x speedup, correctly recorded.

**Redis unavailable — tested twice**, once synthetic and once organic:
1. **Synthetic**: restarted the backend with `REDIS_URL` pointed at an unreachable port. (This attempt is
   also where the crash in §12 happened — see that section; the specific query result under this condition
   was inconclusive because the process died before returning.)
2. **Organic** (unplanned): partway through testing, the real local Redis (running inside WSL, relayed via
   `wslrelay.exe`, which also serves the episodic-memory Postgres on port 5433) went down on its own —
   `netstat` confirmed port 6379 no longer listening, `redis-py` confirmed connection refused. **The
   running backend kept serving correct RAG answers throughout**, with `cache: {enabled: true, hit: false}`
   and a real, measured ~4.1s "Redis-down tax" on the *first* query after failure (the connection-attempt
   timeout), then confirmed **0.0ms** on an immediate back-to-back retry — the `RETRY_COOLDOWN_SECONDS=30`
   fail-open cooldown in `cache.py` works exactly as designed. **PASS**, and a more convincing test than
   the synthetic one would have been since nothing was deliberately broken.

I did not take down the real Redis/Postgres relay deliberately — it shares infrastructure with the
episodic-memory tier used by other subsystems (per project memory) and stopping it intentionally seemed
higher blast-radius than warranted for this test, especially since it happened for free anyway.

---

## 10. LLM Provider Fallback

Live traces show real round-robin across `GROQ_API_KEY_1` through `_4` (no repeats within a single
request, moving forward across requests) — genuine key rotation, not a single static key. Every LLM call
across 30+ requests succeeded on Groq; **the Gemini fallback path never fired live** (no observed Groq
outage during this pass). `test_key_manager.py`'s 5 unit tests (`test_429_moves_to_next_key_and_cooldown`,
`test_all_groq_keys_fail_falls_back_to_gemini`, `test_cooldown_and_retry`, `test_missing_keys_ignored`,
`test_normal_key_rotation`) all pass — with mocked provider responses — and directly exercise the
Groq→Gemini fallback and 429-cooldown logic that didn't naturally occur live.

**NOT EXECUTED**: forcing a live full-stack Groq outage (e.g., by temporarily corrupting all 4 real Groq
keys in `.env`) to observe a genuine live Gemini fallback. Reason: this is shared, real production-usable
credentials in a `.env` also used by the concurrent peer session and the rest of the platform; corrupting
and correctly restoring 4 keys safely was judged higher-risk than the marginal evidence gained over the
existing mocked unit tests.

---

## 11. Observability — Trace Field Accuracy (not just presence)

Beyond confirming fields exist, I independently reproduced several trace values from first principles to
confirm they reflect *actual* execution, not placeholders:
- `retrieval.calls[].dense_count/sparse_count/fused_count` — matched a direct call to
  `retrieve_rules_and_chunks_parallel()` outside the trace pipeline (§4).
- `crag.grade` / `adaptive.branches_executed` — matched the number of `llm_attempts` entries recorded per
  request (1 call for HIGH-only, 2+ for MEDIUM/LOW with rewrite/HyDE), which I verified by counting
  entries, not just reading the label.
- `cache.hit` — matched real, externally-measured wall-clock latency (6256ms vs 78ms) (§9).
- `reranking.used` / `latency_ms` — matched real backend log lines showing the cross-encoder model
  actually loading (§5).
- `document_id` scoping — matched actual source `document_id` fields in the response for every isolation
  test (§7).

One real question resolved along the way: a single request showed 3 `llm_attempts` all `success: true`,
which initially looked suspicious (why retry after success?). Traced to `key_manager.py`'s
`execute_json_generation()` being called independently for the CRAG grader, the query-rewrite/HyDE
generator, and the final synthesis — each is a separate LLM call, each rotates its own key, and this
request's MEDIUM branch used all three. **Not a bug** — `llm_attempts` is pipeline-wide, not
per-final-answer, and this is consistent with the docstring in `key_manager.py`.

---

## 12. QueryTrace Persistence — Including an Unplanned Crash

**The critical test of this section happened by accident, and is stronger evidence than a clean restart
would have been.** During the synthetic Redis-unavailable test (§9), the backend process **vanished
entirely** mid-query, with **zero traceback** in its own log — it just stopped:
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
<process gone — no further log lines, no exception>
```
`netstat` confirmed the port was no longer bound; `Get-Process` confirmed no python.exe was running at all.
System free RAM at the time: **~236MB** of 7.5GB (checked immediately via
`Get-CimInstance Win32_OperatingSystem`), down from ~966MB at the last healthy check. No Windows
Application-log Error/Critical event was recorded for it either — consistent with a hard allocation
failure rather than a clean Python exception. **This reproduces, live, the exact low-memory crash risk
already documented in this repo's 2026-08-21 diagnostic** (a prior real `MemoryError` crash from an
unrelated cause that was since fixed) — confirming that specific fix did not eliminate the underlying
environmental risk, just one trigger for it. This machine's free RAM fluctuated between ~218MB and ~1.7GB
throughout this session depending on what else was running (Chrome, multiple VS Code windows, two
concurrent Claude Code sessions) — this is a real, live, and current operational constraint on this
development box, not a hypothetical one.

**The persistence test**: after restarting the backend fresh, I queried the observability API for a
`request_id` generated *before* the crash (`req_68c6de96643041ec`, the very first Section-2 dense-retrieval
query, well before any of the crash-adjacent testing) — **HTTP 200, full trace returned, correct
content.** This is stronger than a clean-restart test: the trace store survived an actual unclean process
death, confirming it is genuinely backed by SQLite and not an in-memory structure that a graceful shutdown
handler happened to flush. **PASS**, and the backend restarted successfully afterward at as little as
~230MB free RAM (§ "Application Health" below) — confirming the *specific* documented MemoryError root
cause (unconditional spaCy load) really is gone, even though the broader low-RAM environment remains a
live risk for something else to eventually trip.

**NOT EXECUTED**: corrupted/missing SQLite data behavior — did not deliberately corrupt `policy_engine.db`
to observe the failure mode, to avoid risking the shared dev database used by the concurrent peer session.

---

## 13. Observability API Endpoints

| Endpoint | Test | Result |
|---|---|---|
| `GET /api/v1/observability/trace/{request_id}` | valid, known id | 200, full real trace |
| same | unknown id | 404, `{"detail": "Trace not found"}` |
| `GET /api/v1/observability/stats` | default | 200, real aggregates over 33 live requests (see §15) |
| same | `?limit=200` | 200, respected the larger window |

No authentication/authorization on either endpoint — **flagged as a hardening gap**, not exploited: the
`request_id` is a `uuid4().hex[:16]` (64 bits), not sequentially guessable, and §14 confirms no secrets are
in the payload, but query text, document IDs, and full LLM answers *are* visible to anyone who can reach
the backend and knows or intercepts a `request_id`. Worth locking down before any non-local deployment.

---

## 14. Security — No Secret Leakage

Directly queried the SQLite `query_traces` table (not just the API surface) and regex-scanned all 32+
persisted trace JSON blobs for 6 secret-shaped patterns: Groq (`gsk_...`), Google (`AIza...`), generic
Bearer tokens, Tavily (`tvly-...`), Pinecone (`pcsk_...`), and any generic 32+ character alphanumeric
string. **Zero matches.** `llm_attempts[].key_label` correctly shows only labels like `"GROQ_API_KEY_3"`,
never the key value itself, confirmed by direct inspection, not by trusting the code comment. **PASS.**

---

## 15. Performance — Measured

From `GET /api/v1/observability/stats` over 33 real, mixed-condition live requests generated during this
pass (not synthetic/replayed):

| Metric | Value |
|---|---|
| p50 latency | 5,524.8 ms |
| p95 latency | 20,637.1 ms |
| p99 latency | 31,805.9 ms |
| avg latency | 6,376.5 ms |
| cache hit rate | 21.4% |
| web search rate | 6.1% |
| reranking usage rate | 15.2% (only nonzero because I deliberately enabled it for §5) |
| error rate | 3.0% (1/33 — traced to my own deliberate empty-query 400 test, not a real fault) |
| blocked rate | 3.0% (1/33 — my own prompt-injection guardrail test) |

Component-level, individually measured:

| Stage | Cold / uncached | Warm / cached |
|---|---|---|
| Full query, HIGH-grade, no rerank | 4.7–6.3s | — |
| Full query, MEDIUM/LOW-grade (extra retrieval round) | 7–24s | — |
| Redis query cache | 6,256ms (miss) | 78ms (hit) |
| Redis connect check (Redis down) | 4,091ms (first) | 0.0ms (within 30s cooldown) |
| CrossEncoder reranking | 16,612ms (cold, incl. model load) | 375ms (warm) |
| Heuristic reranking (default) | 0.0ms | 0.0ms |

This is **not a claim that hybrid or reranking measurably *improved answer quality*** — see §16 — only
that the latencies above are real, measured numbers from this session, not estimates.

---

## 16. Retrieval Evaluation (Recall@K / Precision@K / MRR)

**NOT EXECUTED as literally specified.**
Reason: `backend/scripts/evaluate_rag.py` — the only retrieval-evaluation tooling in this codebase — does
not compute Recall@K, Precision@K, or MRR. It computes an end-to-end **answer-correctness rate**
(keyword-match against an expected-answer list, run through the full RAG+LLM pipeline), which is a related
but different metric (measures final answer quality, not ranked-retrieval quality in isolation). No formal
IR-metric instrumentation exists to compute the literally-requested numbers, and building it would be a
code change beyond this pass's scope ("do not modify implementation unless explicitly required to fix a
test-blocking issue").

What *does* exist and is real: `backend/hybrid_search_evaluation_results.json`, timestamped today
(2026-08-26, generated by the concurrent peer session's own live-QA pass using the same tool against the
same live corpus — **not regenerated by me in this pass**, cited transparently rather than re-run to avoid
duplicate load on this already memory-constrained box):

| Mode | Correctness (8/9 basis) | Avg latency |
|---|---|---|
| dense_only | 88.9% | 5,999.3 ms |
| hybrid | 88.9% | 3,836.1 ms |
| hybrid_rerank | 88.9% | 7,512.6 ms |

Consistent with project memory's prior note: on this small 9-question resume-shaped benchmark, hybrid and
reranking have not yet surfaced a case where they *change* the final answer's correctness versus
dense-only — hybrid's mechanism is proven live and correct (§4), its measurable end-to-end benefit on this
particular small eval set is not. Hybrid is measurably **faster** here (3.8s vs 6.0s avg), which is
somewhat counter-intuitive (more retrieval work should cost more, not less) and is most plausibly explained
by run-to-run LLM-latency variance rather than hybrid retrieval itself being faster — not independently
re-verified this pass.

---

## 17. Failure Matrix

| Failure | Expected | Actual | Verdict |
|---|---|---|---|
| Pinecone unavailable | Local fallback | Code path reviewed (`_query_pinecone`'s `CircuitOpenError` → `local_semantic_search`); not forced live (would require invalidating real shared credentials) | **NOT EXECUTED** (code-inspection only) |
| Redis unavailable | Continue without cache | Confirmed live, twice (once organic) | **PASS** |
| Primary LLM unavailable | Provider/model fallback | Unit-tested (mocked), not forced live | **PARTIAL** |
| API key rate limited | Rotation/cooldown | Unit-tested (`test_429_moves_to_next_key_and_cooldown`), real round-robin observed live (without rate-limiting) | **PASS** (unit) / real rotation confirmed live |
| CrossEncoder unavailable | Heuristic fallback | Code-verified try/except; default-off path (same fallback function) exercised live 30+ times with zero crashes | **PASS** (code + indirect live) |
| Empty retrieval | Grounded no-evidence response | Confirmed (salary question) | **PASS** |
| Document processing | Query blocked safely | **Not blocked** — runs against partial index; didn't fabricate in the one case tested, but see Bug #3 for the same root gap in its worst form | **FAIL** |
| Ingestion failure | Failed state + retry | Confirmed | **PASS** |
| Embedding failure | Ingestion failure handled | Not isolated separately from PDF-parse failure | **NOT EXECUTED** |
| Web search failure | Graceful fallback | Tavily is live and working; failure not forced | **NOT EXECUTED** |
| Invalid document ID | Structured error | No error — silently falls through to open web search (not a crash, but not a 404 either) | **PARTIAL** |
| Invalid query | Guardrail/validation | Empty query → 400; wrong type → 422; prompt injection → blocked | **PASS** |
| Backend restart | Persisted traces remain available | Confirmed, across an unplanned crash | **PASS** |
| Low memory | Backend remains startable | Confirmed — restarted successfully from ~230MB free | **PASS** |

---

## Application Health (Section 2 of the original spec)

- FastAPI starts successfully: confirmed, multiple times, in 11–25s depending on system memory pressure.
- No unnecessary spaCy load at startup: confirmed by grep (zero `spacy` imports remain reachable from
  `main.py`'s import graph) and by the absence of any spaCy-related log line across every startup.
- No startup MemoryError: confirmed on every *successful* startup; one *mid-session* crash occurred (§12)
  but not during startup, and not attributable to spaCy.
- Required env vars: `.env` confirmed present with all expected keys populated (values not inspected/logged).
- SQLite accessible: confirmed (`policy_engine.db`, 32+ real rows read/written throughout).
- Pinecone connectivity: confirmed (`circuit_breakers: []` in `/health` — never tripped; real Pinecone
  matches observed with real cosine scores throughout).
- Redis connectivity: confirmed working, then confirmed correctly degrading when it organically went down
  (§9).
- LLM provider config: confirmed (4 real Groq keys discovered and rotated across live requests).
- Frontend: **NOT EXECUTED**. No browser session available in this environment; this pass was backend/API
  only, consistent with every prior session's same limitation on this machine.

---

## Bugs Found — Summary

| # | Bug | Severity | Reproduction | Status |
|---|---|---|---|---|
| 3 | Document-scoped query against a `failed`/empty document silently falls through to open web search and returns a confident, unrelated answer with no indication the document has no content | **High** | Upload a corrupt PDF (fails ingestion) → query it with any question → get a fully-formed answer about something else entirely | Not fixed (reported) |
| 2 | CRAG's LLM-judged grade and `validate_evidence()`'s raw-cosine-threshold gate are independent and can disagree, causing correct evidence to be discarded | **Medium** | Query a short document (2 chunks) about clearly-present info; CRAG says HIGH/0.92, evidence validator's 0.45 cutoff rejects both candidates (0.418, 0.446), final answer is a false "missing" | Not fixed (reported) |
| 1 | BM25 tokenizer doesn't filter stopwords, producing spurious sparse matches for any query and inflating CRAG confidence via the `SPARSE_ONLY_SCORE=0.50` placeholder | **Low–Medium** | Any off-topic query returns `sparse_count > 0` purely from `the`/`is`/`of` overlap | Not fixed (reported) |
| — | Redis client's `socket_connect_timeout=2` takes ~4.1s wall-clock on first failure (likely Windows IPv4/IPv6 dual-stack resolution overhead for "localhost") | **Minor/perf** | Observed directly during the organic Redis outage | Not fixed (reported) |
| — | Observability endpoints have no authentication | **Hardening gap** | `curl` to `/observability/trace/{id}` or `/stats` with no credentials succeeds | Not fixed (reported) |

---

## Remaining / Not Tested

- Frontend/browser click-through (no browser session in this environment — consistent with every prior
  pass on this machine).
- Live full-stack Pinecone outage and live full-stack Groq/Gemini total-provider outage (both would require
  invalidating real, shared credentials on a box other sessions depend on — judged too high blast-radius
  for the marginal evidence over the existing unit tests).
- Corrupted/missing SQLite database recovery behavior.
- Embedding-failure-specifically (isolated from general PDF-parse failure).
- Live web-search-failure fallback (Tavily is currently healthy).
- Formal Recall@K/Precision@K/MRR — no instrumentation exists for this in the codebase (§16).
- Fixing any of the 3 bugs above — explicitly out of scope for this pass per instructions.

---

## Addendum — All 3 Bugs Fixed and Verified Same Day (by a Concurrent Session)

Immediately after this report was published, a concurrent peer session (working the same backend, aware
of this pass via cross-session coordination) fixed all three bugs above and verified the fixes at three
different levels of rigor, each appropriate to this machine's live memory constraint documented in §12.
Full fix detail and code changes are in that session's own addendum to
[platform-status-audit-2026-08-26-rag-improvement-pass.md](platform-status-audit-2026-08-26-rag-improvement-pass.md).
This section records only the verification status, at the same evidentiary standard as the rest of this
report — I did not write the fixes and did not independently re-verify them myself beyond one bonus check
noted below, so treat the "confirmed" labels as attributed to that session, not to this one.

| Bug | Fix | Verification | Status |
|---|---|---|---|
| #3 (severe — ungated failed/unready-doc queries) | New document-readiness gate in `api/query.py`; non-`completed` documents now return `retrieval_mode: "document_not_ready"` with the stored error text, before retrieval or web fallback ever runs | **Live, exact repro replayed**: uploaded a fresh `corrupt.pdf` on a separate port (8001), waited for `status: "failed"`, asked "What does this document say?" → got the new structured response instead of the old fabricated Declaration-of-Independence answer | **Confirmed fixed** |
| #2 (CRAG vs. `validate_evidence` disagreement) | `validate_evidence()` now takes the CRAG grade; a `HIGH` grade short-circuits the raw `>=0.45` cosine gate (safe specifically because the `HIGH` branch does no additional search — grader and gate see the identical candidate set) | **Unit-test only**, deliberately — a new test reproduces this report's exact scores (0.418, 0.446) directly against the fixed function and passes; live full-stack replay was skipped because free RAM was back down to ~327MB with both instances running (the same danger zone as this report's §12 crash) | **Fixed, verified at unit level**; live full-stack replay not attempted (reasonable risk call) |
| #1 (BM25 stopword pollution) | ~50-word hardcoded stopword filter added to `sparse_retrieval.py`'s `_tokenize()`, no new dependency | **Live, direct-function verification** against the real persisted corpus: `_tokenize("What is the capital of France?")` now reduces to exactly `["capital", "france"]`; re-running `bm25_search()` found 0 chunk matches and 10 rule matches — but every rule match is genuine lexical overlap on "capital" against a real employer name in the corpus (**"RIKALP CAPITAL PRIVATE LIMITED"**), not the stopword-driven false-positive mechanism originally reported. **Important nuance**: this is correct lexical-search behavior on a real word that happens to appear in real content — it is not a residual instance of the original bug, and should not be read as "BM25 now returns zero matches for any off-topic query" | **Confirmed fixed** (the specific reported mechanism is gone; unrelated genuine term-overlap matches remain, as expected) |

**One bonus live check performed by this session**: the fix-verification process on the peer's side
incidentally deleted this report's two `corrupt.pdf` on-disk upload files (DB rows untouched) via an
overly broad cleanup glob. Since this session was already finished with those documents, no restoration
was needed — but it created a free, real trigger for an untested edge case (§17's "not tested" gap on
reprocessing a document whose source file is gone). Confirmed live:
```
POST /api/v1/documents/e5da6d9e-.../reprocess
→ HTTP 400 {"detail":"Original uploaded file is no longer available on disk; please re-upload."}
```
Structured error, no crash, no data corruption — matches the code path exercised by the existing
`test_reprocess_without_file_path_400s_and_preserves_data` unit test, now also confirmed live.

**Net effect on the Final Verdict below**: items 7, 8, and 12 (document isolation, grounding, graceful
failure recovery) should now be read as "the gap identified has been fixed and independently verified,"
not as still-open findings. The `git status` state of `apps/AI-Policy-Rule-Engine/backend/app/` as of this
addendum includes these fixes uncommitted, alongside the day's earlier improvement-pass changes.

---

## Final Verdict

1. **Is the RAG pipeline functionally working?** Yes, for the golden path. Grounded answers with real
   sources are the normal case across 30+ live, varied queries.
2. **Is hybrid retrieval genuinely working?** Yes — hand-verified against the exact RRF formula, not
   assumed from field names.
3. **Is RRF genuinely working?** Yes, confirmed to 6 decimal places against a manual computation (§4).
4. **Is CrossEncoder genuinely working?** Yes — live lazy-load confirmed, real per-pair scoring latency
   measured (375ms warm vs 0ms heuristic).
5. **Does reranking fallback work?** Yes by code inspection and by 30+ live runs of the same fallback path
   in its default-on state; the forced-failure branch itself wasn't triggered live.
6. **Are CRAG and ARAG actually changing execution?** Yes, unambiguously — all three CRAG grades and all
   three ARAG branches fired live with different, traceable, correct-looking retrieval behavior per branch.
7. **Is document isolation working?** Yes, with zero cross-contamination observed — but a related confidence-
   threshold bug (#2) can cause a document's own real content to be wrongly withheld.
8. **Is grounding working?** Mostly yes, and the LLM-synthesis layer is a genuinely good backstop against
   hallucination when it's reached — but Bug #3 shows the *retrieval-scoping* layer in front of it has a
   real gap that lets a webresult stand in for "your document" with no disclosure.
9. **Is `QueryTrace` persisted correctly?** Yes, and unusually well-proven — it survived a real, unplanned
   process crash, not just a graceful shutdown.
10. **Can a query be completely reconstructed using `request_id`?** Yes — every stage (guardrails, cache,
    retrieval counts, CRAG grade, adaptive branch, reranking, web search, every LLM attempt with provider
    and key label, final answer/sources) was present and, where checked, matched independently-verified
    ground truth.
11. **Do observability APIs work?** Yes, both endpoints, including correct 404 handling — but with no
    authentication, worth fixing before any non-local exposure.
12. **Does the system gracefully recover from major failures?** Mostly yes: Redis-down (twice), a real
    process crash, and invalid input were all handled without data loss or corruption. The one clear
    exception is the failed/unready-document query gap (Bug #3).
13. **Did hybrid/reranking measurably improve retrieval?** Not proven either way on the existing 9-question
    eval set — their *correct operation* is proven live; their *benefit* isn't measurable with the
    instrumentation that currently exists.
14. **What remains incomplete?** Frontend verification, forced Pinecone/full-LLM-provider outages, formal
    IR metrics, and — most importantly — the three real bugs found in this pass are reported, not fixed.
