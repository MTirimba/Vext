// /workspaces/Vext/app/[handle]/head.tsx
import { adminDb } from '@/lib/firebaseAdmin';

interface HeadProps {
  params: { handle: string };
}

// simple normaliser similar to the one in the business page
function normalizeHandle(value: string | undefined | null): string {
  return (value || '').trim().replace(/^@+/, '').toLowerCase();
}

export default async function Head({ params }: HeadProps) {
  const rawHandle = params.handle || '';
  const handleLower = normalizeHandle(rawHandle);

  let title = 'VextUp';
  let iconHref = '/favicon.ico'; // fallback favicon

  try {
    let uid: string | null = null;

    // 1) Primary mapping: /businessUsernames/{handleLower}
    const mapRef = adminDb.collection('businessUsernames').doc(handleLower);
    const mapSnap = await mapRef.get();

    if (mapSnap.exists) {
      const data = mapSnap.data() as any;
      uid = data?.uid || null;
    }

    // 2) Fallback: look directly in /users by businessUsernameLower / businessUsername
    if (!uid) {
      const usersCol = adminDb.collection('users');

      let userSnap = await usersCol
        .where('businessUsernameLower', '==', handleLower)
        .limit(1)
        .get();

      if (userSnap.empty && rawHandle) {
        userSnap = await usersCol
          .where('businessUsername', '==', rawHandle)
          .limit(1)
          .get();
      }

      if (!userSnap.empty) {
        const docSnap = userSnap.docs[0];
        uid = docSnap.id;

        // backfill the mapping so next time the lookup is cheap
        try {
          await mapRef.set({ uid }, { merge: true });
        } catch (e) {
          console.warn('backfill businessUsernames in head.tsx failed:', e);
        }
      }
    }

    // 3) Last-resort: scan providers and match normalized businessUsername
    if (!uid) {
      const providersSnap = await adminDb
        .collection('users')
        .where('isProvider', '==', true)
        .get();

      providersSnap.forEach((docSnap) => {
        if (uid) return; // already found
        const data = docSnap.data() as any;
        const bh = normalizeHandle(data.businessUsername);
        if (bh && bh === handleLower) {
          uid = docSnap.id;
        }
      });

      if (uid) {
        try {
          await mapRef.set({ uid }, { merge: true });
        } catch (e) {
          console.warn('backfill businessUsernames (scan) in head.tsx failed:', e);
        }
      }
    }

    // If we still don't have a uid, keep default title + favicon
    if (!uid) {
      return (
        <>
          <title>{title}</title>
          <link rel="icon" href={iconHref} />
        </>
      );
    }

    // 4) Load the user profile to build title + favicon
    const userSnap = await adminDb.collection('users').doc(uid).get();
    if (userSnap.exists) {
      const data = userSnap.data() as any;

      if (data.businessName) {
        title = `${data.businessName} | VextUp`;
      } else if (data.fullName) {
        title = `${data.fullName} | VextUp`;
      }

      if (data.businessProfilePhoto) {
        iconHref = data.businessProfilePhoto;
      }
    }
  } catch (err) {
    console.error('[handle]/head.tsx error:', err);
    // fall back to defaults on any error
  }

  return (
    <>
      <title>{title}</title>
      <link rel="icon" href={iconHref} />
    </>
  );
}