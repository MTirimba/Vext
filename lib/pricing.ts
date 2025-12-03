// /workspaces/Vext/lib/pricing.ts

export type MarkupTier = {
  /** Minimum base price (inclusive) for this tier, in KSHS. */
  min: number;
  /** Maximum base price (exclusive). null/undefined means "no upper limit". */
  max?: number | null;
  /** Percentage markup applied in this tier, e.g. 10 for 10%. */
  percent: number;
};

export const DEFAULT_MARKUP_TIERS: MarkupTier[] = [
  { min: 0, max: 1500, percent: 10 },
  { min: 1500, max: 5000, percent: 5 },
  { min: 5000, max: 10000, percent: 2.5 },
  { min: 10000, max: null, percent: 2 },
];

/**
 * Normalises and sorts tiers coming from Firestore / config.
 */
export function parseMarkupTiers(raw: any): MarkupTier[] {
  if (!Array.isArray(raw)) return DEFAULT_MARKUP_TIERS;

  const cleaned: MarkupTier[] = raw
    .map((t) => ({
      min: Number(t?.min ?? 0),
      max:
        t?.max === null || t?.max === undefined
          ? null
          : Number(t.max),
      percent: Number(t?.percent ?? 0),
    }))
    .filter(
      (t) =>
        Number.isFinite(t.min) &&
        Number.isFinite(t.percent),
    );

  if (!cleaned.length) return DEFAULT_MARKUP_TIERS;

  cleaned.sort((a, b) => a.min - b.min);
  return cleaned;
}

/**
 * Returns the markup percent that applies to a given base price.
 */
export function getMarkupPercentForBase(
  basePrice: number,
  tiers?: MarkupTier[],
): number {
  const price = Math.max(0, Number(basePrice) || 0);
  const list = (tiers && tiers.length ? tiers : DEFAULT_MARKUP_TIERS)
    .slice()
    .sort((a, b) => a.min - b.min);

  const tier = list.find(
    (t) =>
      price >= t.min &&
      (t.max === null || t.max === undefined || price < t.max),
  );

  return tier ? tier.percent : 0;
}

/**
 * Computes client-facing price + which percent was applied.
 */
export function computeClientPriceFromBase(
  basePrice: number,
  tiers?: MarkupTier[],
): { clientPrice: number; markupPercent: number } {
  const price = Math.max(0, Number(basePrice) || 0);
  const percent = getMarkupPercentForBase(price, tiers);
  const factor = 1 + percent / 100;
  const clientPrice = Math.round(price * factor);
  return { clientPrice, markupPercent: percent };
}