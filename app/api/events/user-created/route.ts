import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { dispatchUserCreatedEvent } from "@/lib/events/dispatch";
import { logger } from "@/lib/logging/logger";
import type { UserInsertWebhookPayload, UserCreatedEvent } from "@/lib/events/types";

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as UserInsertWebhookPayload | null;

  if (!payload?.record?.id) {
    logger.warn("received malformed user-created webhook payload");
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const event: UserCreatedEvent = {
    eventId: payload.record.id,
    eventType: "user.created",
    occurredAt: payload.record.created_at,
    user: payload.record,
  };

  logger.info("webhook received", { eventId: event.eventId });

  after(() => dispatchUserCreatedEvent(event));

  return NextResponse.json({ received: true }, { status: 202 });
}
