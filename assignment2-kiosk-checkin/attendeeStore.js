// attendeeStore.js
// ---------------------------------------------------
// Tracks each attendee's check-in state through the async flow:
//   NOT_CHECKED_IN --(scan)--> PENDING --(webhook confirms)--> CHECKED_IN
//
// The core requirement from the pivot handout: "an attendee who is
// already checked in must not get a second badge printed" — and this
// must hold even though webhook confirmations can arrive out of order.
//
// Two separate protections are needed:
//   1. Scan-time protection: if already PENDING or CHECKED_IN, a new
//      scan must NOT create a second print job.
//   2. Webhook-time protection: a completion callback only applies if
//      its jobId matches the attendee's CURRENT active job. A stale or
//      duplicate callback (wrong/old jobId) is ignored, not applied.

const attendees = new Map([
  ["ATT-1", { status: "NOT_CHECKED_IN", activeJobId: null }],
  ["ATT-2", { status: "NOT_CHECKED_IN", activeJobId: null }],
  ["ATT-3", { status: "NOT_CHECKED_IN", activeJobId: null }],
]);

function getAttendee(attendeeId) {
  return attendees.get(attendeeId) || null;
}

function getAllAttendees() {
  return Array.from(attendees.entries()).map(([id, data]) => ({ id, ...data }));
}

/**
 * Attempts to start a check-in scan.
 * Returns { allowed: false, reason, currentStatus } if a duplicate scan
 * is blocked, or { allowed: true, jobId } if a new print job may be queued.
 */
function attemptScan(attendeeId) {
  const attendee = getAttendee(attendeeId);
  if (!attendee) return { allowed: false, reason: "UNKNOWN_ATTENDEE" };

  if (attendee.status === "CHECKED_IN") {
    return { allowed: false, reason: "ALREADY_CHECKED_IN", currentStatus: attendee.status };
  }
  if (attendee.status === "PENDING") {
    return { allowed: false, reason: "PRINT_ALREADY_IN_PROGRESS", currentStatus: attendee.status };
  }

  const jobId = require("crypto").randomUUID();
  attendee.status = "PENDING";
  attendee.activeJobId = jobId;
  return { allowed: true, jobId };
}

/**
 * Applies a webhook completion callback. Only takes effect if jobId
 * matches the attendee's current active job — protects against stale
 * or duplicate callbacks arriving out of order.
 */
function applyPrintComplete(attendeeId, jobId) {
  const attendee = getAttendee(attendeeId);
  if (!attendee) return { applied: false, reason: "UNKNOWN_ATTENDEE" };

  if (attendee.activeJobId !== jobId) {
    // Either: this attendee already completed check-in and a duplicate/
    // stale callback arrived late, or the jobId is otherwise stale.
    // Ignored on purpose — NOT an error, just a no-op for idempotency.
    return { applied: false, reason: "STALE_OR_DUPLICATE_JOB" };
  }

  attendee.status = "CHECKED_IN";
  attendee.activeJobId = null; // BUG FIX: without clearing this, a
  // replayed webhook carrying the SAME jobId would still match on a
  // second delivery and silently re-apply — defeating the stale/
  // duplicate check above. Clearing it means any future callback,
  // even with the original jobId, correctly falls into the
  // STALE_OR_DUPLICATE_JOB branch instead of matching again.
  return { applied: true };
}

/** Test-only helper to reset state between demo runs. */
function resetAll() {
  for (const [, attendee] of attendees) {
    attendee.status = "NOT_CHECKED_IN";
    attendee.activeJobId = null;
  }
}

module.exports = { getAttendee, getAllAttendees, attemptScan, applyPrintComplete, resetAll };
