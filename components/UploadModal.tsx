// /workspaces/Vext/components/UploadModal.tsx
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db, storage } from '../lib/firebase';
import {
  ref,
  getDownloadURL,
  uploadBytesResumable,
  UploadTaskSnapshot,
} from 'firebase/storage';
import { collection, addDoc, updateDoc, doc, getDoc } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';

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

type MediaItem = {
  url: string;
  type: 'image' | 'video';
  name?: string;
};

type Props = {
  /** If omitted (e.g. on /upload), we’ll router.back() after success/cancel */
  onClose?: () => void;
};

const DEFAULT_FACETS: ServiceSupportedFacets = {
  gender: false,
  ageGroup: false,
  hairColors: false,
  hairLength: false,
  hairTexture: false,
  nailShapes: false,
  nailLength: false,
};

// For upload we don’t need the "any" option – they’re describing *this* service.
const UPLOAD_GENDER_OPTIONS = GENDER_OPTIONS.filter((g) => g.id !== 'any');
const UPLOAD_AGE_GROUP_OPTIONS = AGE_GROUP_OPTIONS.filter(
  (a) => a.id !== 'any',
);

export function UploadModal({ onClose }: Props) {
  const router = useRouter();
  const [user] = useAuthState(auth);

  // multiple files
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  // drag-to-reorder
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // progress
  const [uploading, setUploading] = useState(false);
  const [progresses, setProgresses] = useState<number[]>([]); // per-file %

  // basic fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [cost, setCost] = useState<number>(0);
  const [hours, setHours] = useState<number>(0);
  const [minutes, setMinutes] = useState<number>(0);

  // extras / upsells
  const [addonName, setAddonName] = useState('');
  const [addonCost, setAddonCost] = useState<number>(0);
  const [addonUnit, setAddonUnit] = useState('');
  const [addons, setAddons] = useState<Addon[]>([]);

  // booking helpers
  const [specialInstructions, setSpecialInstructions] = useState('');

  // service scope
  const [includes, setIncludes] = useState<string[]>([]);
  const [includesInput, setIncludesInput] = useState('');
  const [notProvided, setNotProvided] = useState<string[]>([]);
  const [notProvidedInput, setNotProvidedInput] = useState('');

  // discovery metadata
  const [categoryId, setCategoryId] = useState<string>('');
  const [subcategoryId, setSubcategoryId] = useState<string>('');
  // NEW: extra subcategories
  const [extraSubcategoryIds, setExtraSubcategoryIds] = useState<string[]>([]);

  const [bestForGender, setBestForGender] = useState<GenderId | ''>('');
  const [bestForAgeGroup, setBestForAgeGroup] = useState<AgeGroupId | ''>('');

  const [hairColorIds, setHairColorIds] = useState<HairColorId[]>([]);
  const [nailShapeIds, setNailShapeIds] = useState<NailShapeId[]>([]);
  const [nailLengthId, setNailLengthId] = useState<NailLengthId | ''>('');

  // provider location (for locationTag)
  const [providerLocationTag, setProviderLocationTag] = useState('');

  // 🚗 mobile/outcall service
  const [providerOffersMobile, setProviderOffersMobile] = useState(false);
  const [availableForMobileService, setAvailableForMobileService] =
    useState(false);

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

  // When category changes, reset subcategory + facet selections
  useEffect(() => {
    if (!selectedCategory) {
      setSubcategoryId('');
      setExtraSubcategoryIds([]);
      setBestForGender('');
      setBestForAgeGroup('');
      setHairColorIds([]);
      setNailShapeIds([]);
      setNailLengthId('');
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

  // When subcategory changes, apply default gender/age if those fields are still blank
  useEffect(() => {
    if (!selectedSubcategory) return;
    if (!bestForGender && selectedSubcategory.defaultGender) {
      setBestForGender(selectedSubcategory.defaultGender);
    }
    if (!bestForAgeGroup && selectedSubcategory.defaultAgeGroup) {
      setBestForAgeGroup(selectedSubcategory.defaultAgeGroup);
    }
  }, [selectedSubcategory, bestForGender, bestForAgeGroup]);

  // Pull provider location from profile (to avoid re-entering location in upload)
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) return;
        const d = snap.data() as any;
        const parts: string[] = [];
        if (d.businessName) parts.push(d.businessName);
        if (d.town) parts.push(d.town);
        if (d.county) parts.push(d.county);
        if (d.location) parts.push(d.location);
        const tag = parts.join(', ');
        if (tag) setProviderLocationTag(tag);
        setProviderOffersMobile(!!d.offersMobileService);
      } catch (err) {
        console.error('profile location fetch error', err);
      }
    })();
  }, [user]);

  // ------------------ helpers for dynamic chips ------------------

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

  // ------------------ helpers for existing features ------------------

  const handleAddAddon = () => {
    const n = addonName.trim();
    const u = addonUnit.trim();
    if (!n || !u || addonCost <= 0) return;
    setAddons((p) => [...p, { name: n, cost: addonCost, unit: u }]);
    setAddonName('');
    setAddonCost(0);
    setAddonUnit('');
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

  // file handling
  const handleFileChange = (list: FileList | null) => {
    const arr = Array.from(list || []);
    setFiles(arr);
    // cleanup old previews
    setPreviews((old) => {
      old.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
    const pv = arr.map((f) => URL.createObjectURL(f));
    setPreviews(pv);
    setProgresses(Array(arr.length).fill(0));
  };

  useEffect(() => {
    return () => {
      previews.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [previews]);

  // drag to reorder
  const onDragStart = (index: number) => setDragIndex(index);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    const nf = [...files];
    const np = [...previews];
    const movedF = nf.splice(dragIndex, 1)[0];
    const movedP = np.splice(dragIndex, 1)[0];
    nf.splice(index, 0, movedF);
    np.splice(index, 0, movedP);
    setFiles(nf);
    setPreviews(np);
    setDragIndex(null);
  };

  const closeOrBack = () => {
    if (onClose) onClose();
    else router.back();
  };

  // ------------------ upload ------------------

  const handleUpload = async () => {
    if (!user || files.length === 0)
      return alert('Select file(s) and sign in.');
    if (!categoryId || !selectedCategory || !selectedSubcategory)
      return alert('Please choose a category and subcategory.');
    if (cost <= 0) return alert('Please enter a valid price.');

    setUploading(true);

    const media: MediaItem[] = [];
    const perFile = [...progresses];

    const uploadOne = (f: File, idx: number) =>
      new Promise<void>((resolve, reject) => {
        const path = `media/${user.uid}/${Date.now()}_${idx}_${f.name}`;
        const task = uploadBytesResumable(ref(storage, path), f);

        task.on(
          'state_changed',
          (snap: UploadTaskSnapshot) => {
            const pct = Math.round(
              (snap.bytesTransferred / snap.totalBytes) * 100,
            );
            perFile[idx] = pct;
            setProgresses([...perFile]);
          },
          (err) => reject(err),
          async () => {
            const url = await getDownloadURL(task.snapshot.ref);
            const type: 'image' | 'video' = f.type.startsWith('image')
              ? 'image'
              : 'video';
            media[idx] = { url, type, name: f.name };
            resolve();
          },
        );
      });

    try {
      // preserve order (respect drag-reorder)
      for (let i = 0; i < files.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await uploadOne(files[i], i);
      }

      const validAddons = addons.filter(
        (a) => a.name && a.unit && a.cost > 0,
      );

      // resolve targeting
      const resolvedGender: GenderId | undefined =
        bestForGender || selectedSubcategory.defaultGender;
      const resolvedAgeGroup: AgeGroupId | undefined =
        bestForAgeGroup || selectedSubcategory.defaultAgeGroup;

      // 🔹 Choose a thumbnail image for social previews / OpenGraph
      const firstImageMedia = media.find((m) => m.type === 'image');
      const primaryMedia = firstImageMedia ?? media[0] ?? null;

      // 🔹 Fallback to a generic OG image in /public if there is no media
      const thumbnailUrl = primaryMedia?.url || '/og-default.png';

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

      const docRef = await addDoc(collection(db, 'videos'), {
        userId: user.uid,
        title: title.trim(),
        description: description.trim(),

        // new discovery metadata
        categoryId,
        categoryLabel: selectedCategory.label,

        // single primary subcategory (backwards compatibility)
        subcategoryId: selectedSubcategory.id,
        subcategoryLabel: selectedSubcategory.label,

        // NEW: multi-subcategory fields
        subcategoryIds: allSubcategoryIds,
        subcategoryLabels: allSubcategoryLabels,

        targetGender: resolvedGender || null,
        targetAgeGroup: resolvedAgeGroup || null,
        hairColors: activeFacets.hairColors ? hairColorIds : [],
        nailShapes: activeFacets.nailShapes ? nailShapeIds : [],
        nailLength: activeFacets.nailLength ? (nailLengthId || null) : null,
        locationTag: providerLocationTag || null,

        // 🚗 mobile/outcall service availability for this specific service.
        // Only ever true if the provider has also enabled it on their profile.
        availableForMobileService:
          providerOffersMobile && availableForMobileService,

        // media
        url: media[0]?.url || '',
        coverUrl: media[0]?.url || '',
        media,
        hasCarousel: media.length > 1,

        // ✨ Thumbnail used for social previews (WhatsApp, FB, X, etc.)
        thumbnailUrl,

        // core service info
        serviceCost: cost,
        timeTaken: { hours, minutes },
        addons: validAddons,
        specialInstructions: specialInstructions.trim() || null,
        serviceIncludes: includes,
        notProvided, // [] is fine; avoid undefined
        createdAt: Date.now(),
      });

      await updateDoc(doc(db, 'videos', docRef.id), { videoId: docRef.id });

      // done → go back/close
      closeOrBack();
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  // overall progress (average)
  const overall =
    progresses.length === 0
      ? 0
      : Math.round(
          progresses.reduce((a, b) => a + b, 0) / progresses.length,
        );

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

  if (!user) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center">
        <div className="bg-white rounded-lg w-[360px] p-6 text-center">
          <h2 className="text-lg font-semibold mb-2">Sign in required</h2>
          <p className="text-sm text-gray-700 mb-4">
            Please sign in to upload your services.
          </p>
          <button
            onClick={closeOrBack}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center">
      <div className="bg-white rounded-lg w-[400px] max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-xl font-semibold mb-4">
          Upload Service Video / Photos
        </h2>

        {/* progress bar */}
        {uploading && (
          <div className="mb-3">
            <div className="h-2 bg-gray-200 rounded">
              <div
                className="h-2 bg-green-600 rounded"
                style={{ width: `${overall}%` }}
              />
            </div>
            <div className="text-xs text-gray-600 mt-1">{overall}%</div>
          </div>
        )}

        <input
          type="file"
          accept="video/*,image/*"
          multiple
          onChange={(e) => handleFileChange(e.target.files)}
          className="mb-3"
        />

        {/* Previews with subtle handle + tooltip */}
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {previews.map((src, i) => {
              const f = files[i];
              const isImage = f?.type.startsWith('image');
              return (
                <div
                  key={`preview-${i}`}
                  className="relative w-full aspect-square rounded overflow-hidden bg-gray-100"
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(i)}
                >
                  {/* media */}
                  {isImage ? (
                    <img
                      src={src}
                      alt={`preview-${i}`}
                      className="w-full h-full object-cover select-none"
                      draggable={false}
                    />
                  ) : (
                    <video
                      src={src}
                      className="w-full h-full object-cover"
                      muted
                    />
                  )}

                  {/* grab handle + tooltip */}
                  <div
                    title="Drag to reorder"
                    className="absolute top-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded cursor-grab"
                  >
                    ≡
                  </div>

                  {/* per-file progress (small ring) */}
                  {uploading && (
                    <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1 py-0.5 rounded">
                      {progresses[i] ?? 0}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Title & description */}
        <input
          className="w-full px-3 py-2 border rounded mb-2"
          placeholder="Service title (e.g., Knotless braids, medium length)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full px-3 py-2 border rounded mb-3"
          placeholder="Short description – what makes this service unique?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Category + subcategory */}
        <div className="space-y-2 mb-3">
          <label className="block text-sm font-medium mb-1">
            Service category*
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
                Service type / subcategory*
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

              {/* NEW: multiple subcategories as chips */}
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
        <div className="flex items-center space-x-2 mb-4">
          <div className="flex items-center">
            <span className="mr-1 font-semibold">KSHS</span>
            <input
              type="number"
              className="w-24 px-2 py-1 border rounded"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value) || 0)}
              placeholder="Price"
              min={0}
            />
          </div>
          <div className="flex items-center space-x-2">
            <label className="flex flex-col text-sm">
              Hrs
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={12}
                className="w-16 px-2 py-1 border rounded text-center"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value) || 0)}
              />
            </label>
            <label className="flex flex-col text-sm">
              Min
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                step={15}
                className="w-16 px-2 py-1 border rounded text-center"
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value) || 0)}
              />
            </label>
          </div>
        </div>

        {/* Special instructions */}
        <label className="block mb-3">
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
          <label className="flex items-start space-x-2 mb-3 p-2 border rounded bg-gray-50">
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

        {/* Discovery facets - only show what makes sense for this category */}
        {selectedCategory && (
          <div className="border rounded-lg p-3 mb-4 space-y-4 bg-gray-50">
            <p className="text-sm font-semibold">
              Help clients discover this service
            </p>

            {activeFacets.gender && (
              <div>
                <p className="text-xs font-medium mb-1">
                  Who is this service best suited for?
                </p>
                <div className="flex flex-wrap gap-2">
                  {UPLOAD_GENDER_OPTIONS.map((g) => (
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
                  {UPLOAD_AGE_GROUP_OPTIONS.map((a) => (
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
        <div className="border rounded p-3 mb-3">
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
        <div className="border rounded p-3 mb-3">
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
          <p className="text-xs text-gray-500 mt-2">
            Use this to set expectations — these items aren’t included and are
            not offered as extras.
          </p>
        </div>

        {/* Extras / Upsells */}
        <div className="border rounded p-3 mb-4">
          <div className="flex justify-between items-center mb-1">
            <h3 className="font-semibold text-sm">Extras (not included)</h3>
            <button
              onClick={handleAddAddon}
              className="text-blue-600 font-bold text-xl leading-none"
              title="Add extra"
              type="button"
            >
              ➕
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Upsells you can provide for an additional fee (charged on top of the
            base price).
          </p>

          {addons.map((a, idx) => (
            <div
              key={`addon-${idx}-${a.name}`}
              className="flex justify-between mb-1 text-sm"
            >
              <span className="flex-1">{a.name}</span>
              <span className="w-20 text-right">
                {Number(a.cost || 0).toFixed(0)}
              </span>
              <span className="ml-1">/ {a.unit}</span>
            </div>
          ))}

          <div className="flex space-x-2 mt-2">
            <input
              type="text"
              className="flex-1 px-2 py-1 border rounded text-sm"
              placeholder="Extra name (e.g., Hair wash)"
              value={addonName}
              onChange={(e) => setAddonName(e.target.value)}
            />
            <input
              type="number"
              className="w-20 px-2 py-1 border rounded text-sm"
              placeholder="Cost"
              value={addonCost}
              onChange={(e) => setAddonCost(Number(e.target.value) || 0)}
            />
            <input
              type="text"
              className="w-20 px-2 py-1 border rounded text-sm"
              placeholder="Unit"
              value={addonUnit}
              onChange={(e) => setAddonUnit(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60 text-sm font-medium"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <button
            onClick={closeOrBack}
            disabled={uploading}
            className="px-4 py-2 bg-gray-200 text-black rounded disabled:opacity-60 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}