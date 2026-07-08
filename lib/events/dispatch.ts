import { logger } from "@/lib/logging/logger";
import { insertPendingExecutionLog, finalizeExecutionLog } from "@/lib/execution-log/repository";
import type { UserCreatedEvent } from "@/lib/events/types";

interface N8nResult {
  status: "success" | "failure";
  summary: string;
}

// Phase 2 stub: signing, retry, and the real fetch to n8n are added in Phase 4.
async function sendToN8n(event: UserCreatedEvent): Promise<N8nResult> {
  logger.info("n8n dispatch stubbed", { eventId: event.eventId });
  return { status: "success", summary: "stubbed: n8n call not yet implemented" };
}

export async function dispatchUserCreatedEvent(event: UserCreatedEvent): Promise<void> {
  logger.info("event received", { eventId: event.eventId, eventType: event.eventType });

  let isNew: boolean;
  try {
    isNew = await insertPendingExecutionLog(event.eventId, event.eventType);
  } catch (err) {
    logger.error("failed to record pending execution log", {
      eventId: event.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!isNew) {
    logger.info("duplicate event, skipping dispatch", { eventId: event.eventId });
    return;
  }

  let status: "success" | "failure" = "failure";
  let summary = "unknown error";
  try {
    const result = await sendToN8n(event);
    status = result.status;
    summary = result.summary;
  } catch (err) {
    summary = err instanceof Error ? err.message : String(err);
    logger.error("dispatch failed", { eventId: event.eventId, error: summary });
  } finally {
    try {
      await finalizeExecutionLog({
        eventId: event.eventId,
        status,
        attemptCount: 1,
        responseSummary: summary,
      });
      logger.info("execution log finalized", { eventId: event.eventId, status });
    } catch (err) {
      logger.error("failed to finalize execution log", {
        eventId: event.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
