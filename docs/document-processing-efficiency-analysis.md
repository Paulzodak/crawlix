# Document Processing & Analysis – Efficiency Analysis

## Current Pipeline (High Level)

1. **Controller** – Validates input, resolves jobId/owner, calls `processText(..., options, jobId, jobOwner)` **without awaiting** (fire-and-forget).
2. **processText** (document.service):
   - Progress 0% → 5%: **analyzeLegalDocument(text)** – 1× gpt-4o-mini (first 3000 chars).
   - If not legal → early return.
   - **getDocumentNameFromOpenAI(text)** – 1× gpt-4o-mini (first 3000 chars).
   - Progress 10% → 30%: **chunkTextAccurately(text, 10000, "context")** – 1+ gpt-4o-mini calls (chunking via LLM).
   - Progress 30% → 60%: **Promise.all(chunks.map(chunk => AnalyzeChunk(chunk, text)))** – N× gpt-4o in parallel (one per chunk).
   - Inside each **AnalyzeChunk**: for every highlight, **findTextPositions(highlight.text, fullPrompt)** over the **entire document**.
   - Progress 60% → 100%, then save to Postgres (and progress/result to Redis).

So: **2 small LLM calls at start + 1+ chunking calls + N analysis calls**, with full-doc search per highlight and heavy Redis payloads.

---

## Inefficiencies (by importance / effectiveness)

### 1. **Critical – Unbounded parallel chunk analysis (rate limits + cost spikes)**

- **Where:** `document.service.ts`: `Promise.all(chunkResults.map((chunk) => AnalyzeChunk(chunk, text)))`.
- **Issue:** Every chunk triggers a gpt-4o request at the same time. Many chunks ⇒ many concurrent requests ⇒ 429s and high cost spikes.
- **Change:** Limit concurrency (e.g. `p-limit` with concurrency 3–5) or a small queue so you never fire more than a few analyses at once.
- **Impact:** Prevents rate-limit failures and smooths cost; high impact.

---

### 2. **Critical – Duplicate LLM work at start (legal + title)**

- **Where:** Right after “Analyzing”, you call:
  - `analyzeLegalDocument(text)` (first 3000 chars)
  - `getDocumentNameFromOpenAI(text)` (first 3000 chars)
- **Issue:** Two separate gpt-4o-mini calls on the same prefix. Same input, two round-trips.
- **Change:** Single prompt that returns both: `{ isLegalDocument, confidence, suggestedTitle }`. One call, same behavior.
- **Impact:** Cuts 1 LLM call per job; high impact.

---

### 3. **High – Chunk options ignored**

- **Where:** `document.service.ts`: you compute `chunkSize` and `maxTokens` from `options`/config but call  
  `chunkTextAccurately(text, 10000, "context")` with a **hardcoded** `10000`.
- **Issue:** User/client `chunkSize` and `config.summarization.defaultChunkSize` have no effect; chunk size is always 10000 (chars/tokens).
- **Change:** Pass the computed `maxTokens` (and, if you expose it, split mode) into `chunkTextAccurately`, e.g.  
  `chunkTextAccurately(text, maxTokens, "context")` with `maxTokens = Math.floor((options?.chunkSize ?? config.summarization.defaultChunkSize) / 4)`.
- **Impact:** Config and API actually control chunking; high impact for correctness and tuning.

---

### 4. **High – Full document stored in Redis on every progress update**

- **Where:** `updateProgress(..., text, ...)` and progress type includes `inputText`; Redis progress stores full `inputText` and later full `summarizationResult`.
- **Issue:** Large documents get written to Redis multiple times (every progress update). Wastes memory and network; can hit Redis limits.
- **Change:** Don’t store full `inputText` (and optionally not full result) in Redis. Keep only status, percentage, message, maybe `documentName`; store full text and result only in Postgres when done (or in object storage and store a key).
- **Impact:** Big savings for large docs; high impact.

---

### 5. **High – findTextPositions over full document for every highlight**

- **Where:** `summarization.service.ts` in `AnalyzeChunk`:  
  `findTextPositions(highlight.text, fullPrompt)` with `fullPrompt` = full document.
- **Issue:** Each highlight does a search over the entire document. With many highlights and long docs, this is O(highlights × doc_length) and unnecessary.
- **Change:** Highlights come from a chunk; the chunk already has `chunk.text` and `chunk.start`. Search in `chunk.text` only:  
  `findTextPositions(highlight.text, chunk.text)` then add `chunk.start` to both `start` and `end` to get document positions.
- **Impact:** Much faster and more predictable; high impact for long documents.

---

### 6. **Medium – Chunking always uses LLM**

- **Where:** `chunkTextAccurately` always uses `chunkTextWithOpenAI` (gpt-4o-mini) except on parse failure, when it falls back to `fallbackSentenceSplit`.
- **Issue:** Every job pays for LLM-based chunking. For many docs, sentence/paragraph-based splitting is good enough and is already implemented in `fallbackSentenceSplit`.
- **Change:** Add an option (e.g. `splitMode: "context" | "sentence"` and a “no-LLM” path): use `fallbackSentenceSplit` (or a similar local split) when “sentence” or “fast” is chosen; use LLM only for “context” or when you need semantic boundaries.
- **Impact:** Saves latency and cost for a large fraction of jobs; medium impact.

---

### 7. **Medium – No idempotency / duplicate job handling**

- **Where:** Controller calls `processText` with optional `jobId`; no check if that `jobId` is already in progress or completed.
- **Issue:** Retries or duplicate requests can run the same job twice and create duplicate DB rows and duplicate OpenAI usage.
- **Change:** Before starting, check Redis/DB for `jobId`: if status is “completed” or “in progress”, return existing progress or 202 without starting again.
- **Impact:** Prevents duplicate work and duplicate records; medium impact.

---

### 8. **Medium – Heavy logging in hot path**

- **Where:** `updateProgress` logs `text`, `summarizationResult`, `documentName`; `AnalyzeChunk` logs full `highlights`.
- **Issue:** Large payloads and many highlights can slow logs and leak PII/sensitive content.
- **Change:** Log only IDs, lengths, and counts (e.g. `text.length`, `highlights.length`); remove or guard full dumps behind a debug level.
- **Impact:** Safer and slightly faster; medium impact.

---

### 9. **Lower – Legal check could be cheaper for obvious cases**

- **Where:** `analyzeLegalDocument` always calls gpt-4o-mini.
- **Issue:** Obvious legal docs (e.g. “Agreement”, “Terms”, “Liability”) or obvious non-legal could be filtered with a cheap heuristic first.
- **Change:** Simple keyword/heuristic (or tiny local classifier) on first N characters; call LLM only when heuristic is uncertain.
- **Impact:** Fewer LLM calls for clear-cut cases; lower but useful impact.

---

### 10. **Lower – Full result in Redis when complete**

- **Where:** Final progress update stores full `summarizationResult` (and possibly `inputText`) in Redis.
- **Issue:** Redis holds a full copy of the result; clients could instead fetch the canonical copy from Postgres.
- **Change:** In Redis, store only “completed” + `jobId` (and maybe document name); have clients load the full document/result from Postgres by `jobId`.
- **Impact:** Smaller Redis footprint and single source of truth; lower but clean.

---

## Summary table

| Priority | Issue | Fix | Impact |
|----------|--------|-----|--------|
| 1 | Unbounded parallel `AnalyzeChunk` | Limit concurrency (e.g. p-limit 3–5) | Critical (rate limits, cost) |
| 2 | Two LLM calls for legal + title | One combined prompt | Critical (cost, latency) |
| 3 | Chunk size from options ignored | Pass `maxTokens` into `chunkTextAccurately` | High (correctness, tuning) |
| 4 | Full text in Redis on every update | Don’t store full text/result in Redis | High (memory, limits) |
| 5 | findTextPositions over full doc | Search in chunk, then add `chunk.start` | High (CPU, scalability) |
| 6 | Chunking always uses LLM | Optional local sentence/paragraph split | Medium (cost, latency) |
| 7 | No duplicate-job check | Check jobId in Redis/DB before starting | Medium (duplicates, cost) |
| 8 | Logging large payloads | Log only metadata / debug level | Medium (safety, perf) |
| 9 | Legal check always LLM | Heuristic first, LLM when uncertain | Lower (cost) |
| 10 | Full result in Redis when done | Store only “completed” + jobId; fetch from Postgres | Lower (memory, clarity) |
