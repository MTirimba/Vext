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
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';

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

  // fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');

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

  // derived
  const selectedCategory = useMemo(
    () => (category === 'custom' ? customCategory.trim() : category),
    [category, customCategory]
  );

  // helpers
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

  // upload
  const handleUpload = async () => {
    if (!user || files.length === 0) return alert('Select file(s) and sign in.');
    if (!selectedCategory) return alert('Please select or enter a category.');
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
              (snap.bytesTransferred / snap.totalBytes) * 100
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
          }
        );
      });

    try {
      // preserve order (respect drag-reorder)
      for (let i = 0; i < files.length; i++) {
        await uploadOne(files[i], i);
      }

      const validAddons = addons.filter(
        (a) => a.name && a.unit && a.cost > 0
      );

      const docRef = await addDoc(collection(db, 'videos'), {
        userId: user.uid,
        title: title.trim(),
        description: description.trim(),
        category: selectedCategory,
        url: media[0]?.url || '',
        coverUrl: media[0]?.url || '',
        media,
        hasCarousel: media.length > 1,
        serviceCost: cost,
        timeTaken: { hours, minutes },
        addons: validAddons,
        specialInstructions: specialInstructions.trim() || null,
        serviceIncludes: includes,
        notProvided: notProvided, // [] is fine; avoid undefined
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
      : Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center">
      <div className="bg-white rounded-lg w-[380px] max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-xl font-semibold mb-4">Upload Service Video / Photos</h2>

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
                  key={i}
                  className="relative w-full aspect-square rounded overflow-hidden bg-gray-100"
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(i)}
                >
                  {/* media */}
                  {isImage ? (
                    <img src={src} alt={`preview-${i}`} className="w-full h-full object-cover select-none" draggable={false} />
                  ) : (
                    <video src={src} className="w-full h-full object-cover" muted />
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

        <input
          className="w-full px-3 py-2 border rounded mb-2"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full px-3 py-2 border rounded mb-3"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Category + custom */}
        <div className="space-y-2 mb-3">
          <select
            className="w-full px-3 py-2 border rounded"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Select Category</option>
            <option value="male-haircut">Male Haircut</option>
            <option value="kids-haircut">Kids Haircut</option>
            <option value="dreadlocks-retouch">Dreadlocks Retouch</option>
            <option value="braiding">Braiding</option>
            <option value="nails">Nails</option>
            <option value="makeup">Makeup</option>
            <option value="custom">— Custom (type below) —</option>
          </select>

          {category === 'custom' && (
            <input
              className="w-full px-3 py-2 border rounded"
              placeholder="Type custom category"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
            />
          )}
        </div>

        <div className="flex items-center space-x-2 mb-4">
          <div className="flex items-center">
            <span className="mr-1 font-semibold">KSHS</span>
            <input
              type="number"
              className="w-24 px-2 py-1 border rounded"
              value={cost}
              onChange={(e) => setCost(+e.target.value)}
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
                onChange={(e) => setHours(+e.target.value)}
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
                onChange={(e) => setMinutes(+e.target.value)}
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
            className="w-full px-3 py-2 border rounded"
            placeholder="E.g., Arrive 10 minutes early, bring previous hairstyle reference, etc."
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
          />
        </label>

        {/* Service includes */}
        <div className="border rounded p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Service includes</h3>
          </div>
          {includes.length > 0 && (
            <ul className="mb-2 list-disc list-inside text-sm">
              {includes.map((it, idx) => (
                <li key={idx} className="flex items-center justify-between">
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
              className="flex-1 px-2 py-1 border rounded"
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
              className="px-3 py-1 rounded bg-gray-800 text-white"
            >
              Add
            </button>
          </div>
        </div>

        {/* Not provided */}
        <div className="border rounded p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Not provided</h3>
          </div>
          {notProvided.length > 0 && (
            <ul className="mb-2 list-disc list-inside text-sm">
              {notProvided.map((it, idx) => (
                <li key={idx} className="flex items-center justify-between">
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
              className="flex-1 px-2 py-1 border rounded"
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
              className="px-3 py-1 rounded bg-gray-800 text-white"
            >
              Add
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Use this to set expectations — these items aren’t included and are not offered as extras.
          </p>
        </div>

        {/* Extras / Upsells */}
        <div className="border rounded p-3 mb-4">
          <div className="flex justify-between items-center mb-1">
            <h3 className="font-semibold">Extras (not included)</h3>
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
            Upsells you can provide for an additional fee (charged on top of the base price).
          </p>

          {addons.map((a, idx) => (
            <div key={idx} className="flex justify-between mb-1 text-sm">
              <span className="flex-1">{a.name}</span>
              <span className="w-20 text-right">{a.cost.toFixed(0)}</span>
              <span className="ml-1">/ {a.unit}</span>
            </div>
          ))}

          <div className="flex space-x-2 mt-2">
            <input
              type="text"
              className="flex-1 px-2 py-1 border rounded"
              placeholder="Extra name (e.g., Hair wash)"
              value={addonName}
              onChange={(e) => setAddonName(e.target.value)}
            />
            <input
              type="number"
              className="w-20 px-2 py-1 border rounded"
              placeholder="Cost"
              value={addonCost}
              onChange={(e) => setAddonCost(+e.target.value)}
            />
            <input
              type="text"
              className="w-20 px-2 py-1 border rounded"
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
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <button
            onClick={closeOrBack}
            disabled={uploading}
            className="px-4 py-2 bg-gray-200 text-black rounded disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}