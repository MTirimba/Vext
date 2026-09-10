// /workspaces/Vext/lib/whatsapp.ts
//
// Server-side only — never import this from a client component. The API
// key must stay off the browser bundle entirely, same as PAYSTACK_SECRET_KEY
// or the M-Pesa credentials.
//
// WhatsApp requires every business-initiated message to use a pre-approved
// template (no free-form text) — see .env.local.example for what each env
// var maps to on the Infobip portal.
import crypto from "crypto";

interface WhatsAppTemplateHeader {
  type: string; // "TEXT" for a text header with a placeholder; media headers (IMAGE/VIDEO/DOCUMENT/LOCATION) use the fields below instead of placeholder
  placeholder?: string; // fills {{1}} in a TEXT header — required for TEXT, omit otherwise
  mediaUrl?: string; // for IMAGE / VIDEO / DOCUMENT headers
  filename?: string; // for DOCUMENT headers
  latitude?: number; // for LOCATION headers
  longitude?: number;
}

interface WhatsAppTemplateButton {
  type: string; // "QUICK_REPLY" | "URL" | "COPY_CODE" | ...
  parameter: string; // payload / URL-suffix / code — max 128 chars per Infobip's limit
}

interface SendWhatsAppTemplateParams {
  to: string; // recipient phone number, any reasonable format — normalized below
  placeholders: string[]; // fills the template body's {{1}}, {{2}}, ... in order — required by Infobip even if empty
  templateName: string;
  language?: string; // defaults to INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE ("en")
  // Only include these if the registered template actually has a dynamic
  // header and/or buttons — Infobip's docs are explicit that `header`
  // should be omitted entirely unless the template's header has
  // placeholders or media registered, and `buttons` should be omitted
  // unless the template actually has quick-reply/dynamic-URL/copy-code
  // buttons registered.
  header?: WhatsAppTemplateHeader;
  buttons?: WhatsAppTemplateButton[];
}

export interface SendWhatsAppResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

// Infobip's examples use bare digits with country code, no "+" or leading
// zero — e.g. "254707792059". Strip everything else so callers can pass a
// number in whatever format it was stored in (react-phone-number-input
// typically stores "+254...").
function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

export async function sendWhatsAppTemplateMessage({
  to,
  placeholders,
  templateName,
  language,
  header,
  buttons,
}: SendWhatsAppTemplateParams): Promise<SendWhatsAppResult> {
  const apiKey = process.env.INFOBIP_API_KEY;
  const baseUrl = process.env.INFOBIP_BASE_URL; // e.g. "6z39we.api.infobip.com" — unique per account
  const sender = process.env.INFOBIP_WHATSAPP_SENDER; // your registered WhatsApp sender number
  const resolvedLanguage =
    language || process.env.INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE || "en";

  if (!apiKey || !baseUrl || !sender || !templateName) {
    console.warn(
      "sendWhatsAppTemplateMessage: WhatsApp env vars not fully configured — skipping send.",
    );
    return { ok: false, error: "WhatsApp not configured" };
  }

  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) {
    return { ok: false, error: "Invalid recipient phone number" };
  }

  const templateData: Record<string, unknown> = {
    // Required by Infobip even when the template has no body placeholders
    // — pass an empty array in that case, never omit this key.
    body: { placeholders },
  };
  if (header) templateData.header = header;
  if (buttons && buttons.length) templateData.buttons = buttons;

  try {
    const res = await fetch(`https://${baseUrl}/whatsapp/1/message/template`, {
      method: "POST",
      headers: {
        Authorization: `App ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            from: sender,
            to: normalizedTo,
            messageId: crypto.randomUUID(),
            content: {
              templateName,
              templateData,
              language: resolvedLanguage,
            },
          },
        ],
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const reason =
        data?.requestError?.serviceException?.text ||
        data?.messages?.[0]?.status?.description ||
        `Infobip request failed (${res.status})`;
      console.error(`WhatsApp send failed [${templateName}]:`, reason, data);
      return { ok: false, error: reason };
    }

    const messageId = data?.messages?.[0]?.messageId;
    return { ok: true, messageId };
  } catch (err: any) {
    console.error(`WhatsApp send error [${templateName}]:`, err?.message || err);
    return { ok: false, error: err?.message || "Network error" };
  }
}