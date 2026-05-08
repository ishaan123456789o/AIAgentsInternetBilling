"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";

type ProofMetadata = {
  target_url?: string;
  http_method?: string;
  agent_intent?: string;
  judge_reasoning?: string;
  flags?: string[];
  model_version?: string;
};

type Transaction = {
  id: number;
  created_at: string;
  amount_usd: number;
  verification_score: number;
  response_status: number;
  latency_ms: number;
  proof_metadata: ProofMetadata | null;
};

type Props = {
  initialTransactions: Transaction[];
  developerId: string;
};

function StatusBadge({ code }: { code: number }) {
  const [bg, color, border] =
    code >= 200 && code < 300
      ? ["rgba(0,212,177,0.08)", "#00d4b1", "rgba(0,212,177,0.22)"]
      : code >= 400 && code < 500
      ? ["rgba(240,165,0,0.08)", "#f0a500", "rgba(240,165,0,0.22)"]
      : ["rgba(244,58,90,0.08)", "#f43a5a", "rgba(244,58,90,0.22)"];
  return (
    <span
      className="font-mono text-xs px-1.5 py-0.5 rounded"
      style={{ background: bg, color, border: `1px solid ${border}` }}
    >
      {code}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "#00d4b1" : pct >= 55 ? "#f0a500" : "#f43a5a";
  const trackBg =
    pct >= 80 ? "rgba(0,212,177,0.12)" : pct >= 55 ? "rgba(240,165,0,0.12)" : "rgba(244,58,90,0.12)";
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="w-14 h-1 rounded-full overflow-hidden" style={{ background: trackBg }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="font-mono text-[11px]" style={{ color }}>
        {score.toFixed(3)}
      </span>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const map: Record<string, [string, string, string]> = {
    GET:    ["rgba(56,189,248,0.08)",  "#38bdf8", "rgba(56,189,248,0.22)"],
    POST:   ["rgba(167,139,250,0.08)", "#a78bfa", "rgba(167,139,250,0.22)"],
    PUT:    ["rgba(240,165,0,0.08)",   "#f0a500", "rgba(240,165,0,0.22)"],
    DELETE: ["rgba(244,58,90,0.08)",   "#f43a5a", "rgba(244,58,90,0.22)"],
    PATCH:  ["rgba(249,115,22,0.08)",  "#fb923c", "rgba(249,115,22,0.22)"],
  };
  const [bg, color, border] =
    map[method.toUpperCase()] ?? ["rgba(107,130,160,0.08)", "#6b82a0", "rgba(107,130,160,0.22)"];
  return (
    <span
      className="font-mono text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ background: bg, color, border: `1px solid ${border}` }}
    >
      {method}
    </span>
  );
}

export default function TransactionTable({
  initialTransactions,
  developerId,
}: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [isLive, setIsLive] = useState(true);
  const newIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`txn_feed_${developerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "micro_transactions",
          filter: `developer_id=eq.${developerId}`,
        },
        (payload) => {
          const txn = payload.new as Transaction;
          newIds.current.add(txn.id);
          setTransactions((prev) => [txn, ...prev].slice(0, 100));
          setTimeout(() => { newIds.current.delete(txn.id); }, 500);
        }
      )
      .subscribe((status) => {
        setIsLive(status === "SUBSCRIBED");
      });

    return () => { supabase.removeChannel(channel); };
  }, [developerId]);

  function truncateUrl(url: string | undefined, max = 45): string {
    if (!url) return "—";
    try {
      const u = new URL(url);
      const path = u.pathname + u.search;
      return path.length > max ? path.slice(0, max) + "…" : path;
    } catch {
      return url.length > max ? url.slice(0, max) + "…" : url;
    }
  }

  return (
    <div className="bg-[#0d1421] border border-[#1c2d45] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1c2d45]">
        <div>
          <h2 className="text-sm font-semibold text-[#e4ecf7]">Transaction Feed</h2>
          <p className="font-mono text-[10px] text-[#3a4f68] mt-1 tracking-wide">
            Verified executions only — failures are not billed
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-mono font-medium px-2.5 py-1.5 rounded-full"
          style={
            isLive
              ? {
                  background: "rgba(0,212,177,0.08)",
                  color: "#00d4b1",
                  border: "1px solid rgba(0,212,177,0.2)",
                }
              : {
                  background: "#121b2e",
                  color: "#3a4f68",
                  border: "1px solid #1c2d45",
                }
          }
        >
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              isLive ? "bg-[#00d4b1] animate-pulse-dot" : "bg-[#3a4f68]"
            }`}
          />
          {isLive ? "LIVE" : "RECONNECTING"}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1c2d45]">
              {[
                { label: "Time", w: "w-24" },
                { label: "Target URL", w: "" },
                { label: "Method", w: "w-16" },
                { label: "Status", w: "w-16" },
                { label: "PoE Score", w: "w-28" },
                { label: "Amount", w: "w-24" },
                { label: "Latency", w: "w-20" },
                { label: "Judge", w: "" },
              ].map(({ label, w }) => (
                <th
                  key={label}
                  className={`text-left px-5 py-3 font-mono text-[#3a4f68] font-medium text-[10px] uppercase tracking-[0.15em] ${w}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-5 py-16 text-center font-mono text-xs text-[#3a4f68]"
                >
                  No transactions yet. Route a request through the gateway to see live billing.
                </td>
              </tr>
            )}
            {transactions.map((txn) => {
              const meta = txn.proof_metadata ?? {};
              const isNew = newIds.current.has(txn.id);
              return (
                <tr
                  key={txn.id}
                  className={`border-b border-[#1c2d45]/50 last:border-0 hover:bg-[#121b2e]/60 transition-colors ${
                    isNew ? "animate-slide-in" : ""
                  }`}
                >
                  <td className="px-5 py-3.5 font-mono text-[#3a4f68] whitespace-nowrap text-[11px]">
                    {formatDistanceToNow(new Date(txn.created_at), {
                      addSuffix: true,
                      includeSeconds: true,
                    })}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      title={meta.target_url}
                      className="font-mono text-[#6b82a0] text-[11px]"
                    >
                      {truncateUrl(meta.target_url)}
                    </span>
                    {meta.agent_intent && (
                      <p className="text-[#3a4f68] mt-0.5 truncate max-w-xs text-[10px] font-mono">
                        {meta.agent_intent}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <MethodBadge method={meta.http_method ?? "GET"} />
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge code={txn.response_status} />
                  </td>
                  <td className="px-5 py-3.5">
                    <ScoreBar score={Number(txn.verification_score)} />
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[#e4ecf7] text-[11px]">
                    ${Number(txn.amount_usd).toFixed(6)}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[#6b82a0] text-[11px]">
                    {txn.latency_ms}ms
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[#3a4f68] max-w-[200px] truncate text-[11px]">
                    {meta.judge_reasoning ? (
                      <span
                        title={meta.judge_reasoning}
                        className="cursor-help border-b border-dotted border-[#1c2d45]"
                      >
                        {meta.judge_reasoning.length > 60
                          ? meta.judge_reasoning.slice(0, 60) + "…"
                          : meta.judge_reasoning}
                      </span>
                    ) : (
                      <span className="italic text-[#243552]">heuristic</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
