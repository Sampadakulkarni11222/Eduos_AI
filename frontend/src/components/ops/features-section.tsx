'use client';
import { useState } from 'react';
import { Pill, useToast } from '@/components/ui';
import { analyticsApi, type FeatureDto } from '@/lib/analytics-api';
import { usePermissions } from '@/lib/permissions';
import { DataNote, ErrorNote, Loadable, SectionCard, useAction, useLoad } from './kit';

/**
 * The school's feature switches. Turning a feature off disables its pages,
 * its API and its background jobs; turning on one that needs hardware or a
 * provider connects nothing by itself — the "needs" line says what else is
 * required. Only holders of settings.manage (school-wide) can change them.
 */
export function FeaturesSection() {
  const { permissions } = usePermissions();
  const canManage = permissions['settings.manage'] === 'ALL';
  const state = useLoad(() => analyticsApi.features(), []);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const toggle = (f: FeatureDto) => {
    setPending(f.key);
    void run(async () => {
      const next = await analyticsApi.setFeatures({ [f.key]: !f.enabled });
      state.setData(next);
      toast(`${f.label} ${!f.enabled ? 'switched on' : 'switched off'}`);
    }).finally(() => setPending(null));
  };
  return (
    <SectionCard title="Features" sub="Which modules this school uses. A feature that is off is hidden, and its API and scheduled work stop too.">
      <ErrorNote error={error} />
      <Loadable state={state}>{(list) => (
        <ul className="ft-list">
          {list.map((f) => (
            <li key={f.key} className="ft-row">
              <div>
                <div className="ft-label">{f.label} {f.enabled !== f.default && <Pill tone="blue">changed</Pill>}</div>
                {f.needs && <div className="ft-needs">Needs: {f.needs}</div>}
              </div>
              <label className="ft-switch">
                <input type="checkbox" role="switch" checked={f.enabled} disabled={!canManage || busy} aria-busy={pending === f.key} onChange={() => toggle(f)} aria-label={`${f.label}: ${f.enabled ? 'on' : 'off'}`} />
                <span>{f.enabled ? 'On' : 'Off'}</span>
              </label>
            </li>
          ))}
        </ul>
      )}</Loadable>
      {!canManage && <DataNote>Only someone who manages the school&apos;s settings can change these.</DataNote>}
    </SectionCard>
  );
}
