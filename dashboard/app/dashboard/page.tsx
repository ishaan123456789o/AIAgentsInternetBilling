import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import StatsRow from "@/components/StatsRow";
import TokenGenerator from "@/components/TokenGenerator";
import TransactionTable from "@/components/TransactionTable";
import TopUpButton from "@/components/TopUpButton";

export const metadata: Metadata = { title: "Dashboard" };

type Developer = {
  id: string;
  email: string;
  company_name: string | null;
  wallet_balance: number;
};

type Session = {
  id: string;
  agent_name: string | null;
  created_at: string;
  request_count: number;
  is_active: boolean;
};

type Transaction = {
  id: number;
  created_at: string;
  amount_usd: number;
  verification_score: number;
  response_status: number;
  latency_ms: number;
  proof_metadata: Record<string, unknown> | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  let { data: developer } = await supabase
    .from("agent_developers")
    .select("id, email, company_name, wallet_balance")
    .eq("id", user.id)
    .single<Developer>();

  // Row missing — auto-provision it. This happens when:
  // a) user signed up before the auth trigger was applied
  // b) OAuth sign-in where the trigger fired but the insert raced
  if (!developer) {
    const admin = createAdminClient();
    const { data: provisioned } = await admin
      .from("agent_developers")
      .upsert(
        { id: user.id, email: user.email ?? "", wallet_balance: 0 },
        { onConflict: "id" }
      )
      .select("id, email, company_name, wallet_balance")
      .single<Developer>();

    if (!provisioned) redirect("/login?error=provision_failed");
    developer = provisioned;
  }

  const { data: sessions } = await supabase
    .from("agent_sessions")
    .select("id, agent_name, created_at, request_count, is_active")
    .eq("developer_id", user.id)
    .order("created_at", { ascending: false })
    .returns<Session[]>();

  const { data: transactions } = await supabase
    .from("micro_transactions")
    .select(
      "id, created_at, amount_usd, verification_score, response_status, latency_ms, proof_metadata"
    )
    .eq("developer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<Transaction[]>();

  const developerData = developer as Developer;
  const sessionList: Session[] = sessions ?? [];
  const transactionList: Transaction[] = transactions ?? [];

  async function signOut() {
    "use server";
    const sb = await createClient();
    await sb.auth.signOut();
    redirect("/login");
  }

  const balance = Number(developerData.wallet_balance);
  const balanceColor =
    balance > 1 ? "#00d4b1" : balance > 0 ? "#f0a500" : "#f43a5a";
  const gatewayUrl =
    process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://your-gateway.com";

  return (
    <div className="min-h-screen bg-[#070b12]">
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b border-[#1c2d45]"
        style={{ background: "rgba(7,11,18,0.92)", backdropFilter: "blur(12px)" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-lg bg-[#0d1421] border border-[#243552] flex items-center justify-center flex-shrink-0"
              style={{ boxShadow: "0 0 12px rgba(0,212,177,0.08)" }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="5.5" stroke="#00d4b1" strokeWidth="1" strokeOpacity="0.35" />
                <path d="M4.5 7L6.5 9L9.5 5" stroke="#00d4b1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-sm font-bold text-[#e4ecf7] tracking-tight">Agent Gateway</span>
            <span className="hidden sm:inline text-[#3a4f68] text-sm">/</span>
            <span className="hidden sm:inline font-mono text-xs text-[#6b82a0]">
              {developerData.company_name ?? developerData.email}
            </span>
          </div>

          {/* Right */}
          <div className="flex items-center gap-5">
            <div className="hidden sm:flex items-center gap-2">
              <span className="font-mono text-[10px] text-[#3a4f68] uppercase tracking-[0.15em]">Balance</span>
              <span className="font-mono text-sm font-semibold" style={{ color: balanceColor }}>
                ${balance.toFixed(4)}
              </span>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="font-mono text-xs text-[#3a4f68] hover:text-[#6b82a0] transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {/* Page header */}
        <div className="pb-6 border-b border-[#1c2d45]">
          <h1 className="text-2xl font-bold text-[#e4ecf7]">Dashboard</h1>
          <p className="text-sm text-[#6b82a0] mt-1.5">
            Real-time spend and session analytics for your agent fleet.
          </p>
        </div>

        {/* Low / zero balance warning + top-up */}
        {balance <= 1 && (
          <div
            className="grid sm:grid-cols-2 gap-5 p-5 rounded-2xl border"
            style={{
              background: balance <= 0 ? "rgba(244,58,90,0.05)" : "rgba(240,165,0,0.05)",
              borderColor: balance <= 0 ? "rgba(244,58,90,0.18)" : "rgba(240,165,0,0.18)",
            }}
          >
            <div>
              <p
                className="font-mono text-xs font-semibold mb-1"
                style={{ color: balance <= 0 ? "#f43a5a" : "#f0a500" }}
              >
                {balance <= 0 ? "BALANCE EMPTY" : "LOW BALANCE"}
              </p>
              <p className="text-sm text-[#6b82a0] mb-1">
                {balance <= 0
                  ? "Your wallet is at $0.00. All gateway requests are being rejected with HTTP 402."
                  : `Your wallet has $${balance.toFixed(4)} remaining.`}
              </p>
              <p className="font-mono text-[10px] text-[#3a4f68]">
                Credits are deducted only on Proof-of-Execution. Top up to keep agents running.
              </p>
            </div>
            <TopUpButton />
          </div>
        )}

        {/* Onboarding checklist — shown until all 3 steps complete */}
        {(balance <= 0 || sessionList.length === 0 || transactionList.length === 0) && (
          <div className="bg-[#0d1421] border border-[#1c2d45] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#1c2d45]">
              <h2 className="text-sm font-semibold text-[#e4ecf7]">Getting started</h2>
              <p className="font-mono text-[10px] text-[#3a4f68] mt-1 tracking-wide">
                Complete these steps to send your first billed request
              </p>
            </div>
            <div className="divide-y divide-[#1c2d45]/60">
              {[
                {
                  done: balance > 0,
                  step: "1",
                  title: "Fund your wallet",
                  desc: "Add credits — you're only charged on Proof-of-Execution.",
                },
                {
                  done: sessionList.length > 0,
                  step: "2",
                  title: "Create an API key",
                  desc: "Generate a bearer token for your agent to authenticate with.",
                },
                {
                  done: transactionList.length > 0,
                  step: "3",
                  title: "Send your first proxied request",
                  desc: "Route any HTTP request through the gateway with your token.",
                },
              ].map(({ done, step, title, desc }) => (
                <div key={step} className="flex items-start gap-4 px-5 py-4">
                  <div
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
                    style={
                      done
                        ? { background: "rgba(0,212,177,0.12)", border: "1px solid rgba(0,212,177,0.3)" }
                        : { background: "#121b2e", border: "1px solid #1c2d45" }
                    }
                  >
                    {done ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5L4 7L8 3" stroke="#00d4b1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <span className="font-mono text-[10px] text-[#3a4f68]">{step}</span>
                    )}
                  </div>
                  <div>
                    <p
                      className="text-sm font-medium"
                      style={{ color: done ? "#3a4f68" : "#e4ecf7" }}
                    >
                      {title}
                    </p>
                    <p className="font-mono text-[10px] text-[#3a4f68] mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <StatsRow developer={developerData} transactions={transactionList} />

        {/* API key management */}
        <TokenGenerator sessions={sessionList} />

        {/* Live transaction feed */}
        <TransactionTable
          initialTransactions={transactionList}
          developerId={developerData.id}
        />

        {/* Quick start */}
        <div className="bg-[#0d1421] border border-[#1c2d45] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1c2d45]">
            <h2 className="text-sm font-semibold text-[#e4ecf7]">Quick Start</h2>
            <p className="font-mono text-[10px] text-[#3a4f68] mt-1 tracking-wide">
              Route any request — billed only on Proof-of-Execution
            </p>
          </div>
          <pre className="px-5 py-5 text-xs font-mono text-[#6b82a0] overflow-x-auto leading-relaxed bg-[#070b12]">
            <span className="text-[#3a4f68]"># Proxy any request through the gateway</span>{"\n"}
            curl{" "}
            <span className="text-[#38bdf8]">-X GET</span>{" "}
            <span className="text-[#e4ecf7]">{`"${gatewayUrl}/proxy?__target=https://api.example.com/data"`}</span>{" "}\{"\n"}
            {"  "}<span className="text-[#38bdf8]">-H</span>{" "}
            <span className="text-[#00d4b1]">"Authorization: Bearer &lt;your-token&gt;"</span>{" "}\{"\n"}
            {"  "}<span className="text-[#38bdf8]">-H</span>{" "}
            <span className="text-[#00d4b1]">"X-Agent-Intent: Fetch product catalog to answer user query"</span>{" "}\{"\n"}
            {"  "}<span className="text-[#38bdf8]">-H</span>{" "}
            <span className="text-[#00d4b1]">"Accept: application/json"</span>{"\n"}
            {"\n"}
            <span className="text-[#3a4f68]"># You are only billed when Proof-of-Execution == true</span>
          </pre>
        </div>
      </main>
    </div>
  );
}
