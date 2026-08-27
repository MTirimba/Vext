// /workspaces/Vext/lib/logistics.ts
//
// Distance-based logistics/travel fee for housecall (mobile) bookings.
// One platform-wide rate (set in the `config/pricing` Firestore doc, same
// place the markup tiers live) — providers don't set their own, so there's
// nothing for a client and provider to negotiate before booking.

export type LogisticsConfig = {
  /** Flat fee charged regardless of distance, in KSHS. */
  baseFee: number;
  /** Additional fee per km of straight-line distance, in KSHS. */
  perKmRate: number;
  /** Floor on the total logistics fee, in KSHS. */
  minFee: number;
  /** Ceiling on the total logistics fee, in KSHS. Null/undefined = no cap. */
  maxFee?: number | null;
  /**
   * Charged instead of the distance formula when the provider has no pinned
   * location to measure from (common for mobile-only providers who skipped
   * the optional "general area" pin).
   */
  noProviderLocationFallbackFee: number;
};

export const DEFAULT_LOGISTICS_CONFIG: LogisticsConfig = {
  baseFee: 100,
  perKmRate: 30,
  minFee: 100,
  maxFee: 1500,
  noProviderLocationFallbackFee: 300,
};

export function parseLogisticsConfig(raw: any): LogisticsConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_LOGISTICS_CONFIG;

  const num = (v: any, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  return {
    baseFee: num(raw.baseFee, DEFAULT_LOGISTICS_CONFIG.baseFee),
    perKmRate: num(raw.perKmRate, DEFAULT_LOGISTICS_CONFIG.perKmRate),
    minFee: num(raw.minFee, DEFAULT_LOGISTICS_CONFIG.minFee),
    maxFee:
      raw.maxFee === null || raw.maxFee === undefined
        ? DEFAULT_LOGISTICS_CONFIG.maxFee
        : num(raw.maxFee, DEFAULT_LOGISTICS_CONFIG.maxFee ?? 0),
    noProviderLocationFallbackFee: num(
      raw.noProviderLocationFallbackFee,
      DEFAULT_LOGISTICS_CONFIG.noProviderLocationFallbackFee,
    ),
  };
}

/** Straight-line (haversine) distance between two coordinates, in km. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius, km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface LogisticsFeeResult {
  fee: number;
  distanceKm: number | null;
  usedFallback: boolean;
}

/**
 * Computes the logistics fee for a housecall booking. Used identically on
 * the client (for the live estimate shown before payment) and the server
 * (as the authoritative, never-trust-the-client charge) — same inputs
 * always produce the same fee.
 */
export function computeLogisticsFee(params: {
  providerLat: number | null | undefined;
  providerLng: number | null | undefined;
  clientLat: number | null | undefined;
  clientLng: number | null | undefined;
  config?: LogisticsConfig;
}): LogisticsFeeResult {
  const cfg = params.config ?? DEFAULT_LOGISTICS_CONFIG;

  const hasProviderLocation =
    typeof params.providerLat === 'number' &&
    typeof params.providerLng === 'number';
  const hasClientLocation =
    typeof params.clientLat === 'number' &&
    typeof params.clientLng === 'number';

  if (!hasProviderLocation || !hasClientLocation) {
    return {
      fee: Math.round(cfg.noProviderLocationFallbackFee),
      distanceKm: null,
      usedFallback: true,
    };
  }

  const distanceKm = haversineKm(
    params.providerLat as number,
    params.providerLng as number,
    params.clientLat as number,
    params.clientLng as number,
  );

  let fee = cfg.baseFee + cfg.perKmRate * distanceKm;
  fee = Math.max(fee, cfg.minFee);
  if (typeof cfg.maxFee === 'number') fee = Math.min(fee, cfg.maxFee);

  return {
    fee: Math.round(fee),
    distanceKm: Math.round(distanceKm * 10) / 10,
    usedFallback: false,
  };
}