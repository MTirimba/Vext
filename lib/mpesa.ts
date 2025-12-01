import axios from "axios";

const consumerKey = process.env.MPESA_CONSUMER_KEY!;
const consumerSecret = process.env.MPESA_CONSUMER_SECRET!;
const shortcode = process.env.MPESA_SHORTCODE!; // B2C shortcode from Safaricom
const initiatorName = process.env.MPESA_INITIATOR!;
const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL!; // Encrypted

const baseURL = "https://sandbox.safaricom.co.ke";

export async function generateToken() {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const response = await axios.get(`${baseURL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  return response.data.access_token;
}

export async function sendB2C({ phone, amount }: { phone: string; amount: number }) {
  const token = await generateToken();

  const res = await axios.post(
    `${baseURL}/mpesa/b2c/v1/paymentrequest`,
    {
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: "BusinessPayment", // Or SalaryPayment/PromotionPayment
      Amount: amount,
      PartyA: shortcode,
      PartyB: phone, // 2547XXXXXXXX
      Remarks: "Vextup Payout",
      QueueTimeOutURL: process.env.MPESA_TIMEOUT_URL,
      ResultURL: process.env.MPESA_RESULT_URL,
      Occasion: "Payout",
    },
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  return res.data;
}
