// /workspaces/Vext/lib/firebaseAdmin.ts
import * as admin from 'firebase-admin';

/**
 * Initializes Firebase Admin once per runtime.
 * Uses discrete env vars:
 *  - FIREBASE_PROJECT_ID
 *  - FIREBASE_CLIENT_EMAIL
 *  - FIREBASE_PRIVATE_KEY  (replace \n → real newlines)
 */
function initAdminApp() {
  if (admin.apps.length) return admin.app();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;

  const privateKey = rawKey ? rawKey.replace(/\\n/g, '\n') : undefined;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase service account credentials. ' +
      'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in your environment.'
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

// Ensure initialized
const app = initAdminApp();

// 👇 exports (same names you already use)
export const adminDb = admin.firestore();
export const adminAuth = admin.auth();
export const initAdmin = admin; // kept for compatibility

/**
 * Optional helper: verify an ID token from "Authorization: Bearer <token>"
 */
export async function verifyBearerAuth(authorizationHeader?: string) {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const idToken = authorizationHeader.slice(7);
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    return decoded; // { uid, email, isAdmin?, ... }
  } catch {
    return null;
  }
}