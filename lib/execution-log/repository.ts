import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Inserts a 'pending' execution_log row for eventId, unless one already exists.
 * Returns false when eventId was already seen (duplicate delivery) so callers
 * can skip re-dispatching.
 */
export async function insertPendingExecutionLog(
  eventId: string,
  eventType: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("execution_log")
    .upsert(
      { event_id: eventId, event_type: eventType, status: "pending", attempt_count: 0 },
      { onConflict: "event_id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) {
    throw error;
  }

  return (data?.length ?? 0) > 0;
}

export async function finalizeExecutionLog(params: {
  eventId: string;
  status: "success" | "failure";
  attemptCount: number;
  responseSummary: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("execution_log")
    .update({
      status: params.status,
      attempt_count: params.attemptCount,
      response_summary: params.responseSummary,
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", params.eventId);

  if (error) {
    throw error;
  }
}
