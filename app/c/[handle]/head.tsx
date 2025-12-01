// /workspaces/Vext/app/c/[handle]/head.tsx
import { adminDb } from '@/lib/firebaseAdmin';

interface HeadProps {
  params: { handle: string };
}

export default async function Head({ params }: HeadProps) {
  const handle = params.handle.toLowerCase();

  let title = 'VextUp';
  let iconHref = '/favicon.ico'; // fall back to global favicon

  try {
    // 1) Look up which user this business handle belongs to
    const handleSnap = await adminDb
      .collection('businessUsernames')
      .doc(handle)
      .get();

    if (handleSnap.exists) {
      const { uid } = handleSnap.data() as any;

      // 2) Fetch that user's profile
      const userSnap = await adminDb.collection('users').doc(uid).get();

      if (userSnap.exists) {
        const data = userSnap.data() as any;

        // Business name (or full name) becomes tab title
        if (data.businessName) {
          title = `${data.businessName} | VextUp`;
        } else if (data.fullName) {
          title = `${data.fullName} | VextUp`;
        }

        // Business profile photo becomes favicon for this page
        if (data.businessProfilePhoto) {
          iconHref = data.businessProfilePhoto;
        }
      }
    }
  } catch (err) {
    console.error('c/[handle]/head.tsx error:', err);
    // keep defaults on error
  }

  return (
    <>
      <title>{title}</title>
      <link rel="icon" href={iconHref} />
    </>
  );
}