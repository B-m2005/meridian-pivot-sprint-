// vendorSimulator.js
// ---------------------------------------------------
// Stands in for the badge-printer vendor's own async processing.
// Consumes jobs off the print queue and, after a RANDOM delay (to
// genuinely simulate real-world out-of-order completion — a job
// queued first isn't guaranteed to print/confirm first), sends a
// signed webhook callback back to our own server.
//
// This runs as a background loop, decoupled from the kiosk's scan
// request — the whole point of the pivot.

const printQueue = require("./printQueue");
const { signPayload } = require("./verifySignature");

const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://localhost:3000/api/webhook/print-complete";
const VENDOR_SECRET = process.env.VENDOR_SECRET || "dev_only_vendor_secret_do_not_use_in_production";
const WORKER_TICK_MS = Number(process.env.VENDOR_TICK_MS) || 200;

async function sendCallback(job) {
  const payload = JSON.stringify({
    jobId: job.jobId,
    attendeeId: job.attendeeId,
    result: "SUCCESS",
  });
  const signature = signPayload(Buffer.from(payload), VENDOR_SECRET);

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": signature },
      body: payload,
    });
    console.log(` [VENDOR] printed badge for ${job.attendeeId} (job ${job.jobId}) — callback sent`);
  } catch (err) {
    console.error(` [VENDOR] failed to deliver callback for job ${job.jobId}: ${err.message}`);
  }
}

function startVendorWorker() {
  setInterval(() => {
    const job = printQueue.drainOne();
    if (!job) return;

    // Random delay (0-1500ms) before the callback fires — this is
    // what actually produces genuine out-of-order completions when
    // multiple jobs are queued close together, rather than just
    // hoping the interval timing happens to shuffle them.
    const delay = Math.floor(Math.random() * 1500);
    setTimeout(() => sendCallback(job), delay);
  }, WORKER_TICK_MS);

  console.log(`[VENDOR] worker started, polling queue every ${WORKER_TICK_MS}ms`);
}

module.exports = { startVendorWorker };
