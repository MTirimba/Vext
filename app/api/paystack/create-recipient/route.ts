// app/api/paystack/create-recipient/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function POST(req: NextRequest) {
  try {
    const { uid, name, phoneNumber, bankCode } = await req.json();

    if (!uid || !name || !phoneNumber || !bankCode) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // 🔑 Call Paystack to create a transfer recipient for M-PESA
    const res = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'mobile_money',
        name,
        account_number: phoneNumber, // M-PESA phone number
        bank_code: bankCode,        // e.g. 'MPESA'
        currency: 'KES',            // Kenyan Shilling
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Paystack error:', data);
      return NextResponse.json({ error: data.message || 'Paystack request failed' }, { status: 400 });
    }

    const recipient_code = data.data.recipient_code;

    // ✅ Save recipient_code in Firestore
    await updateDoc(doc(db, 'users', uid), {
      recipient_code,
      payoutMethod: 'mpesa',
      mpesa: {
        phoneNumber,
        name,
        bankCode,
      },
    });

    return NextResponse.json({ recipient_code }, { status: 200 });
  } catch (err: any) {
    console.error('Create recipient error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}