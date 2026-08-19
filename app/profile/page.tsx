// /workspaces/Vext/app/profile/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { auth, db, storage } from '../../lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import LocationPicker from '@/components/LocationPicker';

type DayMinutes = { start: string; end: string }; // "HH:mm" 24h
type BusinessHours = Partial<Record<number, DayMinutes>>; // 0=Sun..6=Sat

const DAY_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function toBusinessHoursFromLegacy(d: any): BusinessHours {
  const out: BusinessHours = {};
  // New shape already present?
  if (d?.businessHours && typeof d.businessHours === 'object') {
    Object.keys(d.businessHours).forEach(k => {
      const di = Number(k);
      const v = d.businessHours[k];
      if (v?.start && v?.end) out[di] = { start: v.start, end: v.end };
    });
    return out;
  }
  // Legacy: operatingDays + openTime/closeTime
  if (Array.isArray(d?.operatingDays) && d?.openTime && d?.closeTime) {
    d.operatingDays.forEach((di:number) => {
      out[di] = { start: d.openTime, end: d.closeTime };
    });
    return out;
  }
  // Legacy: operatingHours string (we can’t reliably parse; leave empty)
  return out;
}

// --- handle sanitiser: lowercases, removes spaces, keeps only a-z0-9_. ---
function normalizeHandleInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')           // remove spaces
    .replace(/[^a-z0-9_.]/g, '');  // allow letters, numbers, underscore, dot
}

function normalizeHandleForMapping(value: string): string {
  return value.trim().toLowerCase();
}

// ---- username -> usernames collection mapping ----
// Claims a personal username: /usernames/{handleLower} -> { uid }
async function claimUsername(handleRaw: string, uid: string) {
  const handle = normalizeHandleForMapping(handleRaw);
  if (!handle) throw new Error('Username is required');

  const refDoc = doc(db, 'usernames', handle);
  try {
    // Firestore rules should allow create only if !exists(handle)
    await setDoc(refDoc, { uid });
  } catch (err: any) {
    console.error('claimUsername error', err);
    // In practice you'll most often see "permission-denied" if it already exists.
    if (err?.code === 'permission-denied') {
      throw new Error('That username is already taken. Please choose another one.');
    }
    throw new Error('Could not claim username. Please try again.');
  }
}

// ---- businessUsername -> businessUsernames mapping ----
// Claims a business username: /businessUsernames/{handleLower} -> { uid }
async function claimBusinessUsername(handleRaw: string, uid: string) {
  const handle = normalizeHandleForMapping(handleRaw);
  if (!handle) throw new Error('Business username is required');

  const refDoc = doc(db, 'businessUsernames', handle);
  try {
    await setDoc(refDoc, { uid });
  } catch (err: any) {
    console.error('claimBusinessUsername error', err);
    if (err?.code === 'permission-denied') {
      throw new Error('That business username is already taken. Please choose another one.');
    }
    throw new Error('Could not claim business username. Please try again.');
  }
}

export default function ProfilePage() {
  const [user] = useAuthState(auth);

  // Basic fields
  const [isProvider, setIsProvider] = useState(false);
  const [offersMobileService, setOffersMobileService] = useState(false);

  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState(''); // to know if it’s first set

  const [businessUsername, setBusinessUsername] = useState('');
  const [originalBusinessUsername, setOriginalBusinessUsername] = useState('');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [location, setLocation] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [services, setServices] = useState('');
  const [bio, setBio] = useState('');

  // Photos
  const [picFile, setPicFile] = useState<File | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const [bizPicFile, setBizPicFile] = useState<File | null>(null);
  const [businessProfilePhotoUrl, setBusinessProfilePhotoUrl] = useState('');

  // Geo
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [street, setStreet] = useState('');
  const [town, setTown] = useState('');
  const [county, setCounty] = useState('');

  // New: per-day business hours editor state
  const [hours, setHours] = useState<Record<number, { open: boolean; start: string; end: string }>>(
    () => ({
      0: { open: false, start: '09:00', end: '17:00' },
      1: { open: true,  start: '09:00', end: '17:00' },
      2: { open: true,  start: '09:00', end: '17:00' },
      3: { open: true,  start: '09:00', end: '17:00' },
      4: { open: true,  start: '09:00', end: '17:00' },
      5: { open: true,  start: '09:00', end: '17:00' },
      6: { open: false, start: '09:00', end: '17:00' },
    })
  );

  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) return;

      const d = snap.data() as any;

      // Normalize stored handles for display (always lowercase in UI)
      const storedUsername = d.username || '';
      const normalizedUsername = normalizeHandleInput(storedUsername);
      setUsername(normalizedUsername);
      setOriginalUsername(normalizedUsername);

      const storedBizUsername = d.businessUsername || '';
      const normalizedBizUsername = normalizeHandleInput(storedBizUsername);
      setBusinessUsername(normalizedBizUsername);
      setOriginalBusinessUsername(normalizedBizUsername);

      setFullName(d.fullName || '');
      setPhone(d.phone || '');
      setBusinessPhone(d.businessPhone || '');
      setEmail(d.email || user.email || '');
      setGender(d.gender || '');
      setLocation(d.location || '');
      setIsProvider(!!d.isProvider);
      setOffersMobileService(!!d.offersMobileService);
      setBusinessName(d.businessName || '');
      setServices(d.services || '');
      setBio(d.bio || '');

      if (d.profilePhoto) setProfilePhotoUrl(d.profilePhoto);
      if (d.businessProfilePhoto) setBusinessProfilePhotoUrl(d.businessProfilePhoto);

      if (d.lat && d.lng) {
        setLat(d.lat);
        setLng(d.lng);
        setStreet(d.street || '');
        setTown(d.town || '');
        setCounty(d.county || '');
      }

      // Normalize hours from whatever is stored
      const bh = toBusinessHoursFromLegacy(d);
      if (Object.keys(bh).length) {
        setHours(prev => {
          const next = { ...prev };
          for (let di = 0; di <= 6; di++) {
            if (bh[di]) {
              next[di] = { open: true, start: bh[di]!.start, end: bh[di]!.end };
            } else {
              next[di] = { open: false, start: prev[di].start, end: prev[di].end };
            }
          }
          return next;
        });
      }
    })();
  }, [user]);

  const saveChanges = async () => {
    if (!user) return;

    // sanitize handles
    const cleanedUsername = normalizeHandleInput(username);
    if (!cleanedUsername) {
      return alert('Username is required (lowercase letters, numbers, underscore, dot).');
    }

    if (!fullName.trim() || !phone) {
      return alert('Full name and phone number are required.');
    }

    let cleanedBusinessUsername = normalizeHandleInput(businessUsername);

    if (isProvider) {
      if (!businessName || !services || !bio || !businessPhone) {
        return alert('Please fill in all service provider details, including business phone.');
      }
      if (!cleanedBusinessUsername) {
        return alert('Business username is required for service providers (lowercase letters, numbers, underscore, dot).');
      }
    }

    try {
      // If this is the first time setting a personal username, claim it in /usernames
      if (!originalUsername) {
        await claimUsername(cleanedUsername, user.uid);
        setOriginalUsername(cleanedUsername);
      }

      // If provider & first time setting a business username, claim it in /businessUsernames
      if (isProvider && !originalBusinessUsername) {
        await claimBusinessUsername(cleanedBusinessUsername, user.uid);
        setOriginalBusinessUsername(cleanedBusinessUsername);
      }

      // Build clean businessHours (omit closed days) & operatingDays
      const businessHours: BusinessHours = {};
      const operatingDays: number[] = [];

      for (let di = 0; di <= 6; di++) {
        const d = hours[di];
        if (d?.open) {
          businessHours[di] = { start: d.start, end: d.end }; // "HH:mm"
          operatingDays.push(di);
        }
      }

      // ⚠️ IMPORTANT:
      // Do NOT always send username / businessUsername here, or you'll violate usernameUnchanged().
      // Only include them when they're being set the first time.
      const updates: any = {
        fullName,
        phone,
        email,
        gender,
        location,
        isProvider,
      };

      // Geo (optional)
      if (lat != null && lng != null) {
        updates.lat = lat;
        updates.lng = lng;
        updates.street = street;
        updates.town = town;
        updates.county = county;
      }

      // First-time personal username: include it so hasUsername() passes
      if (!originalUsername) {
        updates.username = cleanedUsername;
        updates.usernameLower = cleanedUsername;
      }
      // If originalUsername exists, we rely on existing doc username and DO NOT touch it,
      // so usernameUnchanged() passes and hasUsername(request.resource.data) still holds.

      if (isProvider) {
        updates.businessPhone = businessPhone;
        updates.businessName = businessName;
        updates.services = services;
        updates.bio = bio;
        updates.offersMobileService = offersMobileService;

        // Only set businessUsername client-side the first time
        if (!originalBusinessUsername) {
          updates.businessUsername = cleanedBusinessUsername;
          updates.businessUsernameLower = cleanedBusinessUsername;
        }

        // only include schedule fields when provider
        updates.businessHours = businessHours;
        updates.operatingDays = operatingDays;
      }

      // Upload personal photo
      if (picFile) {
        const picRef = ref(storage, `profiles/${user.uid}/${picFile.name}`);
        await uploadBytes(picRef, picFile);
        updates.profilePhoto = await getDownloadURL(picRef);
        setProfilePhotoUrl(updates.profilePhoto);
      }

      // Upload business photo
      if (bizPicFile) {
        const bizRef = ref(storage, `profiles/${user.uid}/business/${bizPicFile.name}`);
        await uploadBytes(bizRef, bizPicFile);
        updates.businessProfilePhoto = await getDownloadURL(bizRef);
        setBusinessProfilePhotoUrl(updates.businessProfilePhoto);
      }

      await updateDoc(doc(db, 'users', user.uid), updates);
      alert('Profile updated');
    } catch (err: any) {
      console.error('saveChanges error', err);
      alert(err?.message || 'Could not save profile. Please try again.');
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude);
        setLng(longitude);
        alert('Location set to your current position.');
      },
      (err) => {
        console.error(err);
        alert('Unable to retrieve your location.');
      }
    );
  };

  if (!user) return <p className="p-6">Please sign in to view this page.</p>;

  return (
    <div className="pt-20 max-w-2xl mx-auto p-4 space-y-6 bg-white rounded-lg mt-10 shadow-md">
      {/* Logo top center */}
      <div className="flex justify-center mb-4">
        <img src="/vextup-logo.png" alt="VEXTUP" className="h-24 w-auto object-contain" />
      </div>

      <h2 className="text-2xl font-semibold text-[#0F7A5F]">Profile Settings</h2>

      {/* Personal Profile Photo */}
      <div className="flex items-center space-x-4">
        {profilePhotoUrl ? (
          <img src={profilePhotoUrl} alt="profile" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 bg-gray-300 rounded-full" />
        )}
        <div className="space-y-1">
          <div className="text-sm font-medium">Personal Profile Photo</div>
          <input
            type="file"
            accept="image/*"
            onChange={e => setPicFile(e.target.files?.[0] || null)}
          />
        </div>
      </div>

      {/* Basics */}
      <label className="block">
        <span>Full Name*:</span>
        <input
          type="text"
          className="mt-1 block w-full border rounded px-3 py-2"
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          required
        />
      </label>

      <label className="block">
        <div className="flex items-center justify-between">
          <span>Username* (personal):</span>
          {originalUsername && (
            <span className="text-xs text-gray-500">
              Usernames can&apos;t be changed once set.
            </span>
          )}
        </div>
        <input
          type="text"
          className="mt-1 block w-full border rounded px-3 py-2"
          value={username}
          onChange={e => setUsername(normalizeHandleInput(e.target.value))}
          required
          disabled={!!originalUsername} // matches rules: usernameUnchanged
          placeholder="yourhandle"
        />
        <p className="text-xs text-gray-500 mt-1">
          Lowercase letters, numbers, underscore and dot only. Shown as @username.
        </p>
      </label>

      <label className="block">
        <span>Phone Number* (Personal):</span>
        <PhoneInput
          international
          defaultCountry="KE"
          value={phone}
          onChange={value => setPhone(value || '')}
          className="mt-1 block w-full"
          required
        />
      </label>

      <label className="block">
        <span>Email:</span>
        <input
          type="email"
          className="mt-1 block w-full border rounded px-3 py-2"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
      </label>

      <label className="block">
        <span>Gender:</span>
        <select
          className="mt-1 block w-full border rounded px-3 py-2"
          value={gender}
          onChange={e => setGender(e.target.value)}
        >
          <option value="">Select Gender</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Other">Other</option>
        </select>
      </label>

      <label className="block">
        <span>Location:</span>
        <input
          type="text"
          className="mt-1 block w-full border rounded px-3 py-2"
          value={location}
          onChange={e => setLocation(e.target.value)}
        />
      </label>

      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={isProvider}
          onChange={e => setIsProvider(e.target.checked)}
        />
        <span>I am a service provider</span>
      </label>

      {isProvider && (
        <div className="space-y-4 p-4 border rounded">
          {/* Business Profile Photo */}
          <div className="flex items-center space-x-4">
            {businessProfilePhotoUrl ? (
              <img
                src={businessProfilePhotoUrl}
                alt="business profile"
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 bg-gray-300 rounded-full" />
            )}
            <div className="space-y-1">
              <div className="text-sm font-medium">Business Profile Photo</div>
              <input
                type="file"
                accept="image/*"
                onChange={e => setBizPicFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-gray-500">Shown publicly on your creator page.</p>
            </div>
          </div>

          {/* Business username */}
          <label className="block">
            <div className="flex items-center justify-between">
              <span>Business Username*:</span>
              {originalBusinessUsername && (
                <span className="text-xs text-gray-500">
                  Business usernames can&apos;t be changed once set.
                </span>
              )}
            </div>
            <input
              type="text"
              className="mt-1 block w-full border rounded px-3 py-2"
              value={businessUsername}
              onChange={e => setBusinessUsername(normalizeHandleInput(e.target.value))}
              required
              disabled={!!originalBusinessUsername}
              placeholder="yourbusiness"
            />
            <p className="text-xs text-gray-500 mt-1">
              Lowercase letters, numbers, underscore and dot only. Shown as @businessname and used at /c/businessname.
            </p>
          </label>

          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={offersMobileService}
              onChange={e => setOffersMobileService(e.target.checked)}
            />
            <span>
              I offer mobile / outcall services (I can travel to the client)
            </span>
          </label>
          <p className="text-xs text-gray-500 -mt-2">
            When enabled, you can mark individual services as available for
            housecall/outcall while uploading them, and clients will be able
            to request a housecall when booking those services.
          </p>

          <button
            type="button"
            onClick={useCurrentLocation}
            className="px-3 py-1 rounded bg-[#0F7A5F] text-white hover:opacity-90"
          >
            Use My Current Location
          </button>

          <LocationPicker
            initialLatLng={lat !== null && lng !== null ? { lat, lng } : undefined}
            onLocationSelect={(latVal, lngVal, addr) => {
              setLat(latVal);
              setLng(lngVal);
              setStreet(addr.street || '');
              setTown(addr.town || '');
              setCounty(addr.county || '');
            }}
          />

          {/* Business Phone */}
          <label className="block">
            <span>Business Phone*:</span>
            <PhoneInput
              international
              defaultCountry="KE"
              value={businessPhone}
              onChange={value => setBusinessPhone(value || '')}
              className="mt-1 block w-full"
              required
            />
          </label>

          {/* Business Fields */}
          <label className="block">
            <span>Business Name*:</span>
            <input
              type="text"
              className="mt-1 block w-full border rounded px-3 py-2"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              required
            />
          </label>

          <label className="block">
            <span>Services Provided*:</span>
            <input
              type="text"
              className="mt-1 block w-full border rounded px-3 py-2"
              value={services}
              onChange={e => setServices(e.target.value)}
              required
            />
          </label>

          {/* Per-day operating hours (24h) */}
          <div>
            <div className="font-medium mb-2">Operating Days &amp; Hours*</div>
            <div className="space-y-2">
              {DAY_LABELS.map((label, di) => (
                <div key={di} className="flex items-center gap-3">
                  <label className="flex items-center gap-2 w-36">
                    <input
                      type="checkbox"
                      checked={hours[di].open}
                      onChange={(e) =>
                        setHours(prev => ({ ...prev, [di]: { ...prev[di], open: e.target.checked } }))
                      }
                    />
                    <span>{label}</span>
                  </label>

                  <input
                    type="time"
                    className="border rounded px-2 py-1"
                    value={hours[di].start}
                    onChange={(e) =>
                      setHours(prev => ({ ...prev, [di]: { ...prev[di], start: e.target.value } }))
                    }
                    disabled={!hours[di].open}
                  />
                  <span>to</span>
                  <input
                    type="time"
                    className="border rounded px-2 py-1"
                    value={hours[di].end}
                    onChange={(e) =>
                      setHours(prev => ({ ...prev, [di]: { ...prev[di], end: e.target.value } }))
                    }
                    disabled={!hours[di].open}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Use 24-hour times (e.g., 09:00 to 17:00). Uncheck a day to mark it closed.
            </p>
          </div>

          <label className="block">
            <span>Business Bio*:</span>
            <textarea
              className="mt-1 block w-full border rounded px-3 py-2"
              value={bio}
              onChange={e => setBio(e.target.value)}
              required
            />
          </label>
        </div>
      )}

      <button
        onClick={saveChanges}
        className="w-full py-2 bg-[#0F7A5F] text-white rounded-lg hover:opacity-90"
      >
        Save Changes
      </button>
    </div>
  );
}