// /workspaces/Vext/components/ServiceFiltersDropdown.tsx
'use client';

import React from 'react';
import { FaTimes } from 'react-icons/fa';
import {
  SERVICE_CATEGORIES,
  HAIR_COLOR_OPTIONS,
  NAIL_SHAPE_OPTIONS,
  NAIL_LENGTH_OPTIONS,
  GENDER_OPTIONS,
  AGE_GROUP_OPTIONS,
  type GenderId,
  type AgeGroupId,
  type HairColorId,
  type NailShapeId,
  type NailLengthId,
} from '@/lib/serviceConfig';

// Infer CategoryId from SERVICE_CATEGORIES so we don't depend
// on a missing export.
type CategoryId = (typeof SERVICE_CATEGORIES)[number]['id'];

export type FilterGender = GenderId | 'any';
export type FilterAgeGroup = AgeGroupId | 'any';
export type FilterNailLength = NailLengthId | 'any';

export interface FeedFilters {
  gender: FilterGender;
  ageGroup: FilterAgeGroup;
  location: string;
  categories: CategoryId[];
  hairColors: HairColorId[];
  nailShapes: NailShapeId[];
  nailLength: FilterNailLength;
}

interface Props {
  open: boolean;
  value: FeedFilters;
  onChange: (next: FeedFilters) => void;
  onClose: () => void;
  onClear: () => void;
}

const FILTER_GENDER_OPTIONS = GENDER_OPTIONS; // includes 'any'
const FILTER_AGE_GROUP_OPTIONS = AGE_GROUP_OPTIONS; // includes 'any'
const FILTER_NAIL_LENGTH_OPTIONS: { id: FilterNailLength; label: string }[] = [
  { id: 'any', label: 'Any' },
  ...NAIL_LENGTH_OPTIONS,
];

export default function ServiceFiltersDropdown({
  open,
  value,
  onChange,
  onClose,
  onClear,
}: Props) {
  if (!open) return null;

  const toggleCategory = (id: CategoryId) => {
    const exists = value.categories.includes(id);
    const categories = exists
      ? value.categories.filter((c) => c !== id)
      : [...value.categories, id];
    onChange({ ...value, categories });
  };

  const toggleHairColor = (id: HairColorId) => {
    const exists = value.hairColors.includes(id);
    const hairColors = exists
      ? value.hairColors.filter((c) => c !== id)
      : [...value.hairColors, id];
    onChange({ ...value, hairColors });
  };

  const toggleNailShape = (id: NailShapeId) => {
    const exists = value.nailShapes.includes(id);
    const nailShapes = exists
      ? value.nailShapes.filter((c) => c !== id)
      : [...value.nailShapes, id];
    onChange({ ...value, nailShapes });
  };

  const setGender = (id: FilterGender) => {
    onChange({ ...value, gender: id });
  };

  const setAgeGroup = (id: FilterAgeGroup) => {
    onChange({ ...value, ageGroup: id });
  };

  const setNailLength = (id: FilterNailLength) => {
    onChange({ ...value, nailLength: id });
  };

  const setLocation = (location: string) => {
    onChange({ ...value, location });
  };

  return (
    <div className="absolute top-12 right-3 z-[60] w-[90vw] max-w-md">
      <div className="bg-white text-gray-900 rounded-xl shadow-xl p-4 border border-gray-200 max-h-[75vh] overflow-y-auto relative">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-500 hover:text-gray-800 text-lg"
          aria-label="Close filters"
        >
          <FaTimes />
        </button>

        <h2 className="text-base font-semibold mb-3 pr-7">Filter services</h2>

        {/* Category */}
        <div className="mb-4">
          <p className="text-sm font-medium mb-1">Service category</p>
          <div className="flex flex-wrap gap-2">
            {SERVICE_CATEGORIES.map((c) => {
              const selected = value.categories.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCategory(c.id)}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    selected
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-800 border-gray-300'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Gender */}
        <div className="mb-4">
          <p className="text-sm font-medium mb-1">Gender</p>
          <div className="flex flex-wrap gap-2">
            {FILTER_GENDER_OPTIONS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGender(g.id as FilterGender)}
                className={`px-3 py-1 rounded-full text-xs border ${
                  value.gender === g.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-800 border-gray-300'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* Age group */}
        <div className="mb-4">
          <p className="text-sm font-medium mb-1">Age group</p>
          <div className="flex flex-wrap gap-2">
            {FILTER_AGE_GROUP_OPTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgeGroup(a.id as FilterAgeGroup)}
                className={`px-3 py-1 rounded-full text-xs border ${
                  value.ageGroup === a.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-800 border-gray-300'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hair colour */}
        <div className="mb-4">
          <p className="text-sm font-medium mb-1">Hair colour</p>
          <div className="flex flex-wrap gap-2">
            {HAIR_COLOR_OPTIONS.map((c) => {
              const selected = value.hairColors.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleHairColor(c.id)}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    selected
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-800 border-gray-300'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Nail shape */}
        <div className="mb-4">
          <p className="text-sm font-medium mb-1">Nail shape</p>
          <div className="flex flex-wrap gap-2">
            {NAIL_SHAPE_OPTIONS.map((s) => {
              const selected = value.nailShapes.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleNailShape(s.id)}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    selected
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-800 border-gray-300'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Nail length */}
        <div className="mb-4">
          <p className="text-sm font-medium mb-1">Nail length</p>
          <div className="flex flex-wrap gap-2">
            {FILTER_NAIL_LENGTH_OPTIONS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setNailLength(l.id as FilterNailLength)}
                className={`px-3 py-1 rounded-full text-xs border ${
                  value.nailLength === l.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-800 border-gray-300'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Location */}
        <div className="mb-5">
          <p className="text-sm font-medium mb-1">
            Service provider location
          </p>
          <input
            type="text"
            value={value.location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., Westlands, Nairobi"
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            We match against the provider&apos;s town/county, business name,
            and any location tag they added.
          </p>
        </div>

        <div className="flex justify-between gap-3">
          <button
            type="button"
            onClick={onClear}
            className="px-3 py-2 rounded-lg text-sm border border-gray-300 text-gray-800 hover:bg-gray-100 flex-1"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm bg-gray-900 text-white hover:bg-black flex-1"
          >
            Apply filters
          </button>
        </div>
      </div>
    </div>
  );
}