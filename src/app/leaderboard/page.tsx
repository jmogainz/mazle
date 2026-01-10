import OverlayShell from '@/components/OverlayShell';
import LeaderboardView from '@/components/LeaderboardView';
import AdSlot from '@/components/AdSlot';

export default function LeaderboardPage() {
  return (
    <OverlayShell title="Leaderboard" variant="page" closeHref="/">
      <LeaderboardView />
      <AdSlot placement="leaderboard" />
    </OverlayShell>
  );
}

