'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePermissions } from '@/lib/permissions';
import { usePortalHref } from '@/lib/school-path';
import { cctvApi, type CctvCamera } from '@/lib/cctv-api';

/**
 * A camera icon on a Campus World room or zone, for people who may watch live
 * CCTV (camera.live.view; the API refuses families whatever they hold). It
 * links to the Live CCTV page, where the viewing starts and is logged; no
 * video plays in Campus World. Shown only when the school has live CCTV on
 * and a camera you may watch covers this room or zone.
 */
let cache: { at: number; cams: CctvCamera[] } | null = null;
let inflight: Promise<CctvCamera[]> | null = null;

function loadCameras(): Promise<CctvCamera[]> {
  if (cache && Date.now() - cache.at < 60_000) return Promise.resolve(cache.cams);
  inflight ??= cctvApi.cameras()
    .then((cams) => { cache = { at: Date.now(), cams }; return cams; })
    .catch(() => { cache = { at: Date.now(), cams: [] }; return []; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function RoomCameraLink({ facilityId, name }: { facilityId: string; name?: string | null }) {
  const { permissions } = usePermissions();
  const link = usePortalHref();
  const allowed = Boolean(permissions['camera.live.view']);
  const [cams, setCams] = useState<CctvCamera[]>([]);
  useEffect(() => {
    if (!allowed) return undefined;
    let live = true;
    void loadCameras().then((all) => {
      const n = String(name ?? '').trim().toLowerCase();
      if (live) setCams(all.filter((c) => c.facilityId === facilityId || (n && (String(c.zone ?? '').toLowerCase() === n || String(c.roomLabel ?? '').toLowerCase() === n))));
    });
    return () => { live = false; };
  }, [allowed, facilityId, name]);
  if (!allowed || !cams.length) return null;
  return (
    <div className="ops-inline" style={{ margin: '6px 0' }}>
      {cams.slice(0, 3).map((c) => (
        <Link key={c.id} className="btn btn-soft btn-sm campus-cctv-link" href={link(`/cctv?camera=${c.id}`)} aria-label={`Live camera: ${c.name}`}>
          <span aria-hidden="true">◎</span> {cams.length > 1 ? c.name : 'Live camera'}
        </Link>
      ))}
    </div>
  );
}
