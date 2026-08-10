// /workspaces/Vext/lib/requireAuth.ts
import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { adminAuth } from './firebaseAdmin';

/**
 * Verifies the Firebase ID token sent as "Authorization: Bearer <token>".
 * Usage in a route handler:
 *
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth; // 401, just return it
 *   const { uid } = auth;
 *
 * Returns { uid, token } on success, or a ready-to-return NextResponse(401) on failure.
 */
export async function requireAuth(
  req: Request,
): Promise<{ uid: string; token: admin.auth.DecodedIdToken } | NextResponse> {
  const authHeader =
    req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!idToken) {
    return NextResponse.json(
      { error: 'Missing Authorization: Bearer <token> header' },
      { status: 401 },
    );
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    return { uid: decoded.uid, token: decoded };
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid or expired auth token' },
      { status: 401 },
    );
  }
}