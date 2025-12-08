// /workspaces/Vext/app/payment-success/page.tsx
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function PaymentSuccessInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const bookingId = searchParams?.get('bookingId') ?? '';
  const status = searchParams?.get('status') ?? '';
  const amount = searchParams?.get('amount') ?? '';

  const [bookingDetails, setBookingDetails] = useState<any>(null);

  useEffect(() => {
    if (!bookingId) return;
    fetch(`/api/get-booking?bookingId=${bookingId}`)
      .then((res) => res.json())
      .then((data) => setBookingDetails(data))
      .catch(() => setBookingDetails(null));
  }, [bookingId]);

  useEffect(() => {
    if (status.toLowerCase() === 'completed') {
      const timer = setTimeout(() => router.push('/'), 7000);
      return () => clearTimeout(timer);
    }
  }, [status, router]);

  const isCompleted = status === 'Completed' || status.toLowerCase() === 'completed';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white text-black text-center p-6">
      <div className="animate-bounce text-6xl mb-4">✅</div>
      <h1 className="text-2xl font-bold mb-2">
        {isCompleted ? 'Payment Successful!' : 'Payment Status'}
      </h1>
      <p className="text-gray-600 mb-6">
        {isCompleted
          ? 'Your payment has been processed successfully.'
          : 'We’re verifying your transaction...'}
      </p>

      {bookingDetails ? (
        <div className="bg-gray-100 p-5 rounded-xl shadow-md text-left w-full max-w-md">
          <p>
            <strong>Booking ID:</strong> {bookingId || '—'}
          </p>
          <p>
            <strong>Service:</strong> {bookingDetails.videoDescription || 'N/A'}
          </p>
          <p>
            <strong>Provider:</strong> {bookingDetails.providerBusinessName || 'N/A'}
          </p>
          <p>
            <strong>Location:</strong> {bookingDetails.providerLocation || 'N/A'}
          </p>
          <p>
            <strong>Date:</strong> {bookingDetails.date || '—'}
          </p>
          <p>
            <strong>Time:</strong> {bookingDetails.time || '—'}
          </p>
          <p>
            <strong>Amount Paid:</strong> KES {amount || '—'}
          </p>

          <button
            onClick={() => router.push('/')}
            className="mt-6 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      ) : (
        <p className="text-sm text-gray-500">Loading booking details...</p>
      )}

      <p className="text-gray-400 text-sm mt-6">
        Redirecting you back to home shortly...
      </p>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <PaymentSuccessInner />
    </Suspense>
  );
}