'use client';

import LocationPicker, { type AddressInfo } from './LocationPicker';

export interface HousecallAddress {
  lat: number | null;
  lng: number | null;
  street: string;
  town: string;
  county: string;
  landmark: string;
  building: string;
  floor: string;
  room: string;
}

export const EMPTY_HOUSECALL_ADDRESS: HousecallAddress = {
  lat: null,
  lng: null,
  street: '',
  town: '',
  county: '',
  landmark: '',
  building: '',
  floor: '',
  room: '',
};

// Composes the granular fields into a single readable string, e.g. for
// display to the provider or storage in the existing `housecallAddress`
// string field so nothing downstream (bookings list, save-booking API) breaks.
export function formatHousecallAddress(a: HousecallAddress): string {
  const unit = [
    a.building && a.building.trim(),
    a.floor && `Floor ${a.floor.trim()}`,
    a.room && `Rm ${a.room.trim()}`,
  ]
    .filter(Boolean)
    .join(', ');

  const area = [
    a.landmark && `near ${a.landmark.trim()}`,
    a.street && a.street.trim(),
    a.town && a.town.trim(),
    a.county && a.county.trim(),
  ]
    .filter(Boolean)
    .join(', ');

  return [unit, area].filter(Boolean).join(' — ');
}

// A pin is required before we consider the address "set" — the manual
// unit-level fields alone aren't enough for a provider to actually find the
// place.
export function isHousecallAddressComplete(a: HousecallAddress): boolean {
  return a.lat != null && a.lng != null && (!!a.town || !!a.street);
}

interface HousecallAddressPickerProps {
  value: HousecallAddress;
  onChange: (next: HousecallAddress) => void;
}

export default function HousecallAddressPicker({
  value,
  onChange,
}: HousecallAddressPickerProps) {
  const handleLocationSelect = (
    lat: number,
    lng: number,
    address: AddressInfo,
  ) => {
    onChange({
      ...value,
      lat,
      lng,
      // Only overwrite the auto-filled fields — leave building/floor/room
      // (and anything the client has already hand-edited) alone.
      street: address.street ?? value.street,
      town: address.town ?? value.town,
      county: address.county ?? value.county,
      landmark: address.landmark ?? value.landmark,
    });
  };

  const field = (key: keyof HousecallAddress, label: string, placeholder = '') => (
    <label className="block">
      <span className="block text-[11px] text-gray-500 mb-0.5">{label}</span>
      <input
        type="text"
        className="w-full border rounded px-2 py-1 text-sm"
        placeholder={placeholder}
        value={value[key] as string}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-gray-500 mb-1">
          Drop a pin (or use your current location) so we can prefill the
          area details below. You can edit anything that isn&apos;t quite
          right.
        </p>
        <LocationPicker
          initialLatLng={
            value.lat != null && value.lng != null
              ? { lat: value.lat, lng: value.lng }
              : undefined
          }
          onLocationSelect={handleLocationSelect}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {field('street', 'Road / street')}
        {field('landmark', 'Nearest landmark')}
        {field('town', 'Town')}
        {field('county', 'County / city')}
      </div>

      <div>
        <p className="text-[11px] text-gray-500 mb-1">
          Now add the details a pin can&apos;t show — building name, floor,
          house or room number.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {field('building', 'Building / house name', 'e.g. Riverside Apts')}
          {field('floor', 'Floor', 'e.g. 3rd')}
          {field('room', 'House / room no.', 'e.g. 4B')}
        </div>
      </div>
    </div>
  );
}