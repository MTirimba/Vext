// /workspaces/Vext/lib/mpesaCallbackSecret.ts
import { NextResponse } from "next/server";

/**
 * Safaricom's Daraja API has no HMAC/signature scheme for callbacks (unlike
 * Paystack's webhook, which we verify with an HMAC signature). The standard
 * workaround is to embed a shared secret as a query param in the callback
 * URL we register with Safaricom, and check it on every incoming callback.
 *
 * Set MPESA_CALLBACK_SECRET in your environment to a long random string,
 * e.g. generate one with: openssl rand -hex 32
 */
export function appendCallbackSecret(url: string): string {
  const secret = process.env.MPESA_CALLBACK_SECRET;
  if (!secret) {
    console.error(
      "[mpesaCallbackSecret] MPESA_CALLBACK_SECRET is not set — callback URL " +
        "will NOT be protected. Set this env var before going live.",
    );
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}key=${encodeURIComponent(secret)}`;
}

/**
 * Verifies the ?key= query param on an incoming M-Pesa callback request
 * against MPESA_CALLBACK_SECRET. Returns null if valid, or a ready-to-return
 * NextResponse if invalid/missing.
 *
 * NOTE: we still return Safaricom's expected { ResultCode, ResultDesc } JSON
 * shape even on rejection, since a malformed/unexpected response can cause
 * Safaricom's infra to retry aggressively — but we use a 401 status so it's
 * clearly distinguishable in logs from a real accepted callback.
 */
export function verifyCallbackSecret(req: Request): NextResponse | null {
  const secret = process.env.MPESA_CALLBACK_SECRET;

  // If no secret is configured, we can't verify — log loudly but don't
  // block (that would break the flow entirely until env is set). Once you
  // set MPESA_CALLBACK_SECRET, this check becomes fully enforced.
  if (!secret) {
    console.error(
      "[mpesaCallbackSecret] MPESA_CALLBACK_SECRET is not set — accepting " +
        "callback WITHOUT verification. Set this env var to secure this endpoint.",
    );
    return null;
  }

  const url = new URL(req.url);
  const provided = url.searchParams.get("key");

  if (!provided || provided !== secret) {
    console.warn(
      "[mpesaCallbackSecret] Rejected callback with invalid/missing key",
    );
    return NextResponse.json(
      { ResultCode: 1, ResultDesc: "Rejected" },
      { status: 401 },
    );
  }

  return null;
}