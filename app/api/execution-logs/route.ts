import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Manual verification endpoint: lets us confirm a trigger -> webhook -> log
// round trip landed, without needing direct DB access.
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("execution_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
