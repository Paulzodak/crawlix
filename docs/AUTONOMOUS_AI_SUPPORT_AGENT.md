# Autonomous AI Support Agent — Implementation Plan

**Product:** Qlarety (Document Intelligence)  
**Document type:** Staged technical + product implementation plan  
**Communication protocol:** Socket.IO (real-time)  
**Audience:** Engineering, product, support operations  

---

## 1. Goal

Build a **fully autonomous AI support agent** that:

1. Understands **product context** (features, auth, documents, sharing, billing later).
2. Talks to users in **real time over Socket.IO**.
3. On every turn, **decides** one primary outcome:
   - **Answer** — resolve with a grounded reply.
   - **Escalate** — notify product/support by **email** (ticket + transcript); follow-up is **manual** or via a **separate pipeline** (not live chat handoff).
   - **Act** — perform a safe product action (with confirmation when needed).
4. Remains auditable, rate-limited, and safe (no unbounded tool use).

**Out of scope for current sprints:** live human agents joining the same Socket.IO conversation. That remains a **future / separate sprint** (see §6 Stage 4 — deferred).

This document is the roadmap from zero to a production-capable system, in **ordered stages**. Each stage should be shippable and usable before the next begins.

---

## 2. Product context the agent must know

The agent’s knowledge base should cover (aligned with the Product Specification):

| Domain | Examples |
|--------|----------|
| **Auth** | Sign up, sign in, magic link, OAuth (Google/GitHub/Apple), session, sign out |
| **Documents** | Upload/paste/OCR, legal check, highlights (risk/advantage/compliance), progress jobs |
| **Ownership** | Guest vs signed-in, share, visibility, permission |
| **Account** | Profile, change password, email verification |
| **Limits** | Rate limits, failed jobs, “document not legal” outcomes |
| **Legal / privacy** | FAQ, Privacy Policy, Terms of Service (`data/support/*.md`) |
| **Ops** | When to escalate by email; what the bot cannot do |

**Sources of truth:**

- Curated markdown under `data/support/` (`faq.md`, `privacy-policy.md`, `terms-of-service.md`, `site-links.md`).
- Product docs (`docs/Product-Specification-Document.md`, AUTH guide) as seed material for FAQ.
- Structured **tool schemas** (actions the agent may call — Stage 3).
- Live **user/session context** (who is chatting: `userId` / `guestId`).

---

## 3. Decision model (core behavior)

Every user message is classified into a **decision** before (or as part of) the final reply:

```text
User message + conversation + product context + user identity
        │
        ▼
   ┌─────────────┐
   │  Orchestrator│  (LLM + rules)
   └──────┬──────┘
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
 Answer  Act  Escalate
                 │
                 ▼
        Email product/support
        + persist SupportTicket
        (+ optional later pipeline)
```

| Decision | When | What happens |
|----------|------|----------------|
| **Answer** | Question solvable from KB / context | Emit `agent:message` with answer + citations |
| **Act** | User wants something the system can do safely | Emit `agent:action_proposed` → user confirms → `agent:action_result` |
| **Escalate** | Ambiguous, angry, payment/legal risk, failed acts, user asks for a human, low confidence | Create `SupportTicket`, email **product contact / support**, emit `agent:escalated` + user-facing confirmation. **No live human joins the chat.** Follow-up is offline (inbox, CRM, or another pipeline). |

**Hard rules (always):**

- Never invent product behavior not in the knowledge base.
- Never run destructive actions without explicit confirmation.
- Escalate if confidence is below threshold or policy flags trigger (billing, legal liability, abuse, PII dump requests).
- Guests cannot trigger actions that require a signed-in user (e.g. email share).
- After escalate: tell the user that the team was notified and will follow up **outside this chat** (email / ticket). The AI may stop auto-resolving that thread or only give status messages—**do not** open a human chat room.

---

## 4. Communication protocol: Socket.IO

Reuse the existing Socket.IO server (`setupSocketIO` in `src/services/socket.service.ts`). Support events sit alongside current `join-job` / `progress` events.

### 4.1 Connection & auth

| Item | Spec |
|------|------|
| Transport | Socket.IO (WebSocket preferred, polling fallback) |
| Auth | Same session as HTTP: cookie `session-token`, or token in `socket.handshake.auth.token` for mobile/SPA |
| Guest | Allow connect with `guestId` in handshake; mark conversation as guest |
| Rooms | `support:{conversationId}` for **user ↔ AI agent only** (current scope) |

### 4.2 Client → server events

| Event | Payload (conceptual) | Purpose |
|-------|----------------------|---------|
| `support:start` | `{ conversationId?, email? }` | Create or resume conversation; persist contact email for escalation confirmation |
| `support:message` | `{ conversationId, text, clientMessageId }` | User chat turn |
| `support:confirm_action` | `{ conversationId, actionId, confirmed: boolean }` | Approve/deny proposed action (Stage 3) |
| `support:request_human` | `{ conversationId, reason? }` | Force **email escalate** (not live handoff) |
| `support:typing` | `{ conversationId }` | Optional UX |
| `support:end` | `{ conversationId }` | Close conversation |

### 4.3 Server → client events

| Event | Payload (conceptual) | Purpose |
|-------|----------------------|---------|
| `support:ready` | `{ conversationId, messages?, … }` | Conversation established (+ history) |
| `agent:thinking` | `{ conversationId }` | Optional status |
| `agent:message` | `{ conversationId, text, decision: "answer", citations? }` | Final answer |
| `agent:action_proposed` | `{ conversationId, actionId, name, args, summary }` | Ask user to confirm (Stage 3) |
| `agent:action_result` | `{ conversationId, actionId, ok, result \| error }` | Action outcome (Stage 3) |
| `agent:escalated` | `{ conversationId, reason, ticketId, notified, userNotified }` | Support + user confirmation emails queued |
| `support:error` | `{ conversationId?, code, message }` | Failures |
| `support:ended` | `{ conversationId }` | Closed |

**Deferred (future sprint — live chat handoff):** `support:human_joined`, `support:human_message`, `support:claim`, `support:resolve`, and rooms like `support:agent:{conversationId}`.

### 4.4 Escalation notification (email — current scope)

On escalate:

1. Persist `SupportTicket` linked to `conversationId` (status `open`).
2. Attach or include conversation transcript (messages).
3. Send email to configured **product / support contact** (e.g. `SUPPORT_ESCALATION_EMAIL` / `PRODUCT_CONTACT_EMAIL`) via SQS → email pipeline.
4. Optionally send the **user** a confirmation email (“we received your request”).
5. Emit `agent:escalated` on the socket with a clear user message: team notified; follow-up by email / ticket—not in this chat.
6. Downstream: humans handle the inbox **manually**, or a **separate pipeline** (CRM, helpdesk webhook, Lambda) consumes tickets later—**outside** this Socket.IO session.

### 4.5 Sequence diagrams

**Answer path**

```text
Client                    Server                         LLM / knowledge
  │                         │                                │
  ├── support:message ─────►│                                │
  │                         ├── classify + retrieve ─────────►│
  │◄── agent:thinking ──────┤                                │
  │                         │◄── answer + citations ─────────┤
  │◄── agent:message ───────┤                                │
```

**Act path**

```text
Client                    Server
  ├── support:message ─────►│  (decision: act)
  │◄── agent:action_proposed┤
  ├── support:confirm_action►│
  │                         ├── run tool (service layer)
  │◄── agent:action_result ─┤
  │◄── agent:message ───────┤  (optional follow-up)
```

**Escalate path (email — no live human in chat)**

```text
Client                    Server                         Email / pipeline
  ├── support:message ─────►│  (decision: escalate)
  │                         ├── SupportTicket + transcript
  │                         ├── enqueue / send email ───────►│ support@ / product@
  │◄── agent:escalated ─────┤  (user told: follow-up offline)
  │                         │                                │
  │                         │         (manual inbox or later)│
  │                         │◄────── separate pipeline ──────┤
```

---

## 5. Architecture (target)

```text
┌──────────────┐     Socket.IO      ┌─────────────────────────────┐
│ Web / Mobile │◄──────────────────►│  Express + Socket.IO server  │
└──────────────┘                    │  (doc-llm-server)            │
                                    └──────────────┬──────────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    ▼                              ▼                              ▼
           ┌────────────────┐            ┌────────────────┐            ┌────────────────┐
           │ Conversation   │            │ Agent          │            │ Action tools   │
           │ store (Postgres│            │ orchestrator   │            │ (services)     │
           │ + Redis state) │            │ (LLM + policy) │            │                │
           └────────────────┘            └───────┬────────┘            └────────────────┘
                                                 │
                                    ┌────────────┼────────────┐
                                    ▼            ▼            ▼
                              Knowledge      Embeddings    Escalation
                              (data/support) (OpenAI)      (ticket + email
                                                            / SQS → SES|Resend)
```

**Reuse from this codebase:**

- Socket.IO bootstrap and CORS origins.
- Auth session cookies / JWT for socket handshake.
- Redis for ephemeral state (rate limits; optional typing).
- Postgres (Prisma) for conversations, messages, tickets, action audit log.
- OpenAI + embeddings for grounded answers (`data/support/*.md`).
- Existing email / SQS path for escalation notifications to product/support.

---

## 6. Stages to a fully functional system

Each stage has **goal**, **deliverables**, **exit criteria**. Do not skip exit criteria.

---

### Stage 0 — Foundations ✅ Implemented

**Goal:** Data model + Socket.IO skeleton with no LLM yet.

**Deliverables**

- Prisma models: `SupportConversation`, `SupportMessage`, `SupportTicket`, `SupportActionLog`.
- Socket events: `support:start`, `support:message` → stub `agent:message`.
- Auth on socket handshake (`userId` / `guestId`).
- Conversation rooms: `support:{conversationId}`.
- Basic rate limit per socket / user.

**Exit criteria**

- Client can open a chat, send messages, receive stub replies over Socket.IO.
- Messages persisted and reloadable.

**Code map (Stage 0)**

| Piece | Location |
|-------|----------|
| Schema / migration | `prisma/schema.prisma`, `prisma/migrations/20260807120000_add_support_agent_models/` |
| Constants | `src/constants/support.ts` |
| Parsers | `src/parsers/support.ts` |
| Conversation service | `src/services/support/conversation.service.ts` |
| Socket auth | `src/services/support/socketAuth.ts` |
| Rate limit | `src/services/support/rateLimit.ts` |
| Handlers | `src/sockets/support.socket.ts` |
| Wiring | `src/services/socket.service.ts` |

**Client connect (Stage 0)**

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:8000", {
  withCredentials: true,
  auth: {
    // token: "<session-token or JWT>",
    // guestId: "guest-abc123",
  },
});

socket.on("support:auth_ok", () => {
  socket.emit("support:start", {}, (res) => {
    console.log("ready", res.conversationId, res.messages);
  });
});

socket.on("support:ready", (payload) => {
  // payload.messages = reloadable history
});

socket.emit("support:message", {
  conversationId: "<id from support:ready>",
  text: "How do I upload a document?",
  clientMessageId: crypto.randomUUID(),
});

socket.on("agent:thinking", console.log);
socket.on("agent:message", (msg) => console.log("agent:", msg.text));
socket.on("support:error", console.error);
```

**Events implemented**

| Direction | Event |
|-----------|--------|
| S→C | `support:auth_ok` / `support:auth_required` |
| C→S | `support:start` → S→C `support:ready` (+ message history) |
| C→S | `support:message` → S→C `support:user_message`, `agent:thinking`, `agent:message` |
| C→S | `support:end` → S→C `support:ended` |
| S→C | `support:error` |

---

### Stage 1 — Grounded Q&A (Answer only) ✅ Implemented

**Goal:** Agent answers product questions from curated knowledge; no tools, no escalate yet.

**Deliverables**

- Knowledge corpus under `data/support/`.
- Retrieve top sections (embeddings + keyword fallback).
- Prompt: answer only from context; if unknown, say so.
- Emit `agent:message` with citations.
- Logging: prompt version, scores, latency, token usage.

**Exit criteria**

- Correct answers for a fixed gold-set of ~30 product questions.
- Hallucination rate acceptable on “unknown” questions.

**Implementation (curated markdown in-repo)**

| Piece | Location |
|-------|----------|
| Knowledge files | `data/support/faq.md`, `privacy-policy.md`, `terms-of-service.md`, `site-links.md` |
| Knowledge retrieval | `src/services/support/knowledge.service.ts` |
| Orchestrator | `src/services/support/agent.orchestrator.ts` (`support-kb-v2`) |
| Persistence | `appendAgentReply` in `conversation.service.ts` |
| Socket | `support:message` → `agent:message` with `citations`, `promptVersion`, `unknown` |

**`agent:message` payload (Stage 1)**

```ts
{
  conversationId: string,
  id: string,
  text: string,
  decision: "answer",
  role: "agent",
  sequence: number,
  createdAt: string,
  citations: Array<{ id: string, title: string, source: string }>,
  promptVersion: string,  // e.g. "support-kb-v2"
  unknown: boolean
}
```

Edit files under `data/support/` to update knowledge (restart or call `clearFaqCache()` after deploy). Requires `OPENAI_API_KEY`.

---

### Stage 2 — Decision: Answer vs Escalate (email) ✅ Implemented

**Goal:** Agent chooses **answer** or **escalate**. Escalate notifies product/support by **email** and stores a ticket; **no** live chat handoff.

**Deliverables**

- [x] Structured decide: `answer` | `escalate` (rules + LLM classifier + grounded answer)
- [x] Escalation triggers: unknown/weak retrieval, `support:request_human`, billing/refund/legal/abuse keywords, repeated unknowns
- [x] Create `SupportTicket` with reason + conversation link
- [x] Email `SUPPORT_ESCALATION_EMAIL` (default `ojeoluwaferanmi@gmail.com`) with full ticket fields + transcript (SQS `support-escalation` job)
- [x] Emit `agent:escalated` (`ticketId`, `reason`, `notified`, offline follow-up copy)
- [x] After escalate: status `escalated`; freeze auto-answers unless `support:request_human` forces a new ticket email

**Exit criteria**

- Tickets appear in DB; escalation email received by configured inbox.
- User never sees a “human joined the chat” flow.

---

### Stage 3 — Safe actions (Act) ✅ Implemented

**Goal:** Agent can **propose and execute** limited product actions after confirmation.

**Deliverables**

- [x] Tool registry under `src/services/support/tools/` (allowlist only)
- [x] Live tools:

  | Tool | Who | Risk | Confirm |
  |------|-----|------|---------|
  | `list_my_documents` | guest/user | low | auto |
  | `search_my_documents` | guest/user | low | auto |
  | `explain_job_status` | owner of job | low | auto |
  | `get_document_summary` | owner/shared | low | auto |
  | `get_my_profile` | auth | low | auto |
  | `archive_document` | owner | medium | confirm |
  | `resend_magic_link` | email match | medium | confirm |

- [x] Flow: decide `act` → safe tools execute immediately → `agent:action_result`; mutating → `agent:action_proposed` → `support:confirm_action` → `agent:action_result`
- [x] Idempotency via `actionId` + `SupportActionLog` statuses
- [x] Authz mirrored from document/user ownership rules
- [x] Orchestrator decide: `answer` | `act` | `escalate` (`support-act-v1`)

**Exit criteria**

- 7 tools live with confirmation UX for mutating actions.
- Read-only tools auto-run after authz; mutating require confirm.

---

### Stage 4 — Live human handoff in chat (**deferred — future sprint**)

**Goal (future):** Real customer support joins the **same** Socket.IO conversation.

**Not in current roadmap scope.** Follow-up after escalate is **email / ticket / external pipeline** only until this sprint is scheduled.

**When scheduled, deliverables would include:**

- Admin/support Socket.IO auth.
- Events: `support:claim`, `support:human_message`, `support:resolve`.
- Support UI: open tickets, live chat, history.
- AI pause on claim; optional “suggest reply” for humans.
- SLA timers on ticket.

**Exit criteria (future)**

- End-to-end: escalate → human claims same room → chat continues → resolve.

Until then, do **not** implement or document live handoff as required for “fully functional.”

---

### Stage 5 — Autonomy hardening

**Goal:** Production-ready autonomous behavior with monitoring and continuous improvement.

**Deliverables**

- Confidence calibration and A/B prompt versions.
- Evaluation harness (offline + sampled live reviews).
- Guardrails: PII redaction in logs, max tool calls per turn, timeout, circuit breaker.
- Analytics: % answer / act / escalate, CSAT, deflection rate, escalation email delivery success.
- Knowledge update process for `data/support/`.
- Multi-turn memory summarization for long chats.
- Optional: proactive messages (e.g. after failed document job — opt-in only).
- Escalation email templates + DLQ / retry for failed sends.

**Exit criteria**

- Defined SLOs (e.g. p95 reply latency, escalate false-positive rate, email delivery rate).
- Runbooks for outages (LLM down → graceful degrade to FAQ + escalate email).
- Security review of tools and socket auth.

---

### Stage 6 — Full autonomy (optional advanced)

**Goal:** Maximize resolution without humans while keeping safety.

**Deliverables**

- Broader tool surface (still allowlisted).
- Policy engine (code rules > LLM) for irreversible actions.
- Multi-agent optional split: Retriever / Planner / Executor / Safety reviewer.
- Learning loop: failed escalations → new FAQ entries.
- Channel parity: same orchestrator over Socket.IO; async escalation via email/SQS/webhooks.

**Exit criteria**

- Agreed deflection target (chats resolved without email escalate).
- Zero critical incidents from unauthorized actions over a bake period.

---

## 7. Suggested repo layout (this server)

```text
src/
  sockets/
    job.socket.ts
    support.socket.ts
  services/
    support/
      conversation.service.ts
      agent.orchestrator.ts    # decide answer | act | escalate
      knowledge.service.ts     # FAQ + privacy + terms
      tools/                   # allowlisted actions (Stage 3)
      escalation.service.ts    # ticket + email to support/product (Stage 2)
  parsers/
    support.ts
  constants/
    support.ts
data/
  support/
    faq.md
    privacy-policy.md
    terms-of-service.md
    site-links.md
```

Frontend (separate app): support chat widget only (user ↔ AI). **No** in-chat support-agent console in current sprints.

---

## 8. Policy & safety checklist

| Rule | Stage |
|------|--------|
| No secrets in model context (API keys, tokens) | 1+ |
| Confirm before mutating user data | 3+ |
| Guests cannot impersonate users | 0+ |
| Escalate on legal/medical/financial advice beyond product KB | 2+ |
| Rate-limit messages and tools | 0 / 3 |
| Escalation emails go only to configured support/product addresses | 2+ |
| Transcript included (or linked) in escalation email; redact secrets | 2+ |
| No live human claim/join in current scope | — (deferred Stage 4) |
| Full audit trail of decisions and tools | 2 / 3 |

---

## 9. Metrics to track from Stage 1 onward

- Conversations started / completed  
- Decision mix: answer % / act % / escalate %  
- Containment (resolved without escalate)  
- Avg turns to resolution  
- Tool success / failure rates  
- Escalation reason taxonomy  
- Escalation email send success / failure  
- Time-to-first-response on escalated tickets (**offline**, measured in inbox/CRM if available)  
- User CSAT (post-chat)  
- p50/p95 time-to-first `agent:message`

---

## 10. Dependencies & sequencing summary

```text
Stage 0  Foundations (Socket + DB)                    ✅
   │
Stage 1  Answer (FAQ / privacy / terms)               ✅
   │
Stage 2  Answer | Escalate → email product/support    ✅
   │
Stage 3  Answer | Act | Escalate (+ confirmations)    ✅
   │
Stage 5  Hardening & SLOs                             ← next
   │
Stage 6  Broader autonomy (optional)

───── separate future sprint ─────
Stage 4  Live human handoff in same Socket.IO chat (deferred)
```

**Fully functional autonomous AI** (current product definition) means **Stage 3 complete**: grounded answers, safe actions with confirmation, and **email escalation** to product/support with tickets + transcripts. Offline follow-up is manual or another pipeline.

**Production-hardened** means **Stage 5 complete**.

**Live in-chat human support** is **not** required for fully functional; it is **Stage 4 (deferred)**.

---

## 11. Open decisions (post–Stage 3)

1. **Escalation inbox:** `SUPPORT_ESCALATION_EMAIL` (default `ojeoluwaferanmi@gmail.com`) — override via env as needed.
2. **Email path:** SQS `support-escalation` / `support-escalation-user` → email-service Lambda (SES).
3. **Confirmation UX:** mutating tools confirm; trusted read-only auto-run (current).
4. **Guest support:** guests can use document tools; auth-only tools ask to sign in.
5. **Model choice:** classifier + answerer (current) vs single structured call.
6. **Next tools:** `update_profile_fields`, share helpers, unarchive — Stage 5/6 backlog.

---

## 12. Immediate next engineering step

Implement **Stage 5** (hardening): evaluation harness, PII redaction in logs, SLOs, circuit breakers, analytics for answer/act/escalate mix.

Do **not** build live claim/human-message sockets until the deferred Stage 4 sprint.
