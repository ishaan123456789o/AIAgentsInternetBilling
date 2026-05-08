"use client";

type Developer = {
  wallet_balance: number;
};

type Transaction = {
  amount_usd: number;
  verification_score: number;
  latency_ms: number;
  created_at: string;
};

type Props = {
  developer: Developer;
  transactions: Transaction[];
};

type CardVariant = "teal" | "amber" | "red" | "muted";

function StatCard({
  label,
  value,
  sub,
  valueColor,
  variant = "muted",
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  variant?: CardVariant;
}) {
  const glowClass =
    variant === "teal" ? "card-glow-teal" :
    variant === "amber" ? "card-glow-amber" :
    variant === "red" ? "card-glow-red" :
    "card-glow-muted";

  const accentGlow =
    variant === "teal" ? "rgba(0,212,177,0.06)" :
    variant === "amber" ? "rgba(240,165,0,0.06)" :
    variant === "red" ? "rgba(244,58,90,0.06)" :
    "transparent";

  return (
    <div
      className={`bg-[#0d1421] border border-[#1c2d45] rounded-2xl p-5 relative overflow-hidden ${glowClass}`}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-16 pointer-events-none"
        style={{ background: `linear-gradient(to right, ${accentGlow}, transparent)` }}
      />
      <p className="font-mono text-[10px] text-[#3a4f68] uppercase tracking-[0.18em] mb-3">
        {label}
      </p>
      <p
        className="font-mono text-2xl font-semibold tracking-tight"
        style={{ color: valueColor ?? "#e4ecf7" }}
      >
        {value}
      </p>
      {sub && (
        <p className="font-mono text-[10px] text-[#3a4f68] mt-2">{sub}</p>
      )}
    </div>
  );
}

export default function StatsRow({ developer, transactions }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const todayTxns = transactions.filter((t) => t.created_at.startsWith(today));

  const totalSpent = transactions
    .reduce((sum, t) => sum + Number(t.amount_usd), 0)
    .toFixed(6);

  const avgScoreNum =
    transactions.length === 0
      ? null
      : transactions.reduce((sum, t) => sum + Number(t.verification_score), 0) /
        transactions.length;

  const avgLatency =
    transactions.length === 0
      ? "—"
      : Math.round(
          transactions.reduce((sum, t) => sum + t.latency_ms, 0) / transactions.length
        ) + " ms";

  const balance = Number(developer.wallet_balance);
  const walletVariant: CardVariant =
    balance > 1 ? "teal" : balance > 0 ? "amber" : "red";
  const walletColor =
    balance > 1 ? "#00d4b1" : balance > 0 ? "#f0a500" : "#f43a5a";

  const rateVariant: CardVariant =
    avgScoreNum === null ? "muted" :
    avgScoreNum >= 0.8 ? "teal" :
    avgScoreNum >= 0.6 ? "amber" : "muted";
  const rateColor =
    avgScoreNum === null ? "#e4ecf7" :
    avgScoreNum >= 0.8 ? "#00d4b1" :
    avgScoreNum >= 0.6 ? "#f0a500" : "#e4ecf7";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Wallet Balance"
        value={`$${balance.toFixed(4)}`}
        sub="Prepaid credits (USD)"
        valueColor={walletColor}
        variant={walletVariant}
      />
      <StatCard
        label="Total Spend"
        value={`$${totalSpent}`}
        sub={`${transactions.length} verified executions`}
        variant="muted"
      />
      <StatCard
        label="Avg PoE Score"
        value={avgScoreNum === null ? "—" : avgScoreNum.toFixed(3)}
        sub={`${todayTxns.length} verified today`}
        valueColor={rateColor}
        variant={rateVariant}
      />
      <StatCard
        label="Avg Latency"
        value={avgLatency}
        sub="End-to-end via gateway"
        variant="muted"
      />
    </div>
  );
}
