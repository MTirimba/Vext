// /lib/serviceFilters.ts

import {
  GENDER_OPTIONS,
  AGE_GROUP_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  HAIR_TEXTURE_OPTIONS,
  NAIL_SHAPE_OPTIONS,
  NAIL_LENGTH_OPTIONS,
  SERVICE_CATEGORIES as RAW_SERVICE_CATEGORIES,
  type GenderId,
  type AgeGroupId,
  type ServiceCategory,
  type ServiceCategoryId,
  type SimpleOption,
} from './serviceConfig';

export type Gender = GenderId;
export type AgeGroup = AgeGroupId;

export type TraitId = string;

export interface TraitOption {
  id: TraitId; // e.g. "hairColor_blonde"
  label: string; // e.g. "Blonde / white"
}

export interface TraitGroup {
  id: string; // e.g. "hairColor"
  label: string; // e.g. "Hair colour"
  multi: boolean; // true = multi select chips
  options: TraitOption[];
}

export interface CategoryConfig {
  /** Matches ServiceCategory.id from serviceConfig */
  id: ServiceCategoryId;
  label: string;

  /** Optional implied targeting at category level (subcategories can be more specific). */
  impliedGender?: Gender;
  impliedAgeGroup?: AgeGroup;

  /** Which trait groups to show in Upload / Filters UI for this category. */
  traitGroupIds: string[];
}

/* ------------------------------------------------------
 * Helpers to map SimpleOption -> TraitOption
 * ---------------------------------------------------- */

function mapSimpleOptionsToTraitOptions<T extends string>(
  prefix: string,
  options: SimpleOption<T>[],
): TraitOption[] {
  return options.map((opt) => ({
    id: `${prefix}_${opt.id}`,
    label: opt.label,
  }));
}

/* ------------------------------------------------------
 * Master trait groups (re-usable across categories)
 * ---------------------------------------------------- */

export const TRAIT_GROUPS: Record<string, TraitGroup> = {
  hairColor: {
    id: 'hairColor',
    label: 'Hair colour',
    multi: true,
    options: mapSimpleOptionsToTraitOptions('hairColor', HAIR_COLOR_OPTIONS),
  },

  hairLength: {
    id: 'hairLength',
    label: 'Hair length',
    multi: true,
    options: mapSimpleOptionsToTraitOptions('hairLength', HAIR_LENGTH_OPTIONS),
  },

  hairTexture: {
    id: 'hairTexture',
    label: 'Hair texture',
    multi: true,
    options: mapSimpleOptionsToTraitOptions('hairTexture', HAIR_TEXTURE_OPTIONS),
  },

  nailShape: {
    id: 'nailShape',
    label: 'Nail shape',
    multi: true,
    options: mapSimpleOptionsToTraitOptions('nailShape', NAIL_SHAPE_OPTIONS),
  },

  nailLength: {
    id: 'nailLength',
    label: 'Nail length',
    multi: false,
    options: mapSimpleOptionsToTraitOptions('nailLength', NAIL_LENGTH_OPTIONS),
  },

  makeupOccasion: {
    id: 'makeupOccasion',
    label: 'Makeup occasion',
    multi: true,
    options: [
      { id: 'makeupOccasion_bridal', label: 'Bridal' },
      { id: 'makeupOccasion_event', label: 'Events / shoots' },
      { id: 'makeupOccasion_casual', label: 'Casual / daytime' },
      { id: 'makeupOccasion_editorial', label: 'Editorial / creative' },
    ],
  },
};

/* ------------------------------------------------------
 * Category config derived from serviceConfig.SERVICE_CATEGORIES
 * ---------------------------------------------------- */

/**
 * Simple heuristics to infer a "default" gender / age per category.
 * Subcategories may be more specific; this is just a top-level hint.
 */
function inferImpliedGender(cat: ServiceCategory): Gender | undefined {
  if (cat.family === 'hair-men') return 'male';
  if (cat.family === 'hair-women') return 'female';
  if (cat.family === 'hair-kids') return 'unisex';
  if (cat.family === 'nails') return 'female';
  return undefined;
}

function inferImpliedAge(cat: ServiceCategory): AgeGroup | undefined {
  if (cat.family === 'hair-kids') return 'kids';
  return undefined;
}

/**
 * Derive which trait groups apply to a category based on its supportedFacets.
 * You can tweak this mapping as you evolve the product.
 */
function traitGroupsForCategory(cat: ServiceCategory): string[] {
  const ids: string[] = [];

  if (cat.supportedFacets.hairColors) ids.push('hairColor');
  if (cat.supportedFacets.hairLength) ids.push('hairLength');
  if (cat.supportedFacets.hairTexture) ids.push('hairTexture');
  if (cat.supportedFacets.nailShapes) ids.push('nailShape');
  if (cat.supportedFacets.nailLength) ids.push('nailLength');

  // Makeup-specific extra facet
  if (cat.family === 'makeup') {
    ids.push('makeupOccasion');
  }

  return ids;
}

/**
 * Filter categories meta used by Upload modal and filters.
 * IDs here match ServiceCategory.id from serviceConfig.
 */
export const SERVICE_CATEGORIES: CategoryConfig[] =
  RAW_SERVICE_CATEGORIES.map((cat) => ({
    id: cat.id as ServiceCategoryId,
    label: cat.label,
    impliedGender: inferImpliedGender(cat),
    impliedAgeGroup: inferImpliedAge(cat),
    traitGroupIds: traitGroupsForCategory(cat),
  }));

/* ------------------------------------------------------
 * Lookups & helpers for components
 * ---------------------------------------------------- */

export function getCategoryConfig(id?: string | null): CategoryConfig | null {
  if (!id) return null;
  return SERVICE_CATEGORIES.find((c) => c.id === id) || null;
}

export function getTraitGroupsForCategory(id?: string | null): TraitGroup[] {
  const cfg = getCategoryConfig(id);
  if (!cfg) return [];
  return cfg.traitGroupIds
    .map((gid) => TRAIT_GROUPS[gid])
    .filter(Boolean);
}

/**
 * All trait groups (deduped) – useful for a global filter modal
 * if you ever want to list everything in one place.
 */
export function getAllTraitGroups(): TraitGroup[] {
  const seen = new Set<string>();
  const out: TraitGroup[] = [];
  SERVICE_CATEGORIES.forEach((cat) => {
    cat.traitGroupIds.forEach((gid) => {
      if (!seen.has(gid) && TRAIT_GROUPS[gid]) {
        seen.add(gid);
        out.push(TRAIT_GROUPS[gid]);
      }
    });
  });
  return out;
}

/* ------------------------------------------------------
 * Re-exported gender/age options for convenience
 * ---------------------------------------------------- */

export const FILTER_GENDER_OPTIONS = GENDER_OPTIONS;
export const FILTER_AGE_GROUP_OPTIONS = AGE_GROUP_OPTIONS;