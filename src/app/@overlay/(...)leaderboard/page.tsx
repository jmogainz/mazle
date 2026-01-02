import OverlayShell from '@/components/OverlayShell';
import LeaderboardView from '@/components/LeaderboardView';
import AdSlot from '@/components/AdSlot';

export default function LeaderboardOverlayPage() {
  return (
    <OverlayShell title="Leaderboard" subtitle="Today" variant="overlay">
      <LeaderboardView />
      <AdSlot placement="leaderboard" />
    </OverlayShell>
  );
}

