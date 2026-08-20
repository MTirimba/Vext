// /workspaces/Vext/components/EditVideoModal.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

import {
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_BY_ID,
  HAIR_COLOR_OPTIONS,
  NAIL_SHAPE_OPTIONS,
  NAIL_LENGTH_OPTIONS,
  AGE_GROUP_OPTIONS,
  GENDER_OPTIONS,
  type ServiceCategory,
  type ServiceSubcategory,
  type ServiceSupportedFacets,
  type GenderId,
  type AgeGroupId,
  type HairColorId,
  type NailShapeId,
  type NailLengthId,
} from '@/lib/serviceConfig';

interface Addon {
  name: string;
  cost: number;
  unit: string;
}

const DEFAULT_FACETS: ServiceSupportedFacets = {
  gender: false,
  ageGroup: false,
  hairColors: false,
  hairLength: false,
  hairTexture: false,
  nailShapes: false,
  nailLength: false,
};

// For edit we mirror upload: no "any" option for gender/age.
const EDIT_GENDER_OPTIONS = GENDER_OPTIONS.filter((g) => g.id !== 'any');
const EDIT_AGE_GROUP_OPTIONS = AGE_GROUP_OPTIONS.filter((a) => a.id !== 'any');

export function EditVideoModal({
  video,
  onClose,
  onSaved,
}: {
  video: any;
  onClose: () => void;
  onSaved?: () => void;
}) {
  // basic fields
  const [title, setTitle] = useState<string>(video.title || '');
  const [description, setDescription] = useState<string>(
    video.description || '',
  );
  const [cost, setCost] = useState<number>(video.serviceCost || 0);
  const [hours, setHours] = useState<number>(video.timeTaken?.hours || 0);
  const [minutes, setMinutes] = useState<number>(video.timeTaken?.minutes || 0);

  // extras / upsells
  const [addons, setAddons] = useState<Addon[]>(video.addons || []);
  const [addonName, setAddonName] = useState('');
  const [addonCost, setAddonCost] = useState(0);
  const [addonUnit, setAddonUnit] = useState('');
  // index of the addon currently being edited, or null when adding a new one
  const [editingAddonIndex, setEditingAddonIndex] = useState<number | null>(
    null,
  );

  // 🚗 mobile/outcall service — only shown if the owning provider has
  // enabled this on their profile
  const [providerOffersMobile, setProviderOffersMobile] = useState(false);
  const [availableForMobileService, setAvailableForMobileService] =
    useState<boolean>(!!video.availableForMobileService);

  useEffect(() => {
    if (!video?.userId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', video.userId));
        if (!snap.exists()) return;
        const d = snap.data() as any;
        setProviderOffersMobile(!!d.offersMobileService);
      } catch (err) {
        console.error('EditVideoModal: failed to load provider profile', err);
      }
    })();
  }, [video?.userId]);

  // booking helpers
  const [specialInstructions, setSpecialInstructions] = useState<string>(
    video.specialInstructions || '',
  );

  // service scope
  const [includes, setIncludes] = useState<string[]>(
    video.serviceIncludes || [],
  );
  const [includesInput, setIncludesInput] = useState('');
  const [notProvided, setNotProvided] = useState<string[]>(
    video.notProvided || [],
  );
  const [notProvidedInput, setNotProvidedInput] = useState('');

  // discovery metadata
  const [categoryId, setCategoryId] = useState<string>(
    video.categoryId || '',
  );
  const [subcategoryId, setSubcategoryId] = useState<string>(
    video.subcategoryId || '',
  );

  // NEW: extra subcategories for this service
  const [extraSubcategoryIds, setExtraSubcategoryIds] = useState<string[]>(() => {
    const raw = (video.subcategoryIds as string[]) || [];
    const primary = video.subcategoryId as string | undefined;
    if (!primary) return raw || [];
    return raw.filter((id) => id && id !== primary);
  });

  const [bestForGender, setBestForGender] = useState<GenderId | ''>(
    (video.targetGender as GenderId) || '',
  );
  const [bestForAgeGroup, setBestForAgeGroup] = useState<AgeGroupId | ''>(
    (video.targetAgeGroup as AgeGroupId) || '',
  );

  const [hairColorIds, setHairColorIds] = useState<HairColorId[]>(
    (video.hairColors as HairColorId[]) || [],
  );
  const [nailShapeIds, setNailShapeIds] = useState<NailShapeId[]>(
    (video.nailShapes as NailShapeId[]) || [],
  );
  const [nailLengthId, setNailLengthId] = useState<NailLengthId | ''>(
    (video.nailLength as NailLengthId) || '',
  );

  // ------------------ derive category + facets ------------------

  const selectedCategory: ServiceCategory | null = useMemo(
    () => (categoryId ? SERVICE_CATEGORY_BY_ID[categoryId] || null : null),
    [categoryId],
  );

  const subcategories: ServiceSubcategory[] =
    selectedCategory?.subcategories ?? [];

  const selectedSubcategory: ServiceSubcategory | null = useMemo(
    () => subcategories.find((s) => s.id === subcategoryId) || null,
    [subcategories, subcategoryId],
  );

  const activeFacets: ServiceSupportedFacets = useMemo(() => {
    if (!selectedCategory) return { ...DEFAULT_FACETS };
    let facets: ServiceSupportedFacets = {
      ...DEFAULT_FACETS,
      ...selectedCategory.supportedFacets,
    };
    if (selectedSubcategory?.supportedFacetsOverride) {
      facets = { ...facets, ...selectedSubcategory.supportedFacetsOverride };
    }
    return facets;
  }, [selectedCategory, selectedSubcategory]);

  // When category changes, reset subcategory + keep extras valid
  useEffect(() => {
    if (!selectedCategory) {
      setSubcategoryId('');
      setExtraSubcategoryIds([]);
      // do not automatically clear facet choices to avoid surprises
      return;
    }

    // default to first subcategory if none selected
    if (!subcategoryId && selectedCategory.subcategories.length > 0) {
      setSubcategoryId(selectedCategory.subcategories[0].id);
    }

    // keep extras in range of this category
    setExtraSubcategoryIds((prev) =>
      prev.filter((id) =>
        selectedCategory.subcategories.some((s) => s.id === id),
      ),
    );
  }, [selectedCategory, subcategoryId]);

  // When subcategory changes, apply default gender/age if still blank
  useEffect(() => {
    if (!selectedSubcategory) return;
    if (!bestForGender && selectedSubcategory.defaultGender) {
      setBestForGender(selectedSubcategory.defaultGender);
    }
    if (!bestForAgeGroup && selectedSubcategory.defaultAgeGroup) {
      setBestForAgeGroup(selectedSubcategory.defaultAgeGroup);
    }
  }, [selectedSubcategory, bestForGender, bestForAgeGroup]);

  // ------------------ helpers ------------------

  const toggleHairColor = (id: HairColorId) => {
    setHairColorIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  };

  const toggleNailShape = (id: NailShapeId) => {
    setNailShapeIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  };

  const toggleExtraSubcategory = (id: string) => {
    setExtraSubcategoryIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const handleSaveAddon = () => {
    const trimmedName = addonName.trim();
    const trimmedUnit = addonUnit.trim();
    if (!trimmedName || !trimmedUnit || addonCost <= 0) return;

    if (editingAddonIndex !== null) {
      // Editing an existing addon — replace it in place
      setAddons((prev) =>
        prev.map((a, idx) =>
          idx === editingAddonIndex
            ? { name: trimmedName, cost: addonCost, unit: trimmedUnit }
            : a,
        ),
      );
      setEditingAddonIndex(null);
    } else {
      // Adding a new addon
      setAddons((prev) => [
        ...prev,
        { name: trimmedName, cost: addonCost, unit: trimmedUnit },
      ]);
    }

    setAddonName('');
    setAddonCost(0);
    setAddonUnit('');
  };

  const startEditAddon = (idx: number) => {
    const a = addons[idx];
    if (!a) return;
    setAddonName(a.name);
    setAddonCost(a.cost);
    setAddonUnit(a.unit);
    setEditingAddonIndex(idx);
  };

  const cancelEditAddon = () => {
    setEditingAddonIndex(null);
    setAddonName('');
    setAddonCost(0);
    setAddonUnit('');
  };

  const removeAddon = (idx: number) => {
    setAddons((prev) => prev.filter((_, i) => i !== idx));
    // if the addon being removed was mid-edit, reset the edit form too
    if (editingAddonIndex === idx) cancelEditAddon();
  };

  const addInclude = () => {
    const t = includesInput.trim();
    if (!t) return;
    setIncludes((p) => [...p, t]);
    setIncludesInput('');
  };
  const removeInclude = (i: number) =>
    setIncludes((p) => p.filter((_, idx) => idx !== i));

  const addNotProvided = () => {
    const t = notProvidedInput.trim();
    if (!t) return;
    setNotProvided((p) => [...p, t]);
    setNotProvidedInput('');
  };
  const removeNotProvided = (i: number) =>
    setNotProvided((p) => p.filter((_, idx) => idx !== i));

  // ------------------ save ------------------

  const handleSave = async () => {
    const validAddons = addons.filter(
      (a) => a.name && a.unit && a.cost > 0,
    );

    const payload: any = {
      title: title.trim(),
      description: description.trim(),
      serviceCost: cost,
      timeTaken: { hours, minutes },
      addons: validAddons,
      specialInstructions: specialInstructions.trim() || null,
      serviceIncludes: includes,
      notProvided,
      // 🚗 Only ever true if the provider still has this enabled on their profile
      availableForMobileService: providerOffersMobile && availableForMobileService,
    };

    if (categoryId && selectedCategory && selectedSubcategory) {
      const resolvedGender: GenderId | undefined =
        bestForGender || selectedSubcategory.defaultGender;
      const resolvedAgeGroup: AgeGroupId | undefined =
        bestForAgeGroup || selectedSubcategory.defaultAgeGroup;

      // multi-subcategory support: primary + extras
      const allSubcategoryIdsRaw = [
        selectedSubcategory.id,
        ...extraSubcategoryIds,
      ];
      const allSubcategoryIds = Array.from(
        new Set(allSubcategoryIdsRaw.filter(Boolean)),
      ) as string[];

      const allSubcategoryLabels = allSubcategoryIds.map((id) => {
        const sub = subcategories.find((s) => s.id === id);
        return sub?.label || id;
      });

      payload.categoryId = categoryId;
      payload.categoryLabel = selectedCategory.label;
      // keep single fields for backwards compatibility
      payload.subcategoryId = selectedSubcategory.id;
      payload.subcategoryLabel = selectedSubcategory.label;
      // new array fields
      payload.subcategoryIds = allSubcategoryIds;
      payload.subcategoryLabels = allSubcategoryLabels;

      payload.targetGender = resolvedGender || null;
      payload.targetAgeGroup = resolvedAgeGroup || null;
      payload.hairColors = activeFacets.hairColors ? hairColorIds : [];
      payload.nailShapes = activeFacets.nailShapes ? nailShapeIds : [];
      payload.nailLength = activeFacets.nailLength
        ? nailLengthId || null
        : null;
    }

    await updateDoc(doc(db, 'videos', video.id), payload);

    onClose();
    onSaved?.();
  };

  // group categories by groupLabel for nicer dropdown
  const categoriesByGroup = useMemo(() => {
    const map = new Map<string, ServiceCategory[]>();
    for (const cat of SERVICE_CATEGORIES) {
      const key = cat.groupLabel || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(cat);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-70 flex items-center justify-center">
      <div className="bg-white text-black p-6 rounded-lg w-[380px] max-h-[90vh] overflow-y-auto space-y-4">
        <h2 className="text-xl font-semibold">Edit Service Details</h2>

        {/* Title & description */}
        <input
          className="w-full px-3 py-2 border rounded text-black"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full px-3 py-2 border rounded text-black"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Category + subcategory */}
        <div className="space-y-2">
          <label className="block text-sm font-medium mb-1">
            Service category
          </label>
          <select
            className="w-full px-3 py-2 border rounded text-sm"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Select category…</option>
            {categoriesByGroup.map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {selectedCategory && (
            <>
              <label className="block text-sm font-medium mb-1">
                Service type / subcategory
              </label>
              <select
                className="w-full px-3 py-2 border rounded text-sm"
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
              >
                {subcategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.label}
                  </option>
                ))}
              </select>

              {/* Extra subcategories */}
              {subcategories.length > 1 && (
                <div className="mt-2">
                  <p className="text-xs font-medium mb-1">
                    Also fits under (optional)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {subcategories.map((sub) => {
                      if (sub.id === subcategoryId) return null; // skip primary
                      const checked = extraSubcategoryIds.includes(sub.id);
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => toggleExtraSubcategory(sub.id)}
                          className={`px-3 py-1 rounded-full text-xs border ${
                            checked
                              ? 'bg-gray-900 text-white border-gray-900'
                              : 'bg-white text-gray-800 border-gray-300'
                          }`}
                        >
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Price + duration */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center">
            <span className="mr-1 font-semibold">KSHS</span>
            <input
              type="number"
              className="w-24 px-2 py-1 border rounded text-black"
              value={cost}
              onChange={(e) => setCost(+e.target.value || 0)}
              placeholder="Price"
              min={0}
            />
          </div>
          <div className="flex items-center space-x-2">
            <label className="flex flex-col text-sm">
              Hrs
              <input
                type="number"
                min={0}
                max={12}
                className="w-16 px-2 py-1 border rounded text-black text-center"
                value={hours}
                onChange={(e) => setHours(+e.target.value || 0)}
              />
            </label>
            <label className="flex flex-col text-sm">
              Min
              <input
                type="number"
                min={0}
                max={59}
                step={15}
                className="w-16 px-2 py-1 border rounded text-black text-center"
                value={minutes}
                onChange={(e) => setMinutes(+e.target.value || 0)}
              />
            </label>
          </div>
        </div>

        {/* Special instructions */}
        <label className="block">
          <span className="block text-sm font-medium mb-1">
            Special instructions (shown to client during booking)
          </span>
          <textarea
            className="w-full px-3 py-2 border rounded text-sm"
            placeholder="E.g., Arrive 10 minutes early, bring reference photos, etc."
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
          />
        </label>

        {/* 🚗 Mobile / outcall service availability — only shown if the
            provider has enabled this on their profile */}
        {providerOffersMobile && (
          <label className="flex items-start space-x-2 p-2 border rounded bg-gray-50">
            <input
              type="checkbox"
              className="mt-1"
              checked={availableForMobileService}
              onChange={(e) => setAvailableForMobileService(e.target.checked)}
            />
            <span className="text-sm">
              Available for housecall / outcall — clients booking this
              service can request that you come to them.
            </span>
          </label>
        )}

        {/* Discovery facets */}
        {selectedCategory && (
          <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
            <p className="text-sm font-semibold">
              Help clients discover this service
            </p>

            {activeFacets.gender && (
              <div>
                <p className="text-xs font-medium mb-1">
                  Who is this service best suited for?
                </p>
                <div className="flex flex-wrap gap-2">
                  {EDIT_GENDER_OPTIONS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() =>
                        setBestForGender((prev) =>
                          prev === (g.id as GenderId) ? '' : (g.id as GenderId),
                        )
                      }
                      className={`px-3 py-1 rounded-full text-xs border ${
                        bestForGender === g.id
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-800 border-gray-300'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeFacets.ageGroup && (
              <div>
                <p className="text-xs font-medium mb-1">
                  Age group (optional)
                </p>
                <div className="flex flex-wrap gap-2">
                  {EDIT_AGE_GROUP_OPTIONS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        setBestForAgeGroup((prev) =>
                          prev === (a.id as AgeGroupId)
                            ? ''
                            : (a.id as AgeGroupId),
                        )
                      }
                      className={`px-3 py-1 rounded-full text-xs border ${
                        bestForAgeGroup === a.id
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-800 border-gray-300'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeFacets.hairColors && (
              <div>
                <p className="text-xs font-medium mb-1">Hair colours used</p>
                <div className="flex flex-wrap gap-2">
                  {HAIR_COLOR_OPTIONS.map((hc) => (
                    <button
                      key={hc.id}
                      type="button"
                      onClick={() => toggleHairColor(hc.id)}
                      className={`px-3 py-1 rounded-full text-xs border ${
                        hairColorIds.includes(hc.id)
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-800 border-gray-300'
                      }`}
                    >
                      {hc.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeFacets.nailShapes && (
              <div>
                <p className="text-xs font-medium mb-1">
                  Nail shape (examples in this service)
                </p>
                <div className="flex flex-wrap gap-2">
                  {NAIL_SHAPE_OPTIONS.map((ns) => (
                    <button
                      key={ns.id}
                      type="button"
                      onClick={() => toggleNailShape(ns.id)}
                      className={`px-3 py-1 rounded-full text-xs border ${
                        nailShapeIds.includes(ns.id)
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-800 border-gray-300'
                      }`}
                    >
                      {ns.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeFacets.nailLength && (
              <div>
                <p className="text-xs font-medium mb-1">
                  Nail length (most examples)
                </p>
                <div className="flex flex-wrap gap-2">
                  {NAIL_LENGTH_OPTIONS.map((nl) => (
                    <button
                      key={nl.id}
                      type="button"
                      onClick={() =>
                        setNailLengthId((prev) =>
                          prev === nl.id ? '' : nl.id,
                        )
                      }
                      className={`px-3 py-1 rounded-full text-xs border ${
                        nailLengthId === nl.id
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-800 border-gray-300'
                      }`}
                    >
                      {nl.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Service includes */}
        <div className="border rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Service includes</h3>
          </div>
          {includes.length > 0 && (
            <ul className="mb-2 list-disc list-inside text-sm">
              {includes.map((it, idx) => (
                <li
                  key={`include-${idx}-${it}`}
                  className="flex items-center justify-between"
                >
                  <span>{it}</span>
                  <button
                    type="button"
                    className="text-xs text-red-600 ml-2"
                    onClick={() => removeInclude(idx)}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex space-x-2">
            <input
              type="text"
              className="flex-1 px-2 py-1 border rounded text-sm"
              placeholder="e.g., Wash & blow-dry"
              value={includesInput}
              onChange={(e) => setIncludesInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addInclude();
                }
              }}
            />
            <button
              type="button"
              onClick={addInclude}
              className="px-3 py-1 rounded bg-gray-800 text-white text-sm"
            >
              Add
            </button>
          </div>
        </div>

        {/* Not provided */}
        <div className="border rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Not provided</h3>
          </div>
          {notProvided.length > 0 && (
            <ul className="mb-2 list-disc list-inside text-sm">
              {notProvided.map((it, idx) => (
                <li
                  key={`notProvided-${idx}-${it}`}
                  className="flex items-center justify-between"
                >
                  <span>{it}</span>
                  <button
                    type="button"
                    className="text-xs text-red-600 ml-2"
                    onClick={() => removeNotProvided(idx)}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex space-x-2">
            <input
              type="text"
              className="flex-1 px-2 py-1 border rounded text-sm"
              placeholder="e.g., Hair dyeing, dreadlock install"
              value={notProvidedInput}
              onChange={(e) => setNotProvidedInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addNotProvided();
                }
              }}
            />
            <button
              type="button"
              onClick={addNotProvided}
              className="px-3 py-1 rounded bg-gray-800 text-white text-sm"
            >
              Add
            </button>
          </div>
        </div>

        {/* Add-ons / extras */}
        <div className="border rounded p-3">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-sm">Add-ons / Extras</h3>
          </div>

          {addons.length > 0 && (
            <div className="space-y-1 mb-2">
              {addons.map((a, idx) => (
                <div
                  key={`addon-${idx}-${a.name}`}
                  className={`flex items-center justify-between text-sm p-1.5 rounded ${
                    editingAddonIndex === idx ? 'bg-blue-50' : ''
                  }`}
                >
                  <span className="flex-1">{a.name}</span>
                  <span className="w-20 text-right">
                    {Number(a.cost || 0).toFixed(0)}
                  </span>
                  <span className="ml-1 mr-2">/ {a.unit}</span>
                  <button
                    type="button"
                    className="text-xs text-blue-600 ml-1"
                    onClick={() => startEditAddon(idx)}
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-600 ml-2"
                    onClick={() => removeAddon(idx)}
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex space-x-2 mt-2">
            <input
              type="text"
              className="flex-1 px-2 py-1 border rounded text-sm"
              placeholder="Addon name"
              value={addonName}
              onChange={(e) => setAddonName(e.target.value)}
            />
            <input
              type="number"
              className="w-20 px-2 py-1 border rounded text-sm"
              placeholder="Cost"
              value={addonCost}
              onChange={(e) => setAddonCost(+e.target.value || 0)}
            />
            <input
              type="text"
              className="w-20 px-2 py-1 border rounded text-sm"
              placeholder="Unit"
              value={addonUnit}
              onChange={(e) => setAddonUnit(e.target.value)}
            />
          </div>
          <div className="flex space-x-2 mt-2">
            <button
              type="button"
              onClick={handleSaveAddon}
              className="flex-1 px-3 py-1 rounded bg-blue-600 text-white text-sm"
            >
              {editingAddonIndex !== null ? 'Save addon' : 'Add addon'}
            </button>
            {editingAddonIndex !== null && (
              <button
                type="button"
                onClick={cancelEditAddon}
                className="px-3 py-1 rounded bg-gray-200 text-black text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Save Changes
        </button>
        <button
          onClick={onClose}
          className="w-full py-2 bg-gray-200 text-black rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}