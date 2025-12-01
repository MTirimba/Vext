import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// (Optional) App Check — only if you’ve enabled enforcement for Storage
// import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!, // e.g. vextup-a3ca1.appspot.com
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Pin the exact bucket explicitly to avoid mismatches
export const storage = getStorage(app, `gs://${process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}`);

// Debug (you can remove after verifying)
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.log('[firebase] projectId:', app.options.projectId);
  // eslint-disable-next-line no-console
  console.log('[firebase] storageBucket:', app.options.storageBucket);
}

// (Optional) App Check – enable if you turned on enforcement for Storage
// if (typeof window !== 'undefined') {
//   // @ts-ignore
//   self.FIREBASE_APPCHECK_DEBUG_TOKEN = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG === 'true';
//   initializeAppCheck(app, {
//     provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY!),
//     isTokenAutoRefreshEnabled: true,
//   });
// }