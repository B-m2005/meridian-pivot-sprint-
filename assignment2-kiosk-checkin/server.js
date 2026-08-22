// server.js - Solstice Events Co. Kiosk Check-In Service (Pivot: Async Model)
// ---------------------------------------------------
// OLD (pre-pivot) model: scan -> call printer API synchronously -> wait
// for response -> show "Checked In".
//
// NEW (post-pivot) model: scan -> publish print job to queue -> return
// immediately with PENDING -> vendor prints asynchronously -> vendor
// calls our webhook -> we verify signature -> we mark CHECKED_IN.
//
// Zero external dependencies — pure Node.js (http + built-in fetch).

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const store = require("./attendeeStore");
const printQueue = require("./printQueue");
const { verifySignature } = require("./verifySignature");
const { startVendorWorker } = require("./vendorSimulator");

const PORT = process.env.PORT || 3000;
const VENDOR_SECRET = process.env.VENDOR_SECRET || "dev_only_vendor_secret_do_not_use_in_production";

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  if (req.method !== "GET") return false;
  const filePath = req.url === "/" ? "/index.html" : req.url;
  const fullPath = path.join(__dirname, "public", filePath);
  if (!fullPath.startsWith(path.join(__dirname, "public"))) return false; // basic path traversal guard
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return false;

  const ext = path.extname(fullPath);
  const contentType = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "text/plain";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(fs.readFileSync(fullPath));
  return true;
}

const server = http.createServer((req, res) => {
  if (serveStatic(req, res)) return;

  let chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks);
    let body = {};
    try {
      body = rawBody.length ? JSON.parse(rawBody) : {};
    } catch (e) {
      /* leave body as {} */
    }

    // --- Scan endpoint: kiosk staff scan an attendee's QR code ---
    if (req.method === "POST" && req.url === "/api/kiosk/scan") {
      const { attendeeId } = body;
      if (!attendeeId) {
        return sendJson(res, 400, { error: "attendeeId is required" });
      }

      const result = store.attemptScan(attendeeId);

      if (!result.allowed) {
        // Duplicate-scan protection: no new print job is queued.
        return sendJson(res, 200, {
          status: result.currentStatus || "UNKNOWN",
          duplicate: true,
          reason: result.reason,
          message:
            result.reason === "ALREADY_CHECKED_IN"
              ? "Attendee already checked in — no badge printed."
              : "Print already in progress for this attendee — not queuing a second job.",
        });
      }

      // Publish to the (mock) vendor's queue and return immediately —
      // this is the core of the pivot: no blocking wait for the printer.
      printQueue.publish({ jobId: result.jobId, attendeeId });
      return sendJson(res, 202, {
        status: "PENDING",
        jobId: result.jobId,
        message: "Print job queued. Badge will confirm once printing completes.",
      });
    }

    // --- Webhook endpoint: vendor calls back when print job completes ---
    if (req.method === "POST" && req.url === "/api/webhook/print-complete") {
      const signature = req.headers["x-signature"];
      if (!signature) {
        return sendJson(res, 401, { status: "error", message: "Missing signature header" });
      }
      if (!verifySignature(rawBody, signature, VENDOR_SECRET)) {
        return sendJson(res, 403, { status: "error", message: "Invalid payload signature" });
      }

      const { jobId, attendeeId, result: printResult } = body;
      if (!jobId || !attendeeId) {
        return sendJson(res, 400, { status: "error", message: "jobId and attendeeId are required" });
      }
      if (printResult !== "SUCCESS") {
        // A real system would handle failed print jobs (retry, alert
        // staff, etc.) — out of scope for this prototype, but not
        // silently treated as success either.
        return sendJson(res, 200, { status: "acknowledged", applied: false, reason: "PRINT_FAILED" });
      }

      const applyResult = store.applyPrintComplete(attendeeId, jobId);
      // Always 200 here: whether applied or correctly ignored as
      // stale/duplicate, the vendor's webhook delivery itself succeeded.
      return sendJson(res, 200, { status: "acknowledged", ...applyResult });
    }

    // --- Status endpoints for the tester UI ---
    if (req.method === "GET" && req.url === "/api/kiosk/attendees") {
      return sendJson(res, 200, { attendees: store.getAllAttendees(), queueDepth: printQueue.length() });
    }

    if (req.method === "POST" && req.url === "/api/kiosk/reset") {
      store.resetAll();
      return sendJson(res, 200, { status: "reset" });
    }

    sendJson(res, 404, { error: "Not found" });
  });
});

server.listen(PORT, () => {
  console.log(`[server] Solstice kiosk check-in running on http://localhost:${PORT}`);
  startVendorWorker();
});
