import { Suspense } from 'react';
import OverlayShell from '@/components/OverlayShell';
import ArchiveView from '@/components/ArchiveView';
import AdSlot from '@/components/AdSlot';

function getInitialTodayNy(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default function ArchivePage() {
  const initialTodayNy = getInitialTodayNy();
  return (
    <OverlayShell title="Archive" subtitle="Play past Mazles" variant="page" closeHref="/">
      <Suspense fallback={<div style={{ padding: '1rem' }}>Loading archive…</div>}>
        <ArchiveView presentation="page" initialTodayNy={initialTodayNy} />
      </Suspense>
      <AdSlot placement="archive" />
    </OverlayShell>
  );
}
