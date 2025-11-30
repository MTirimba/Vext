'use client';

import { useRouter } from 'next/navigation';
import { UploadModal } from '@/components/UploadModal';

export default function UploadPage() {
  const router = useRouter();
  return <UploadModal onClose={() => router.back()} />;
}