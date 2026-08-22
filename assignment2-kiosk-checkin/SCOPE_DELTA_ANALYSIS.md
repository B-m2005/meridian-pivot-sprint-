# Scope Delta Analysis — Solstice Events Co. Kiosk Check-In

**Assignment 2: Mid-Sprint Change Log & Refactored Deliverable**
**Team member:** Brian Nyakundi
**Baseline compared:** `message-queue/server.js` (Day 3 Original Build)
**Pivot deliverable:** `kiosk-checkin/` (Day 4, post-pivot)

## Context

The team's actual Day 3 build was the message queue prototype:
`POST /api/queue/produce` to push a message on, and
`POST /api/queue/consume` to pull one off — with an added background
worker draining the queue automatically on an interval.

On Day 4, the client (Solstice Events Co.) announced their
badge-printer vendor was deprecating synchronous printing in favor of
a queue + webhook model, with a hard 48-hour deadline and no scope
negotiation. This document compares what the team actually built on
Day 3 against what the pivot required, file by file.

## Dropped

- **`POST /api/queue/consume` as a client-triggered action.** In the
  Day 3 build, something (a button, a caller) had to explicitly ask
  for a message to be processed — the endpoint existed specifically
  so the tester UI could demonstrate consumption on demand. In the
  pivot, there is no equivalent "ask for the result" step at all —
  completion arrives unprompted, whenever the vendor's system decides
  to send it.
- **Generic, untyped message payload.** Day 3's `payload: { itemId,
  action, qty }` was intentionally generic — any job the queue would
  ever hold looked the same. The pivot needed a job tied to a specific
  business entity (an attendee) with meaningful state, not just an
  opaque payload blob.
- **The assumption that only trusted, internal code calls back into
  the system.** Day 3's `/consume` endpoint had no authentication —
  it didn't need any, since only the same trusted service ever called
  it. That assumption breaks once an external vendor is the one
  calling back.

## Modified

- **Message ID generation logic carried over unchanged.**
  `crypto.randomUUID()` from `message-queue/server.js`'s
  `generateMessageId()` was reused directly as the `jobId` generation
  approach in `attendeeStore.js`'s `attemptScan()` — this part of the
  Day 3 build didn't need to change, it was already correct and
  collision-safe.
- **The background worker concept was kept, but re-homed.**
  `message-queue/server.js` had `setInterval()` draining the queue
  internally, within the same service. In the pivot,
  `vendorSimulator.js` still uses `setInterval()`, but it now
  represents a *separate party's* (the vendor's) processing —
  decoupled enough that it calls back over HTTP rather than mutating
  shared in-memory state directly.
- **Validation logic pattern reused.** Day 3's `/produce` endpoint
  rejecting incomplete payloads (`400` on missing `itemId`/`action`/
  `qty`) is the same defensive pattern applied to the pivot's
  `/api/kiosk/scan` (rejecting a missing `attendeeId`) and
  `/api/webhook/print-complete` (rejecting a missing `jobId`/
  `attendeeId`).

## Added

Nothing in the Day 3 build handled any of the following — these are
net-new for the pivot:

- **`verifySignature.js`** — HMAC-SHA256 signature verification.
  Day 3 never needed this, since nothing external ever called back in.
  The pivot's webhook is the first point where an outside party's
  message has to be authenticated before being trusted.
- **`attendeeStore.js`** — a real state machine
  (`NOT_CHECKED_IN → PENDING → CHECKED_IN`) with duplicate-scan
  protection at two separate points: scan time (reject if already
  `PENDING`/`CHECKED_IN`) and webhook time (reject if the incoming
  `jobId` doesn't match the attendee's *current* active job). Day 3's
  queue had no concept of "state per entity" at all — messages were
  fire-and-forget.
- **`POST /api/webhook/print-complete`** — an inbound endpoint that
  didn't exist in any form on Day 3. The Day 3 service only ever
  exposed endpoints that *pulled* work; the pivot requires accepting
  *pushed* confirmations from outside the system.
- **Randomized vendor delay** in `vendorSimulator.js`, specifically
  to produce genuine out-of-order completions in testing — Day 3's
  fixed-interval worker had no equivalent need, since message order
  didn't carry business meaning there.

## Trade-offs

- **Gained:** the kiosk never blocks on the vendor's printer, exactly
  as intended — this is a direct extension of Day 3's core async
  principle (producer doesn't wait on consumer), just applied across
  a real network boundary instead of within one process.
- **Lost:** Day 3's `/consume` endpoint gave a caller a synchronous
  way to force-check the result on demand. The pivot has no
  equivalent — once a print job is queued, the kiosk can only wait
  for the vendor's webhook; there's no "check now" fallback if the
  vendor is slow or silent.
- **New failure mode Day 3 never had to consider:** a duplicated or
  replayed webhook delivery. Day 3's `/consume` was pull-based and
  idempotent by construction (each call removed one message; calling
  it twice on an empty queue just returned `"empty"`, harmlessly). The
  pivot's push-based webhook doesn't have that natural protection —
  it had to be added explicitly by clearing `activeJobId` after a
  successful check-in, so a replayed callback with the same `jobId` is
  correctly rejected instead of silently reapplied. This exact gap was
  caught in testing before being fixed.
- **New trust boundary.** Day 3's queue was entirely internal — no
  authentication question ever arose. The pivot introduces the vendor
  as an external, untrusted caller, which is why signature
  verification exists at all in this deliverable and didn't in the
  Day 3 one.

## Backlog Impact

Carried forward, out of scope for this sprint:

- Handling a `result: "FAILED"` print job with real staff-facing
  alerting, rather than just an acknowledged-but-unapplied response.
- Persisting attendee/job state to a real database — both the Day 3
  queue and the Day 4 kiosk store state in memory only, which was
  acceptable for a prototype but wouldn't survive a server restart in
  production.
- Replacing the mock vendor queue/webhook with the real vendor's
  actual API contract once available.
