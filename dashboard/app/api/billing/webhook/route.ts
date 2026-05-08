import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";

// POST /api/billing/webhook
// Receives Stripe webhook events. Only processes checkout.session.completed.
// Must be registered in your Stripe dashboard pointing at /api/billing/webhook.
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET  (from `stripe listen` or dashboard webhook secret)
export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: "Payments not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(stripeKey);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: `Webhook signature invalid: ${err}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Only credit wallets for paid sessions
    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true });
    }

    const developerId = session.metadata?.developer_id;
    const amountUsd = session.metadata?.amount_usd;

    if (!developerId || !amountUsd) {
      console.error("Webhook missing metadata — session:", session.id);
      return NextResponse.json({ error: "Missing metadata" }, { status: 422 });
    }

    const admin = createAdminClient();
    const { error } = await admin.rpc("add_wallet_credits", {
      p_developer_id: developerId,
      p_amount: Number(amountUsd),
    });

    if (error) {
      console.error("Failed to credit wallet for developer", developerId, error);
      // Return 500 so Stripe retries the webhook
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`Credited $${amountUsd} to developer ${developerId}`);
  }

  return NextResponse.json({ received: true });
}
