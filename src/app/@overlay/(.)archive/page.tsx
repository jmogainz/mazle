import OverlayShell from '@/components/OverlayShell';
import ArchiveView from '@/components/ArchiveView';
import AdSlot from '@/components/AdSlot';

export default function ArchiveOverlayPage() {
  return (
    <OverlayShell title="Archive" subtitle="Play past Mazles" variant="overlay">
      <ArchiveView presentation="overlay" />
      <AdSlot placement="archive" />
    </OverlayShell>
  );
}
