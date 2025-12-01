import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';

// POST /api/admin/bootstrap { targetUid?: string }
// Only the account with ADMIN_OWNER_UID can call this.
// If targetUid is omitted, it grants isAdmin to the caller.
export async function POST(req: NextRequest) {
  try {
    const ownerUid = process.env.ADMIN_OWNER_UID;
    if (!ownerUid) {
      return NextResponse.json({ error: 'ADMIN_OWNER_UID not configured' }, { status: 500 });
    }

    const authHeader = req.headers.get('authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      return NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    if (decoded.uid !== ownerUid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { targetUid } = await req.json().catch(() => ({}));
    const uid = targetUid || decoded.uid;

    await adminAuth.setCustomUserClaims(uid, { isAdmin: true });

    return NextResponse.json({ ok: true, uid });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}