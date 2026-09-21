import { redirect } from 'next/navigation';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { PageHeader } from '@platform/ui/primitives';

export default async function InboxPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <AppShell>
      <PageHeader title="Approval inbox" />
      <p className="text-slate-500">Nothing pending. Approval requests land here (phase 2).</p>
    </AppShell>
  );
}
