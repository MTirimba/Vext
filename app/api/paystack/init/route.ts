import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { email, amount, metadata } = await req.json();

    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) throw new Error("Missing Paystack secret key");

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        currency: "KES",
        metadata,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Paystack init failed");

    return NextResponse.json({
      reference: data.data.reference,
      authorization_url: data.data.authorization_url,
    });
  } catch (error: any) {
    console.error("Paystack init error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}