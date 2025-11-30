// /app/api/pesapal/submit-order/route.ts
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

const PESA_ENV = "sandbox"; // change to "live" for production

const BASE_URL =
  PESA_ENV === "sandbox"
    ? "https://cybqa.pesapal.com/pesapalv3"
    : "https://pay.pesapal.com/v3";

const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY!;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET!;
const PESAPAL_IPN_ID = process.env.PESAPAL_IPN_ID!; // store from IPN registration

export async function POST(req: NextRequest) {
  try {
    const { amount, email, firstName, lastName, phoneNumber } = await req.json();

    if (!amount || !email) {
      return NextResponse.json(
        { error: "Missing required fields (amount, email)" },
        { status: 400 }
      );
    }

    // 1️⃣ Authenticate to get token
    const authRes = await fetch(`${BASE_URL}/api/Auth/RequestToken`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        consumer_key: PESAPAL_CONSUMER_KEY,
        consumer_secret: PESAPAL_CONSUMER_SECRET,
      }),
    });

    const authData = await authRes.json();
    if (!authRes.ok) throw new Error(authData.message || "Auth failed");

    const token = authData.token;

    // 2️⃣ Create order request body
    const orderTrackingId = uuidv4(); // unique per transaction

    const orderBody = {
      id: orderTrackingId,
      currency: "KES",
      amount: amount,
      description: "VextUp Service Payment",
      callback_url: "http://localhost:3000/api/pesapal/callback", // your local callback
      notification_id: PESAPAL_IPN_ID, // from register-ipn
      billing_address: {
        email_address: email,
        phone_number: phoneNumber || "",
        country_code: "KE",
        first_name: firstName || "Customer",
        middle_name: "",
        last_name: lastName || "",
        line_1: "",
        line_2: "",
        city: "",
        state: "",
        postal_code: "",
        zip_code: "",
      },
    };

    // 3️⃣ Submit order to Pesapal
    const orderRes = await fetch(`${BASE_URL}/api/Transactions/SubmitOrderRequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
    });

    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      throw new Error(orderData.error?.message || "Order creation failed");
    }

    // 4️⃣ Return redirect URL and tracking info
    return NextResponse.json({
      success: true,
      message: "Order created successfully",
      redirect_url: orderData.redirect_url,
      tracking_id: orderTrackingId,
      orderData,
    });
  } catch (error: any) {
    console.error("❌ Pesapal Submit Order Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
