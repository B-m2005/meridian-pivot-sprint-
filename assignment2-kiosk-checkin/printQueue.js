// printQueue.js
// ---------------------------------------------------
// Stands in for the vendor's real message queue. In production this
// would be the vendor's actual broker (SQS, RabbitMQ, etc.) — the
// kiosk publishes a print request and moves on immediately, without
// waiting for a response. This is the "async" half of the pivot: the
// kiosk NEVER blocks waiting for the printer anymore.

const queue = [];

function publish(job) {
  queue.push(job);
}

function drainOne() {
  return queue.shift() || null;
}

function length() {
  return queue.length;
}

module.exports = { publish, drainOne, length };
