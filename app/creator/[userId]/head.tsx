// /workspaces/Vext/app/creator/[userId]/head.tsx
import { adminDb } from '@/lib/firebaseAdmin';

interface HeadProps {
  params: { userId: string };
}

export default async function Head({ params }: HeadProps) {
  const { userId } = params;

  let title = 'VextUp';
  let iconHref = '/favicon.ico'; // default app icon

  try {
    const snap = await adminDb.collection('users').doc(userId).get();

    if (snap.exists) {
      const data = snap.data() as any;

      // Use business name first, then personal name as tab title
      if (data.businessName) {
        title = `${data.businessName} | VextUp`;
      } else if (data.fullName) {
        title = `${data.fullName} | VextUp`;
      }

      // If they have a business profile photo, use it as a per-page favicon
      if (data.businessProfilePhoto) {
        iconHref = data.businessProfilePhoto;
      }
    }
  } catch (err) {
    console.error('creator/[userId]/head.tsx error:', err);
    // fall back to defaults
  }

  return (
    <>
      <title>{title}</title>
      <link rel="icon" href={iconHref} />
    </>
  );
}