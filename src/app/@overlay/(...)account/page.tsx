import OverlayShell from '@/components/OverlayShell';
import AccountView from '@/components/AccountView';
import AdSlot from '@/components/AdSlot';

export default function AccountOverlayPage() {
  return (
    <OverlayShell title="Account" variant="overlay">
      <AccountView />
      <AdSlot placement="account" />
    </OverlayShell>
  );
}

