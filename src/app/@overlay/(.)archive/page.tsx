import { Suspense } from 'react';
import OverlayShell from '@/components/OverlayShell';
import ArchiveView from '@/components/ArchiveView';
import AdSlot from '@/components/AdSlot';

export default function ArchiveOverlayPage() {
  return (
    <OverlayShell title="Archive" subtitle="Play past Mazles" variant="overlay">
      <Suspense fallback={<div style={{ padding: '1rem' }}>Loading archive…</div>}>
        <ArchiveView presentation="overlay" />
      </Suspense>
      <AdSlot placement="archive" />
    </OverlayShell>
  );
}
