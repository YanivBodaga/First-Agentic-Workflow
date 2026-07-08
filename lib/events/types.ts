export interface UserRecord {
  id: string;
  email: string;
  created_at: string;
}

// Shape of the payload Supabase's Database Webhooks feature POSTs on an insert.
export interface UserInsertWebhookPayload {
  type: "INSERT";
  table: string;
  schema: string;
  record: UserRecord;
  old_record: null;
}

export interface UserCreatedEvent {
  // The user's row id doubles as the idempotency key: this event type only ever
  // fires once per user (on insert), so re-deliveries carry the same eventId.
  eventId: string;
  eventType: "user.created";
  occurredAt: string;
  user: UserRecord;
}
