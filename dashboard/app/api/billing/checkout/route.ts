import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

// Preset top-up amounts in USD cents
const TOP_UP_AMOUNTS: Record<string, number> = {
  "5":   500,
  "20":  2000,
  "50":  5000,
  "100": 10000,
};

// POST /api/billing/checkout
// Creates a Stripe Checkout session for a wallet top-up.
// On success Stripe redirects to /dashboard?topup=success.
export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: "Payments not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const amountKey: string = String(body.amount ?? "20");
  const amountCents = TOP_UP_AMOUNTS[amountKey];

  if (!amountCents) {
    return NextResponse.json(
      { error: `Invalid amount. Choose one of: ${Object.keys(TOP_UP_AMOUNTS).join(", ")}` },
      { status: 400 }
    );
  }

  const stripe = new Stripe(stripeKey);
  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: "Agent Gateway Credits",
            description: `$${amountKey}.00 wallet top-up — Proof-of-Execution billing`,
          },
        },
      },
    ],
    // developer_id is embedded so the webhook can credit the right wallet
    metadata: { developer_id: user.id, amount_usd: amountKey },
    success_url: `${origin}/dashboard?topup=success&amount=${amountKey}`,
    cancel_url: `${origin}/dashboard?topup=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
