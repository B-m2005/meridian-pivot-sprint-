# Learning & Blocker Journal

**Student Name:** Brian Nyakundi
**Chosen Tool/Concept:** Message Queue (RabbitMQ / SQS pattern)
**Sprint Phase:** Days 1–2 Solo Recon

## 1. Resources Consulted

- RabbitMQ & AWS SQS Official Conceptual Documentation (Producer,
  Consumer, FIFO Queue patterns).

## 2. Blockers Faced & Troubleshooting Journal

### Blocker 1: Modeling decoupled producer/consumer roles in a single process

**Issue:** Message queues like RabbitMQ/SQS normally run as separate
infrastructure, with producers and consumers as entirely separate
processes/services. Simulating that decoupling inside one Express app
for a local prototype meant deciding how to represent "the queue"
itself without an actual broker.

**Resolution:** Modeled the queue as a simple in-memory array on the
server, with two distinct endpoints (`/api/queue/produce` and
`/api/queue/consume`) so producer and consumer logic stay separated
in code even though they share a process — keeping the *interface*
decoupled even where the *infrastructure* isn't.

### Blocker 2: Ensuring FIFO ordering

**Issue:** Needed processing to respect insertion order (first in,
first out), matching how most real queue systems behave by default.

**Resolution:** Used `Array.prototype.shift()` to always pull from
the front of the queue, so the oldest message is processed first.

### Blocker 3 (found in review, not caught solo): consumption was manual, not actually asynchronous

**Issue:** My own definition of this concept — *"workers consume them
asynchronously, decoupling producer from consumer"* — implies a
background worker that pulls and processes messages independently,
on its own schedule. My original implementation only consumed a
message when a human clicked a button and triggered `POST
/api/queue/consume`. That's a manual, synchronous, on-demand pull —
not an asynchronous worker. The queue itself was correctly decoupled
in code, but nothing was actually running "asynchronously" in the
sense the concept describes.

**Resolution:** Added a background worker using `setInterval()` that
runs independently of any request, pulling and processing messages
off the queue on a fixed interval without needing to be triggered.
Kept the manual `/consume` endpoint available for debugging/demo
purposes, but the interval-based worker is now what actually
represents the concept.

**How I verified the fix:** wrote a standalone test — produced three
messages back-to-back, immediately checked queue depth (confirmed all
3 still pending, since the worker hadn't ticked yet), then waited for
the worker's interval to elapse and re-checked (confirmed queue
dropped to 0, all 3 processed) — all without ever calling `/consume`
manually. This confirms messages are genuinely drained in the
background, not just claimed to be.

### Blocker 4 (found in review): missing input validation

**Issue:** `/api/queue/produce` accepted any request body without
checking for required fields. Sending a request missing `itemId`,
`action`, or `qty` would still push a message onto the queue —
just with `undefined` values baked in, which a consumer would
either mishandle silently or fail on downstream without a clear error
at the point of entry.

**Resolution:** Added a validation check that rejects incomplete
messages with a `400` response and a clear error message, so bad data
is caught at the producer boundary instead of leaking into the queue.

### Blocker 5 (found in review): message ID collisions under rapid produce calls

**Issue:** Message IDs were generated with `MSG-${Date.now()}`, which
only has millisecond resolution. Two `produce` calls within the same
millisecond — plausible under any real load, or even a fast
double-click on the tester UI — would generate identical IDs,
breaking the assumption that each message is uniquely identifiable.

**Resolution:** Switched to `crypto.randomUUID()` for ID generation,
which guarantees uniqueness regardless of timing.

### Blocker 6 (found in review): tester page unreachable

**Issue:** The server never served its own HTML tester file via
`express.static()`, so opening the page directly had no way to reach
the API — its `fetch()` calls had nothing valid to hit.

**Resolution:** Added `express.static()` pointing at a `public/`
folder containing the tester page, and added a `GET
/api/queue/status` endpoint so the tester UI can visibly display
queue depth changing in real time — making the asynchronous
background processing actually observable, not just claimed in code.

## 3. Reflection

Blockers 1–2 were solved independently during Days 1–2, without help,
per the assignment rules. Blockers 3–6 surfaced during a self-review
pass afterward, and I'm logging them honestly as review findings
rather than folding them into the solo narrative, since the audit
trail is part of what's being evaluated. Blocker 3 was the most
important catch — it wasn't a small bug but a gap between what I
built and what the concept actually requires: a queue that's
correctly *structured* as decoupled but only *consumed* on manual
request isn't really demonstrating asynchronous processing at all.
