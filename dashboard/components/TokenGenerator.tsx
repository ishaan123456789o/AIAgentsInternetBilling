"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

type Session = {
  id: string;
  agent_name: string | null;
  created_at: string;
  request_count: number;
  is_active: boolean;
};

type Props = {
  sessions: Session[];
};

type ModalState =
  | { phase: "closed" }
  | { phase: "form" }
  | { phase: "reveal"; token: string; agentName: string };

export default function TokenGenerator({ sessions: initialSessions }: Props) {
  const [sessions, setSessions] = useState(initialSessions);
  const [modal, setModal] = useState<ModalState>({ phase: "closed" });
  const [agentName, setAgentName] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to create token");
      setLoading(false);
      return;
    }
    setSessions((prev) => [
      {
        id: data.session_id,
        agent_name: data.agent_name,
        created_at: data.created_at,
        request_count: 0,
        is_active: true,
      },
      ...prev,
    ]);
    setModal({ phase: "reveal", token: data.token, agentName: data.agent_name });
    setAgentName("");
    setLoading(false);
  }

  async function handleRevoke(sessionId: string) {
    setRevokingId(sessionId);
    setRevokeError(null);
    const res = await fetch(`/api/tokens?session_id=${sessionId}`, { method: "DELETE" });
    setRevokingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRevokeError(data.error ?? "Failed to revoke token");
      return;
    }
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, is_active: false } : s))
    );
  }

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-[#0d1421] border border-[#1c2d45] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1c2d45]">
        <div>
          <h2 className="text-sm font-semibold text-[#e4ecf7]">API Keys</h2>
          <p className="font-mono text-[10px] text-[#3a4f68] mt-1 tracking-wide">
            Bearer tokens for your agent sessions
          </p>
          {revokeError && (
            <p className="font-mono text-[10px] text-[#f43a5a] mt-1">{revokeError}</p>
          )}
        </div>
        <button
          onClick={() => setModal({ phase: "form" })}
          className="flex items-center gap-1.5 text-[#071a16] text-xs font-bold px-3.5 py-2 rounded-lg transition-all"
          style={{ background: "#00d4b1" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#00c4a3"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#00d4b1"; }}
        >
          <span className="text-sm leading-none font-mono">+</span> New Key
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1c2d45]">
              <th className="text-left px-5 py-3 font-mono text-[#3a4f68] font-medium text-[10px] uppercase tracking-[0.15em]">Agent Name</th>
              <th className="text-left px-5 py-3 font-mono text-[#3a4f68] font-medium text-[10px] uppercase tracking-[0.15em]">Token</th>
              <th className="text-left px-5 py-3 font-mono text-[#3a4f68] font-medium text-[10px] uppercase tracking-[0.15em]">Requests</th>
              <th className="text-left px-5 py-3 font-mono text-[#3a4f68] font-medium text-[10px] uppercase tracking-[0.15em]">Created</th>
              <th className="text-left px-5 py-3 font-mono text-[#3a4f68] font-medium text-[10px] uppercase tracking-[0.15em]">Status</th>
              <th className="px-5 py-3 w-16" />
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center font-mono text-[#3a4f68] text-xs">
                  No API keys yet. Generate one to start routing requests.
                </td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr
                key={s.id}
                className="border-b border-[#1c2d45]/50 last:border-0 hover:bg-[#121b2e]/60 transition-colors"
              >
                <td className="px-5 py-3.5 text-[#e4ecf7] font-medium">
                  {s.agent_name ?? "Unnamed Agent"}
                </td>
                <td className="px-5 py-3.5 font-mono text-[#6b82a0]">
                  sk-…{s.id.slice(-8)}
                </td>
                <td className="px-5 py-3.5 font-mono text-[#e4ecf7]">
                  {s.request_count.toLocaleString()}
                </td>
                <td className="px-5 py-3.5 font-mono text-[#6b82a0]">
                  {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] font-medium"
                    style={
                      s.is_active
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
                      className={`w-1.5 h-1.5 rounded-full ${
                        s.is_active ? "bg-[#00d4b1] animate-pulse-dot" : "bg-[#3a4f68]"
                      }`}
                    />
                    {s.is_active ? "ACTIVE" : "REVOKED"}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  {s.is_active && (
                    <button
                      onClick={() => handleRevoke(s.id)}
                      disabled={revokingId === s.id}
                      className="font-mono text-xs text-[#3a4f68] hover:text-[#f43a5a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {revokingId === s.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal.phase !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div
            className="bg-[#0d1421] border border-[#243552] rounded-2xl w-full max-w-md mx-4 p-6"
            style={{ boxShadow: "0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.02)" }}
          >
            {modal.phase === "form" && (
              <>
                <h3 className="font-semibold text-[#e4ecf7] mb-1">Create API Key</h3>
                <p className="font-mono text-xs text-[#6b82a0] mb-5">
                  Name this token after the agent that will use it.
                </p>
                <input
                  autoFocus
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="e.g. Research Agent v2"
                  className="w-full bg-[#121b2e] border border-[#1c2d45] rounded-lg px-3 py-2.5 text-sm text-[#e4ecf7] placeholder-[#3a4f68] focus-accent mb-4 transition-all"
                />
                {error && (
                  <p className="font-mono text-xs text-[#f43a5a] mb-3">{error}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setModal({ phase: "closed" })}
                    className="flex-1 bg-[#121b2e] hover:bg-[#1c2d45] border border-[#1c2d45] text-[#6b82a0] rounded-lg py-2.5 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={loading}
                    className="flex-1 text-[#071a16] rounded-lg py-2.5 text-sm font-bold transition-colors disabled:opacity-50"
                    style={{ background: "#00d4b1" }}
                  >
                    {loading ? "Creating…" : "Create"}
                  </button>
                </div>
              </>
            )}

            {modal.phase === "reveal" && (
              <>
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="font-semibold text-[#e4ecf7]">API Key Created</span>
                  <span
                    className="font-mono text-[10px] px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(240,165,0,0.1)",
                      color: "#f0a500",
                      border: "1px solid rgba(240,165,0,0.2)",
                    }}
                  >
                    SHOWN ONCE
                  </span>
                </div>
                <p className="font-mono text-xs text-[#6b82a0] mb-4">
                  Copy this key now.{" "}
                  <span className="text-[#e4ecf7]">It will not be shown again.</span>
                </p>

                <div className="bg-[#070b12] border border-[#1c2d45] rounded-lg p-3.5 mb-4">
                  <p className="font-mono text-xs text-[#00d4b1] break-all leading-relaxed">
                    {modal.token}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => copyToken(modal.token)}
                    className="flex-1 bg-[#121b2e] hover:bg-[#1c2d45] border border-[#1c2d45] text-[#6b82a0] hover:text-[#e4ecf7] rounded-lg py-2.5 text-sm font-medium transition-all"
                  >
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                  <button
                    onClick={() => setModal({ phase: "closed" })}
                    className="flex-1 text-[#071a16] rounded-lg py-2.5 text-sm font-bold transition-colors"
                    style={{ background: "#00d4b1" }}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
