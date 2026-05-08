"use client";

import { useState } from "react";

const AMOUNTS = ["5", "20", "50", "100"] as const;
type Amount = (typeof AMOUNTS)[number];

export default function TopUpButton() {
  const [selected, setSelected] = useState<Amount>("20");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTopUp() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: selected }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to start checkout");
      setLoading(false);
      return;
    }
    // Redirect to Stripe Checkout
    window.location.href = data.url;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Amount picker */}
      <div className="flex gap-2">
        {AMOUNTS.map((amt) => (
          <button
            key={amt}
            onClick={() => setSelected(amt)}
            className="flex-1 font-mono text-xs py-2 rounded-lg border transition-all"
            style={
              selected === amt
                ? {
                    background: "rgba(0,212,177,0.12)",
                    borderColor: "rgba(0,212,177,0.4)",
                    color: "#00d4b1",
                  }
                : {
                    background: "#121b2e",
                    borderColor: "#1c2d45",
                    color: "#6b82a0",
                  }
            }
          >
            ${amt}
          </button>
        ))}
      </div>

      {error && (
        <p className="font-mono text-[10px] text-[#f43a5a]">{error}</p>
      )}

      <button
        onClick={handleTopUp}
        disabled={loading}
        className="w-full font-mono text-sm font-bold py-2.5 rounded-lg transition-all disabled:opacity-50"
        style={{ background: "#00d4b1", color: "#071a16" }}
      >
        {loading ? "Redirecting…" : `Add $${selected} →`}
      </button>

      <p className="font-mono text-[10px] text-[#3a4f68] text-center">
        Secured by Stripe · One-time payment
      </p>
    </div>
  );
}
