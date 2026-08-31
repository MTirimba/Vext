'use client';

import { useState } from 'react';
import { useLoadScript, GoogleMap, Marker } from '@react-google-maps/api';

type AddressInfo = {
  street?: string;
  town?: string;
  city?: string;
  county?: string;
  landmark?: string;
};

interface LocationPickerProps {
  initialLatLng?: { lat: number; lng: number };
  onLocationSelect: (lat: number, lng: number, address: AddressInfo) => void;
}

export type { AddressInfo };

export default function LocationPicker({
  initialLatLng,
  onLocationSelect,
}: LocationPickerProps) {
  const libraries = ['places'] as any;

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
    libraries,
  });

  const [markerPos, setMarkerPos] = useState<{ lat: number; lng: number }>(
    initialLatLng || { lat: -1.286389, lng: 36.817223 }, // Default Nairobi
  );

  const callOnLocationSelect = (lat: number, lng: number) => {
    // If Google Maps JS isn't ready, just send coordinates
    if (typeof google === 'undefined' || !google.maps?.Geocoder) {
      onLocationSelect(lat, lng, {});
      return;
    }

    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results: any, status: any) => {
      if (status === 'OK' && results && results[0]) {
        const components = results[0].address_components || [];
        let street = '';
        let town = '';
        let city = '';
        let county = '';

        components.forEach((c: any) => {
          const types: string[] = c.types || [];
          if (types.includes('route')) {
            street = c.long_name;
          } else if (
            types.includes('sublocality') ||
            types.includes('sublocality_level_1') ||
            types.includes('neighborhood')
          ) {
            // A smaller area/estate within a city — e.g. "Kilimani",
            // "Westlands" — kept distinct from the city itself below.
            if (!town) town = c.long_name;
          } else if (types.includes('locality')) {
            // The city/major town itself — e.g. "Nairobi", "Mombasa".
            city = c.long_name;
          } else if (types.includes('administrative_area_level_2')) {
            county = c.long_name;
          }
        });

        // Fallback: if there was no sublocality/neighborhood at all (common
        // outside the bigger cities), don't leave town blank when we at
        // least have a city — better than an empty field.
        if (!town && city) town = city;

        // Best-effort nearby landmark: Google returns several results for the
        // same point, ordered most-specific first. A named point of interest
        // or establishment (e.g. a mall, school, church) makes a better
        // landmark than the raw street address, so look for one there.
        let landmark = '';
        for (const r of results) {
          const rTypes: string[] = r.types || [];
          if (
            rTypes.includes('point_of_interest') ||
            rTypes.includes('establishment') ||
            rTypes.includes('premise')
          ) {
            const name = (r.address_components || [])[0]?.long_name;
            if (name) {
              landmark = name;
              break;
            }
          }
        }

        onLocationSelect(lat, lng, {
          street,
          town,
          city,
          county,
          landmark,
        });
      } else {
        // Fallback: no address details
        onLocationSelect(lat, lng, {});
      }
    });
  };

  const handleMapClick = (ev: google.maps.MapMouseEvent) => {
    if (ev.latLng) {
      const lat = ev.latLng.lat();
      const lng = ev.latLng.lng();
      setMarkerPos({ lat, lng });
      callOnLocationSelect(lat, lng);
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return alert('Geolocation not supported');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMarkerPos({ lat, lng });
        callOnLocationSelect(lat, lng);
      },
      () => alert('Unable to fetch location'),
    );
  };

  if (loadError) return <p>Error loading map</p>;
  if (!isLoaded) return <p>Loading map…</p>;

  return (
    <div className="space-y-2">
      <button onClick={useCurrentLocation} className="text-blue-600 underline">
        Use current device location
      </button>

      <div style={{ height: '300px', width: '100%' }}>
        <GoogleMap
          center={markerPos}
          zoom={15}
          mapContainerStyle={{ width: '100%', height: '100%' }}
          onClick={handleMapClick}
        >
          <Marker
            position={markerPos}
            draggable
            onDragEnd={(e) => {
              if (e.latLng) {
                const lat = e.latLng.lat();
                const lng = e.latLng.lng();
                setMarkerPos({ lat, lng });
                callOnLocationSelect(lat, lng);
              }
            }}
          />
        </GoogleMap>
      </div>

      <p className="text-sm text-gray-600">
        Location link:{' '}
        <a
          href={`https://www.google.com/maps?q=${markerPos.lat},${markerPos.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 underline"
        >
          View on Google Maps
        </a>
      </p>
    </div>
  );
}