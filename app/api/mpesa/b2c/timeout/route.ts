// /workspaces/Vext/app/api/mpesa/b2c/timeout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  console.log('⏰ [M-PESA B2C TIMEOUT] HIT /api/mpesa/b2c/timeout');

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    console.error('❌ [M-PESA B2C TIMEOUT] Failed to parse JSON body');
  }

  console.log(
    '⏰ [M-PESA B2C TIMEOUT] Raw body:',
    JSON.stringify(body, null, 2),
  );

  try {
    const result = body?.Result;
    const originatorConversationId: string | undefined =
      result?.OriginatorConversationID;
    const conversationId: string | undefined = result?.ConversationID;

    console.log('⏰ [M-PESA B2C TIMEOUT] Extracted IDs:', {
      originatorConversationId,
      conversationId,
    });

    let withdrawalRef: FirebaseFirestore.DocumentReference | null = null;

    if (originatorConversationId) {
      console.log(
        '⏰ [M-PESA B2C TIMEOUT] Querying by originatorConversationId:',
        originatorConversationId,
      );
      const snap = await adminDb
        .collectionGroup('withdrawals')
        .where('originatorConversationId', '==', originatorConversationId)
        .limit(1)
        .get();
      console.log(
        '⏰ [M-PESA B2C TIMEOUT] Query by originatorConversationId returned docs:',
        snap.size,
      );
      if (!snap.empty) {
        withdrawalRef = snap.docs[0].ref;
        console.log(
          '⏰ [M-PESA B2C TIMEOUT] Matched withdrawal doc (originatorConversationId):',
          snap.docs[0].id,
        );
      }
    }

    if (!withdrawalRef && conversationId) {
      console.log(
        '⏰ [M-PESA B2C TIMEOUT] Querying by conversationId:',
        conversationId,
      );
      const snap2 = await adminDb
        .collectionGroup('withdrawals')
        .where('conversationId', '==', conversationId)
        .limit(1)
        .get();
      console.log(
        '⏰ [M-PESA B2C TIMEOUT] Query by conversationId returned docs:',
        snap2.size,
      );
      if (!snap2.empty) {
        withdrawalRef = snap2.docs[0].ref;
        console.log(
          '⏰ [M-PESA B2C TIMEOUT] Matched withdrawal doc (conversationId):',
          snap2.docs[0].id,
        );
      }
    }

    if (withdrawalRef) {
      console.log(
        '⏰ [M-PESA B2C TIMEOUT] Marking withdrawal as timeout/failed',
      );
      await withdrawalRef.set(
        {
          status: 'timeout',
          mpesaTimeoutRawCallback: body,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      console.log(
        '⏰ [M-PESA B2C TIMEOUT] Withdrawal doc updated to timeout.',
      );
    } else {
      console.warn(
        '[M-PESA B2C TIMEOUT] No matching withdrawal for IDs',
        { originatorConversationId, conversationId },
      );
    }
  } catch (err: any) {
    console.error('❌ [M-PESA B2C TIMEOUT ERROR]:', err?.message || err);
  }

  // Always ACK so Safaricom stops retrying
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}