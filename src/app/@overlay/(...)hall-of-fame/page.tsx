import OverlayShell from '@/components/OverlayShell';
import HallOfFameView from '@/components/HallOfFameView';
import AdSlot from '@/components/AdSlot';

export default function HallOfFameOverlayPage() {
  return (
    <OverlayShell title="Hall of Fame" subtitle="Podium history" variant="overlay">
      <HallOfFameView />
      <AdSlot placement="leaderboard" />
    </OverlayShell>
  );
}

