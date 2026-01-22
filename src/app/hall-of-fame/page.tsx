import OverlayShell from '@/components/OverlayShell';
import HallOfFameView from '@/components/HallOfFameView';
import AdSlot from '@/components/AdSlot';

export default function HallOfFamePage() {
  return (
    <OverlayShell title="Hall of Fame" subtitle="Podium history" variant="page" closeHref="/">
      <HallOfFameView />
      <AdSlot placement="leaderboard" />
    </OverlayShell>
  );
}

