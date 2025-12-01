// /lib/serviceConfig.ts

/* ------------------------------------------------------
 * Shared option types
 * ---------------------------------------------------- */

export type GenderId = 'male' | 'female' | 'unisex';
export type AgeGroupId = 'kids' | 'adults' | 'all';

export interface SimpleOption<T extends string = string> {
  id: T;
  label: string;
}

/** Who this service is best suited for */
export const GENDER_OPTIONS: SimpleOption<GenderId | 'any'>[] = [
  { id: 'any', label: 'Any' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'unisex', label: 'Unisex' },
];

export const AGE_GROUP_OPTIONS: SimpleOption<AgeGroupId | 'any'>[] = [
  { id: 'any', label: 'Any' },
  { id: 'kids', label: 'Kids' },
  { id: 'adults', label: 'Adults' },
  { id: 'all', label: 'All ages' },
];

/* ------------------------------------------------------
 * Hair-specific shared options
 * ---------------------------------------------------- */

export type HairColorId =
  | 'black'
  | 'brown'
  | 'dark-brown'
  | 'light-brown'
  | 'blonde'
  | 'platinum'
  | 'red'
  | 'copper'
  | 'auburn'
  | 'burgundy'
  | 'grey-silver'
  | 'fashion';

export const HAIR_COLOR_OPTIONS: SimpleOption<HairColorId>[] = [
  { id: 'black', label: 'Black' },
  { id: 'dark-brown', label: 'Dark brown' },
  { id: 'brown', label: 'Brown' },
  { id: 'light-brown', label: 'Light brown' },
  { id: 'blonde', label: 'Blonde' },
  { id: 'platinum', label: 'Platinum / icy' },
  { id: 'red', label: 'Red' },
  { id: 'copper', label: 'Copper' },
  { id: 'auburn', label: 'Auburn' },
  { id: 'burgundy', label: 'Burgundy / wine' },
  { id: 'grey-silver', label: 'Grey / silver' },
  { id: 'fashion', label: 'Fashion colours (blue, pink, etc.)' },
];

export type HairLengthId =
  | 'very-short'
  | 'short'
  | 'medium'
  | 'long'
  | 'extra-long';

export const HAIR_LENGTH_OPTIONS: SimpleOption<HairLengthId>[] = [
  { id: 'very-short', label: 'Very short / fade' },
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
  { id: 'extra-long', label: 'Extra long' },
];

export type HairTextureId = 'straight' | 'wavy' | 'curly' | 'coily';

export const HAIR_TEXTURE_OPTIONS: SimpleOption<HairTextureId>[] = [
  { id: 'straight', label: 'Straight' },
  { id: 'wavy', label: 'Wavy' },
  { id: 'curly', label: 'Curly' },
  { id: 'coily', label: 'Coily / kinky' },
];

/* ------------------------------------------------------
 * Nail-specific shared options
 * ---------------------------------------------------- */

export type NailShapeId =
  | 'square'
  | 'squoval'
  | 'round'
  | 'oval'
  | 'almond'
  | 'coffin'
  | 'ballerina'
  | 'stiletto'
  | 'tapered-square'
  | 'tapered-coffin';

export const NAIL_SHAPE_OPTIONS: SimpleOption<NailShapeId>[] = [
  { id: 'square', label: 'Square' },
  { id: 'squoval', label: 'Squoval' },
  { id: 'round', label: 'Round' },
  { id: 'oval', label: 'Oval' },
  { id: 'almond', label: 'Almond' },
  { id: 'coffin', label: 'Coffin' },
  { id: 'ballerina', label: 'Ballerina' },
  { id: 'stiletto', label: 'Stiletto' },
  { id: 'tapered-square', label: 'Tapered square' },
  { id: 'tapered-coffin', label: 'Tapered coffin' },
];

export type NailLengthId = 'short' | 'medium' | 'long' | 'extra-long';

export const NAIL_LENGTH_OPTIONS: SimpleOption<NailLengthId>[] = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
  { id: 'extra-long', label: 'Extra long' },
];

/* ------------------------------------------------------
 * Category model
 * ---------------------------------------------------- */

export type ServiceFamilyId =
  | 'hair-men'
  | 'hair-women'
  | 'hair-kids'
  | 'nails'
  | 'makeup'
  | 'lashes-brows'
  | 'skin'
  | 'waxing'
  | 'massage'
  | 'bridal'
  | 'other';

export interface ServiceSupportedFacets {
  gender: boolean;
  ageGroup: boolean;
  hairColors: boolean;
  hairLength: boolean;
  hairTexture: boolean;
  nailShapes: boolean;
  nailLength: boolean;
  // later: skin type, occasion, etc.
}

export interface ServiceSubcategory {
  /** Stable ID saved on the video doc */
  id: string;
  /** Human readable label */
  label: string;

  /** Optional default targeting – used to auto-fill filters on upload. */
  defaultGender?: GenderId | 'unisex';
  defaultAgeGroup?: AgeGroupId;

  /** Optional: override supported facets for this specific subcategory */
  supportedFacetsOverride?: Partial<ServiceSupportedFacets>;
}

export interface ServiceCategory {
  id: string;
  label: string;
  family: ServiceFamilyId;
  /** High-level group: Hair / Nails / Makeup / etc. (good for UI sections) */
  groupLabel: string;

  /** Subcategories shown in the upload dropdown */
  subcategories: ServiceSubcategory[];

  /**
   * Which filters make sense for this category.
   * Upload + Filters can use this to show only relevant chips.
   */
  supportedFacets: ServiceSupportedFacets;
}

/* ------------------------------------------------------
 * Concrete categories
 * ---------------------------------------------------- */

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  /* -------------------- Hair – Men / Barber -------------------- */
  {
    id: 'hair-barber-men',
    label: "Men's barber / haircuts",
    family: 'hair-men',
    groupLabel: 'Hair',
    subcategories: [
      {
        id: 'fade',
        label: 'Fades (low / mid / high)',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'taper',
        label: 'Taper cuts',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'buzz-crew',
        label: 'Buzz cut / crew cut',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'afro-shape-up',
        label: 'Afro / shape-up',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'mohawk-fauxhawk',
        label: 'Mohawk / faux hawk',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'classic-styles',
        label: 'Classic styles (part / pompadour / slick back)',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'clean-shave',
        label: 'Clean shave (head)',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'beard-grooming',
        label: 'Beard trim & grooming',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'hair-designs',
        label: 'Hair designs / patterns',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'kids-haircut',
        label: "Boys' haircuts",
        defaultGender: 'male',
        defaultAgeGroup: 'kids',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: false,
      hairLength: true,
      hairTexture: true,
      nailShapes: false,
      nailLength: false,
    },
  },

  /* -------------------- Hair – Women -------------------- */
  {
    id: 'hair-women-general',
    label: "Women's hairstyles",
    family: 'hair-women',
    groupLabel: 'Hair',
    subcategories: [
      // Braids & protective
      {
        id: 'box-braids',
        label: 'Box braids / knotless braids',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'cornrows',
        label: 'Cornrows / stitch lines',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'twists',
        label: 'Twists (Senegalese / Marley / passion)',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'faux-locs',
        label: 'Faux locs / butterfly locs / soft locs',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'fulani',
        label: 'Fulani / feed-in braids',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'boho-braids',
        label: 'Boho / goddess braids',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },

      // Weaves, wigs, extensions
      {
        id: 'sew-in',
        label: 'Sew-in weaves',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'lace-wig',
        label: 'Lace wig installs / frontals',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'quick-weave',
        label: 'Quick weave',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'wig-revamp',
        label: 'Wig revamp / styling',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },

      // Natural hair
      {
        id: 'silk-press',
        label: 'Silk press',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'twist-out',
        label: 'Twist-out / braid-out / rod sets',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'loc-maintenance',
        label: 'Loc maintenance / retouch',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'loc-start',
        label: 'Loc start / starter locs',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },

      // Treatments
      {
        id: 'relaxer',
        label: 'Relaxers / retouch',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'hair-treatments',
        label: 'Treatments (deep conditioning, protein, scalp)',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },

      // Styling / events
      {
        id: 'updos-buns',
        label: 'Updos / buns / ponytails',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'event-styling',
        label: 'Event / bridal styling',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },

      // Color
      {
        id: 'hair-color',
        label: 'Hair color services',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: true,
      hairLength: true,
      hairTexture: true,
      nailShapes: false,
      nailLength: false,
    },
  },

  /* -------------------- Hair – Kids (unisex) -------------------- */
  {
    id: 'hair-kids',
    label: 'Kids hair (unisex)',
    family: 'hair-kids',
    groupLabel: 'Hair',
    subcategories: [
      {
        id: 'kids-braids',
        label: "Kids' braids & cornrows",
        defaultAgeGroup: 'kids',
      },
      {
        id: 'kids-natural',
        label: "Kids' natural hair styling",
        defaultAgeGroup: 'kids',
      },
      {
        id: 'kids-haircut-generic',
        label: "Kids' haircuts",
        defaultAgeGroup: 'kids',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: false, // age is implied as kids
      hairColors: false,
      hairLength: true,
      hairTexture: true,
      nailShapes: false,
      nailLength: false,
    },
  },

  /* -------------------- Nails -------------------- */
  {
    id: 'nails',
    label: 'Nails',
    family: 'nails',
    groupLabel: 'Nails',
    subcategories: [
      {
        id: 'manicure-classic',
        label: 'Classic manicure',
        defaultGender: 'female',
      },
      {
        id: 'manicure-gel',
        label: 'Gel polish manicure',
        defaultGender: 'female',
      },
      {
        id: 'acrylic-extensions',
        label: 'Acrylic extensions',
        defaultGender: 'female',
      },
      {
        id: 'builder-gel',
        label: 'Builder / hard gel extensions',
        defaultGender: 'female',
      },
      {
        id: 'polygel',
        label: 'Polygel / acrygel',
        defaultGender: 'female',
      },
      {
        id: 'dip-powder',
        label: 'Dip powder',
        defaultGender: 'female',
      },
      {
        id: 'nail-art',
        label: 'Nail art (simple / detailed / 3D)',
        defaultGender: 'female',
      },
      {
        id: 'pedicure',
        label: 'Pedicure',
        defaultGender: 'female',
      },
      {
        id: 'spa-pedicure',
        label: 'Spa pedicure',
        defaultGender: 'female',
      },
      {
        id: 'removal',
        label: 'Removal / soak-off',
        defaultGender: 'female',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: false,
      hairLength: false,
      hairTexture: false,
      nailShapes: true,
      nailLength: true,
    },
  },

  /* -------------------- Makeup -------------------- */
  {
    id: 'makeup',
    label: 'Makeup',
    family: 'makeup',
    groupLabel: 'Makeup',
    subcategories: [
      {
        id: 'soft-glam',
        label: 'Soft glam / day makeup',
        defaultGender: 'female',
      },
      {
        id: 'full-glam',
        label: 'Full glam / evening',
        defaultGender: 'female',
      },
      {
        id: 'bridal-makeup',
        label: 'Bridal makeup',
        defaultGender: 'female',
      },
      {
        id: 'photoshoot',
        label: 'Photoshoot / editorial',
        defaultGender: 'female',
      },
      {
        id: 'tv-film',
        label: 'TV / video makeup',
        defaultGender: 'female',
      },
      {
        id: 'sfx',
        label: 'Special effects (SFX)',
        defaultGender: 'unisex',
      },
      {
        id: 'makeup-lessons',
        label: 'Makeup lessons / consults',
        defaultGender: 'female',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: false,
      hairLength: false,
      hairTexture: false,
      nailShapes: false,
      nailLength: false,
    },
  },

  /* -------------------- Lashes & Brows -------------------- */
  {
    id: 'lashes-brows',
    label: 'Lashes & brows',
    family: 'lashes-brows',
    groupLabel: 'Lashes & Brows',
    subcategories: [
      {
        id: 'lash-classic',
        label: 'Classic lash extensions',
        defaultGender: 'female',
      },
      {
        id: 'lash-hybrid',
        label: 'Hybrid lashes',
        defaultGender: 'female',
      },
      {
        id: 'lash-volume',
        label: 'Volume / mega-volume lashes',
        defaultGender: 'female',
      },
      {
        id: 'lash-lift',
        label: 'Lash lift & tint',
        defaultGender: 'female',
      },
      {
        id: 'brow-shaping',
        label: 'Brow shaping (wax / thread / tweeze)',
        defaultGender: 'female',
      },
      {
        id: 'brow-tint',
        label: 'Brow tint',
        defaultGender: 'female',
      },
      {
        id: 'brow-lamination',
        label: 'Brow lamination',
        defaultGender: 'female',
      },
      {
        id: 'brow-microblading',
        label: 'Microblading / ombré brows',
        defaultGender: 'female',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: false,
      hairLength: false,
      hairTexture: false,
      nailShapes: false,
      nailLength: false,
    },
  },

  /* -------------------- Skin / Facials -------------------- */
  {
    id: 'skin-facials',
    label: 'Skincare & facials',
    family: 'skin',
    groupLabel: 'Skin',
    subcategories: [
      {
        id: 'classic-facial',
        label: 'Classic / basic facial',
        defaultGender: 'unisex',
      },
      {
        id: 'deep-cleansing',
        label: 'Deep cleansing / acne facial',
        defaultGender: 'unisex',
      },
      {
        id: 'hydrating',
        label: 'Hydrating facial',
        defaultGender: 'unisex',
      },
      {
        id: 'brightening',
        label: 'Brightening / glow facial',
        defaultGender: 'unisex',
      },
      {
        id: 'anti-aging',
        label: 'Anti-aging facial',
        defaultGender: 'unisex',
      },
      {
        id: 'peel',
        label: 'Chemical peel (light / medium)',
        defaultGender: 'unisex',
      },
      {
        id: 'microderm',
        label: 'Microdermabrasion / dermaplaning',
        defaultGender: 'unisex',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: false,
      hairLength: false,
      hairTexture: false,
      nailShapes: false,
      nailLength: false,
    },
  },

  /* -------------------- Waxing & Hair Removal -------------------- */
  {
    id: 'waxing',
    label: 'Waxing & hair removal',
    family: 'waxing',
    groupLabel: 'Hair removal',
    subcategories: [
      {
        id: 'face-wax',
        label: 'Face (brows / lip / chin / full)',
        defaultGender: 'unisex',
      },
      {
        id: 'underarm',
        label: 'Underarm',
        defaultGender: 'unisex',
      },
      {
        id: 'arms',
        label: 'Arms (half / full)',
        defaultGender: 'unisex',
      },
      {
        id: 'legs',
        label: 'Legs (half / full)',
        defaultGender: 'unisex',
      },
      {
        id: 'bikini',
        label: 'Bikini / Brazilian',
        defaultGender: 'female',
      },
      {
        id: 'torso',
        label: 'Back / chest',
        defaultGender: 'male',
      },
      {
        id: 'full-body',
        label: 'Full body',
        defaultGender: 'unisex',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: false,
      hairLength: false,
      hairTexture: false,
      nailShapes: false,
      nailLength: false,
    },
  },

  /* -------------------- Massage & Body -------------------- */
  {
    id: 'massage-body',
    label: 'Massage & body treatments',
    family: 'massage',
    groupLabel: 'Massage',
    subcategories: [
      {
        id: 'swedish',
        label: 'Swedish massage',
        defaultGender: 'unisex',
      },
      {
        id: 'deep-tissue',
        label: 'Deep tissue massage',
        defaultGender: 'unisex',
      },
      {
        id: 'aromatherapy',
        label: 'Aromatherapy massage',
        defaultGender: 'unisex',
      },
      {
        id: 'hot-stone',
        label: 'Hot stone massage',
        defaultGender: 'unisex',
      },
      {
        id: 'prenatal',
        label: 'Prenatal massage',
        defaultGender: 'female',
      },
      {
        id: 'sports',
        label: 'Sports massage',
        defaultGender: 'unisex',
      },
      {
        id: 'foot-reflex',
        label: 'Foot massage / reflexology',
        defaultGender: 'unisex',
      },
      {
        id: 'body-scrub',
        label: 'Body scrub / exfoliation',
        defaultGender: 'unisex',
      },
      {
        id: 'body-wrap',
        label: 'Body wrap',
        defaultGender: 'unisex',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: false,
      hairLength: false,
      hairTexture: false,
      nailShapes: false,
      nailLength: false,
    },
  },

  /* -------------------- Bridal & Events -------------------- */
  {
    id: 'bridal-events',
    label: 'Bridal & events packages',
    family: 'bridal',
    groupLabel: 'Packages',
    subcategories: [
      {
        id: 'bridal-hair-makeup',
        label: 'Bridal hair + makeup',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'bridal-party',
        label: 'Bridal party packages',
        defaultGender: 'female',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'groom-groomsmen',
        label: 'Groom & groomsmen grooming',
        defaultGender: 'male',
        defaultAgeGroup: 'adults',
      },
      {
        id: 'event-package',
        label: 'Event / photoshoot packages',
        defaultGender: 'unisex',
        defaultAgeGroup: 'adults',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: true,
      hairLength: true,
      hairTexture: true,
      nailShapes: true,
      nailLength: true,
    },
  },

  /* -------------------- Other / Custom -------------------- */
  {
    id: 'other-beauty',
    label: 'Other beauty services',
    family: 'other',
    groupLabel: 'Other',
    subcategories: [
      {
        id: 'custom',
        label: 'Custom service',
        defaultGender: 'unisex',
      },
    ],
    supportedFacets: {
      gender: true,
      ageGroup: true,
      hairColors: false,
      hairLength: false,
      hairTexture: false,
      nailShapes: false,
      nailLength: false,
    },
  },
];

/* ------------------------------------------------------
 * Lookup map by id
 * ---------------------------------------------------- */

export const SERVICE_CATEGORY_BY_ID: Record<string, ServiceCategory> =
  SERVICE_CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = cat;
    return acc;
  }, {} as Record<string, ServiceCategory>);

/* ------------------------------------------------------
 * Helper types for filters / components
 * ---------------------------------------------------- */

// Convenient type aliases so components don't have to re-derive these

export type ServiceCategoryId = (typeof SERVICE_CATEGORIES)[number]['id'];

export type ServiceSubcategoryId = ServiceSubcategory['id'];