'use server';

import { redirect } from 'next/navigation';
import { getIdentityProvider } from './provider';
import { users } from '@platform/policy/roles';

export async function loginAs(userId: string): Promise<void> {
  if (!users.some((u) => u.id === userId)) {
    throw new Error(`Unknown user ${userId}`);
  }
  await getIdentityProvider().login(userId);
  redirect('/');
}

export async function logout(): Promise<void> {
  await getIdentityProvider().logout();
  redirect('/login');
}
