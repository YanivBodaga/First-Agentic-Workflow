import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logging/logger";

// Stand-in for a real signup flow: inserting a row here is what fires the
// `user.created` Database Webhook, which is the event this whole exercise traces.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = body?.email;

  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .insert({ email })
    .select("id, email, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "email already exists" }, { status: 409 });
    }
    logger.error("failed to insert user", { error: error.message });
    return NextResponse.json({ error: "failed to create user" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
