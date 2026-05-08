import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// POST /api/tokens
// Creates a new agent_sessions row and returns the raw bearer token exactly once.
// The raw token is never stored — only the SHA-256 hash is persisted.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const agentName: string = body.agentName?.trim() || "Unnamed Agent";

  // Generate a cryptographically random 32-byte token
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  // Use the admin (service-role) client to bypass RLS on insert
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_sessions")
    .insert({
      developer_id: user.id,
      bearer_token: tokenHash,
      agent_name: agentName,
    })
    .select("id, agent_name, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return the raw token ONCE. It will never be retrievable again.
  return NextResponse.json({
    session_id: data.id,
    agent_name: data.agent_name,
    created_at: data.created_at,
    token: rawToken,
  });
}

// DELETE /api/tokens?session_id=<uuid>
// Deactivates a session so its token can no longer be used.
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("agent_sessions")
    .update({ is_active: false })
    // Scope to the authenticated developer — prevents revocation of other devs' tokens
    .eq("id", sessionId)
    .eq("developer_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ revoked: true, session_id: sessionId });
}
