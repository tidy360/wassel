import { api } from "../api/client";

const QUEUE_KEY = "cashiri_offline_queue";

interface QueuedOp {
  clientUuid: string;
  deviceId: string;
  operationType: "create_sale";
  payload: unknown;
}

function deviceId() {
  let id = localStorage.getItem("cashiri_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("cashiri_device_id", id);
  }
  return id;
}

function readQueue(): QueuedOp[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedOp[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function queueSale(payload: unknown) {
  const op: QueuedOp = { clientUuid: crypto.randomUUID(), deviceId: deviceId(), operationType: "create_sale", payload };
  const queue = readQueue();
  queue.push(op);
  writeQueue(queue);
  return op.clientUuid;
}

export function pendingCount() {
  return readQueue().length;
}

/** Call this on reconnect (a `window.online` listener, or a periodic timer). */
export async function flushQueue() {
  const queue = readQueue();
  if (queue.length === 0) return { applied: 0, conflicts: 0 };

  const res = await api.post<{ results: { clientUuid: string; status: string }[] }>("/api/store/sync", { operations: queue });

  const stillPending = queue.filter((op) => {
    const result = res.results.find((r) => r.clientUuid === op.clientUuid);
    // Keep only genuinely unresolved items — applied/already_applied/conflict/rejected are all "done" from the queue's perspective.
    return !result;
  });
  writeQueue(stillPending);

  const applied = res.results.filter((r) => r.status === "applied" || r.status === "already_applied").length;
  const conflicts = res.results.filter((r) => r.status === "conflict").length;
  return { applied, conflicts, results: res.results };
}
