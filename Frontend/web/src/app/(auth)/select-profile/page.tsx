'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ROLE_TO_SLUG } from '@/lib/portals';
import { Spinner } from '@/components/ui';

export default function SelectProfilePage() {
  const { loading, me } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && me?.profile?.role) {
      // Profile already selected by backend → go to its portal.
      router.replace(`/${ROLE_TO_SLUG[me.profile.role]}`);
    }
  }, [loading, me, router]);

  // While we wait for auth or redirect, show a spinner.
  return (
    <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Spinner />
    </div>
  );
}
