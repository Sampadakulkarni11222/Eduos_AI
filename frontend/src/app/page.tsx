'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { portalHome } from '@/lib/school-path';

/** Authenticated users go straight to their portal; others to /login. */
export default function Index() {
  const { loading, me } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!me || !me.profile?.id || !me.profile?.role) {
      router.replace('/login');
      return;
    }
    router.replace(portalHome(me.profile.tenantId, me.profile.role));
  }, [loading, me, router]);

  return (
    <div className="loading-overlay">
      {/* Spinner + brand while auth resolves */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 50, height: 50, borderRadius: 12,
          background: 'linear-gradient(150deg,#F2E4CC,#D8B98A)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Newsreader, serif', fontWeight: 700, fontSize: 26, color: '#591620',
          boxShadow: '0 4px 16px rgba(89,22,32,.2)',
        }}>
          O
        </div>
        <div className="spinner" style={{ borderTopColor: '#591620' }} />
        <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>Loading EduOS AI…</span>
      </div>
    </div>
  );
}
