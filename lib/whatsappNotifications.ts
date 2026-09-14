// /workspaces/Vext/lib/whatsappNotifications.ts
//
// One function per booking-lifecycle WhatsApp template. Each mirrors the
// exact placeholder order registered on the Infobip template — if you ever
// edit a template's wording/placeholder order in the portal, update the
// matching function here to keep them in sync.
//
// Update REGISTERED_TEMPLATES below as you get each one approved — this
// short-circuits calls to anything not yet live instead of burning trial
// message quota on a guaranteed rejection.
import { sendWhatsAppTemplateMessage, type SendWhatsAppResult } from "@/lib/whatsapp";

const REGISTERED_TEMPLATES = new Set<string>([
  "new_booking_provider",
  "booking_confirmed_client",
  "booking_received_client",
  "booking_declined_client",
  "booking_cancelled_provider",
  "booking_reminder_client",
  "booking_reminder_provider",
  "service_completed",
]);

async function sendIfRegistered(
  templateName: string,
  params: Omit<Parameters<typeof sendWhatsAppTemplateMessage>[0], "templateName">,
): Promise<SendWhatsAppResult> {
  if (!REGISTERED_TEMPLATES.has(templateName)) {
    console.info(
      `WhatsApp: skipping "${templateName}" — not yet registered/approved on Infobip.`,
    );
    return { ok: false, error: "Template not yet registered" };
  }
  return sendWhatsAppTemplateMessage({ templateName, ...params });
}

interface BookingCore {
  bookingId: string;
  serviceName: string;
  date: string;
  time: string;
}

// 1. New booking — notifies the provider right when a booking is created.
export function sendNewBookingProviderNotification(
  params: BookingCore & { providerPhone: string; providerName: string; clientName: string },
) {
  return sendIfRegistered("new_booking_provider", {
    to: params.providerPhone,
    placeholders: [
      params.providerName,
      params.clientName,
      params.serviceName,
      params.date,
      params.time,
    ],
    buttons: [{ type: "URL", parameter: params.bookingId }],
  });
}

// 2. Booking confirmed — notifies the client once payment is confirmed.
export function sendBookingConfirmedClientNotification(
  params: BookingCore & { clientPhone: string; clientName: string; providerName: string },
) {
  return sendIfRegistered("booking_confirmed_client", {
    to: params.clientPhone,
    placeholders: [
      params.clientName,
      params.serviceName,
      params.providerName,
      params.date,
      params.time,
    ],
    buttons: [{ type: "URL", parameter: params.bookingId }],
  });
}

// 3. Booking received — notifies the client immediately after they create
// a booking, before the provider has responded or payment is confirmed.
export function sendBookingReceivedClientNotification(
  params: BookingCore & { clientPhone: string; clientName: string; providerName: string },
) {
  return sendIfRegistered("booking_received_client", {
    to: params.clientPhone,
    placeholders: [
      params.clientName,
      params.serviceName,
      params.providerName,
      params.date,
      params.time,
    ],
  });
}

// 4. Booking declined — notifies the client when a provider rejects.
export function sendBookingDeclinedClientNotification(params: {
  clientPhone: string;
  clientName: string;
  serviceName: string;
  providerName: string;
}) {
  return sendIfRegistered("booking_declined_client", {
    to: params.clientPhone,
    placeholders: [params.clientName, params.serviceName, params.providerName],
  });
}

// 5. Booking cancelled — notifies the provider when a client cancels.
export function sendBookingCancelledProviderNotification(
  params: BookingCore & { providerPhone: string; providerName: string; clientName: string },
) {
  return sendIfRegistered("booking_cancelled_provider", {
    to: params.providerPhone,
    placeholders: [
      params.providerName,
      params.clientName,
      params.serviceName,
      params.date,
      params.time,
    ],
  });
}

// 6. Booking reminder — client, ~24h before the appointment.
export function sendBookingReminderClientNotification(
  params: BookingCore & { clientPhone: string; clientName: string; providerName: string },
) {
  return sendIfRegistered("booking_reminder_client", {
    to: params.clientPhone,
    placeholders: [
      params.clientName,
      params.serviceName,
      params.providerName,
      params.date,
      params.time,
    ],
  });
}

// 7. Booking reminder — provider, ~24h before the appointment.
export function sendBookingReminderProviderNotification(
  params: BookingCore & { providerPhone: string; providerName: string; clientName: string },
) {
  return sendIfRegistered("booking_reminder_provider", {
    to: params.providerPhone,
    placeholders: [
      params.providerName,
      params.clientName,
      params.serviceName,
      params.date,
      params.time,
    ],
  });
}

// 8. Service completed — notifies the client once the provider verifies
// completion with the PIN.
export function sendServiceCompletedNotification(params: {
  clientPhone: string;
  clientName: string;
  serviceName: string;
}) {
  return sendIfRegistered("service_completed", {
    to: params.clientPhone,
    placeholders: [params.clientName, params.serviceName],
  });
}