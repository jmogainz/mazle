import OverlayShell from '@/components/OverlayShell';
import AccountView from '@/components/AccountView';
import AdSlot from '@/components/AdSlot';

export default function AccountPage() {
  return (
    <OverlayShell title="Account" subtitle="Name, sign-in, settings" variant="page" closeHref="/">
      <AccountView />
      <AdSlot placement="account" />
    </OverlayShell>
  );
}

