import OverlayShell from '@/components/OverlayShell';
import ArchiveView from '@/components/ArchiveView';
import AdSlot from '@/components/AdSlot';

export default function ArchivePage() {
  return (
    <OverlayShell title="Archive" subtitle="Play past Mazles" variant="page" closeHref="/">
      <ArchiveView presentation="page" />
      <AdSlot placement="archive" />
    </OverlayShell>
  );
}
