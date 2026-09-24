'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import {
  Button, Card, EmptyState, Field, Input, Pill, SkeletonRows, useToast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { clearActingSchool } from '@/lib/acting-school';
import { themeStyle } from '@/lib/school-theme';
import type {
  SchoolCustomizationDto, SchoolCustomizationSummaryDto, SchoolCustomizationInput, SchoolDropdownDto,
} from '@/lib/types';

/**
 * Super Admin — School Customization.
 *
 * Select a school, see how it is configured, edit it, preview the result, save
 * or reset to the shipped defaults.
 *
 * The preview is the part worth being careful about, so it is not a guess: the
 * draft goes to the server, which validates it with exactly the validator the
 * save uses and returns the CSS variables it would produce. The swatch below is
 * painted with those variables, applied the same way a real portal applies
 * them. So a preview that renders is a configuration that will save, and a
 * malformed colour is reported here rather than after the operator has built a
 * theme on top of it.
 *
 * Nothing on this page invents a value. Empty fields are sent as empty and mean
 * "not customised" — which is what makes Reset and "clear every field" the same
 * outcome rather than two subtly different ones.
 */

const EMPTY: SchoolCustomizationInput = {
  theme: { primaryColor: '', secondaryColor: '', accentColor: '' },
  branding: { displayName: '', tagline: '', logoUrl: '', faviconUrl: '' },
  header: { showSchoolName: true, showTagline: false },
  sidebar: { showLogo: true, showPortalLabel: true, defaultCollapsed: false },
  dropdowns: [],
};

/** The stored configuration as the form edits it: nulls become empty strings. */
function toDraft(config: SchoolCustomizationDto): SchoolCustomizationInput {
  return {
    theme: {
      primaryColor: config.theme.primaryColor ?? '',
      secondaryColor: config.theme.secondaryColor ?? '',
      accentColor: config.theme.accentColor ?? '',
    },
    branding: {
      displayName: config.branding.displayName ?? '',
      tagline: config.branding.tagline ?? '',
      logoUrl: config.branding.logoUrl ?? '',
      faviconUrl: config.branding.faviconUrl ?? '',
    },
    header: { ...config.header },
    sidebar: { ...config.sidebar },
    dropdowns: config.dropdowns.map((d) => ({
      key: d.key,
      label: d.label,
      options: d.options.map((o) => ({ value: o.value, label: o.label, order: o.order })),
    })),
  };
}

export default function SuperAdminCustomizationPage() {
  const [schools, setSchools] = useState<SchoolCustomizationSummaryDto[] | null>(null);
  const [err, setErr] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [config, setConfig] = useState<SchoolCustomizationDto | null>(null);
  const [draft, setDraft] = useState<SchoolCustomizationInput>(EMPTY);
  const [preview, setPreview] = useState<Record<string, string> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setErr(false);
    // The console spans every school; an X-School-Id left from one that was
    // opened earlier would narrow it. PortalShell clears it too, but its effect
    // runs after this one.
    clearActingSchool();
    try {
      const rows = await api.listSchoolCustomizations();
      setSchools(rows);
      setSelected((cur) => cur ?? rows[0]?.tenantId ?? null);
    } catch {
      setErr(true);
      setSchools([]);
    }
  }, []);

  const loadConfig = useCallback(async (tenantId: string) => {
    setConfig(null);
    setPreview(null);
    setPreviewError(null);
    try {
      const next = await api.schoolCustomization(tenantId);
      setConfig(next);
      setDraft(toDraft(next));
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) void loadConfig(selected); }, [selected, loadConfig]);

  const current = schools?.find((s) => s.tenantId === selected) ?? null;
  const dirty = useMemo(
    () => (config ? JSON.stringify(draft) !== JSON.stringify(toDraft(config)) : false),
    [draft, config],
  );

  const runPreview = async () => {
    if (!selected) return;
    setBusy(true);
    setPreviewError(null);
    try {
      const result = await api.previewSchoolCustomization(selected, draft);
      setPreview(result.cssVariables);
    } catch (e) {
      setPreview(null);
      setPreviewError(errorMessage(e, 'This configuration would be refused.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const saved = await api.saveSchoolCustomization(selected, draft);
      setConfig(saved);
      setDraft(toDraft(saved));
      toast(`${current?.tenantName ?? selected} updated.`, 'success');
      await load();
    } catch (e) {
      toast(errorMessage(e, 'Could not save this configuration.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const fresh = await api.resetSchoolCustomization(selected);
      setConfig(fresh);
      setDraft(toDraft(fresh));
      setPreview(null);
      toast(`${current?.tenantName ?? selected} is back to the default look.`, 'success');
      await load();
    } catch (e) {
      toast(errorMessage(e, 'Could not reset this configuration.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setTheme = (patch: Partial<NonNullable<SchoolCustomizationInput['theme']>>) =>
    setDraft((d) => ({ ...d, theme: { ...d.theme, ...patch } }));
  const setBranding = (patch: Partial<NonNullable<SchoolCustomizationInput['branding']>>) =>
    setDraft((d) => ({ ...d, branding: { ...d.branding, ...patch } }));

  return (
    <PortalShell
      expectedSlug="super-admin"
      topbar={{
        title: 'School Customization',
        desc: 'Theme, branding and dropdown values, configured separately for each school.',
        actions: (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" small disabled={!config || busy} onClick={() => void reset()}>
              Reset to default
            </Button>
            <Button variant="soft" small disabled={!config || busy} onClick={() => void runPreview()}>
              Preview
            </Button>
            <Button small disabled={!config || busy || !dirty} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ),
      }}
    >
      <div className="console-split is-wide-detail">
        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Schools</strong>
          </div>
          {schools === null && <div style={{ padding: 18 }}><SkeletonRows rows={4} /></div>}
          {err && <EmptyState title="Couldn't load customization" sub="Failed to fetch from the server." />}
          {schools !== null && !err && schools.length === 0 && (
            <EmptyState title="No schools yet" sub="Register a school before customising it." />
          )}
          {schools?.map((s) => (
            <button
              key={s.tenantId}
              type="button"
              onClick={() => setSelected(s.tenantId)}
              aria-current={s.tenantId === selected ? 'true' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '12px 18px', border: 0, borderBottom: '1px solid var(--hairline)', cursor: 'pointer',
                background: s.tenantId === selected ? 'var(--surface-2, rgba(0,0,0,0.04))' : 'transparent',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 22, height: 22, borderRadius: 6, flex: 'none',
                  border: '1px solid var(--hairline-2)',
                  background: s.theme.primaryColor ?? 'repeating-linear-gradient(45deg,#eee,#eee 4px,#fff 4px,#fff 8px)',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{s.tenantName}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>
                  {s.customized
                    ? `${s.dropdownCount} dropdown${s.dropdownCount === 1 ? '' : 's'}`
                    : 'Default look'}
                </span>
              </span>
            </button>
          ))}
        </Card>

        <div style={{ display: 'grid', gap: 16 }}>
          {!current && <Card><EmptyState title="Select a school" sub="Pick a school to see how it is configured." /></Card>}
          {current && !config && <Card><SkeletonRows rows={5} /></Card>}

          {current && config && (
            <>
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>{current.tenantName}</strong>
                  <Pill tone={config.customized ? 'green' : 'gray'}>
                    {config.customized ? 'customised' : 'default look'}
                  </Pill>
                </div>
                {config.updatedBy && (
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 12 }}>
                    Last changed by {config.updatedBy}
                    {config.updatedAt ? ` on ${new Date(config.updatedAt).toLocaleString()}` : ''}
                  </div>
                )}

                <div className="form-grid-3">
                  <ColorField
                    label="Primary colour"
                    hint="Sidebar, buttons, focus rings."
                    value={draft.theme?.primaryColor ?? ''}
                    onChange={(primaryColor) => setTheme({ primaryColor })}
                  />
                  <ColorField
                    label="Secondary colour"
                    hint="The gradient partner."
                    value={draft.theme?.secondaryColor ?? ''}
                    onChange={(secondaryColor) => setTheme({ secondaryColor })}
                  />
                  <ColorField
                    label="Accent colour"
                    hint="Highlights and callouts."
                    value={draft.theme?.accentColor ?? ''}
                    onChange={(accentColor) => setTheme({ accentColor })}
                  />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                  Leave a colour blank to keep the portal&rsquo;s own role tint. Text colours are chosen by the server
                  from the primary colour so they stay readable.
                </p>
              </Card>

              <Card>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Branding</strong>
                <div className="form-grid-2" style={{ marginTop: 12 }}>
                  <Field label="Display name" hint="Overrides the registered school name in the sidebar and tab.">
                    <Input
                      value={draft.branding?.displayName ?? ''}
                      onChange={(e) => setBranding({ displayName: e.target.value })}
                      placeholder={current.tenantName}
                    />
                  </Field>
                  <Field label="Tagline" hint="Shown in the header only when that is switched on below.">
                    <Input
                      value={draft.branding?.tagline ?? ''}
                      onChange={(e) => setBranding({ tagline: e.target.value })}
                    />
                  </Field>
                  <AssetField
                    label="Logo"
                    value={draft.branding?.logoUrl ?? ''}
                    onChange={(logoUrl) => setBranding({ logoUrl })}
                  />
                  <AssetField
                    label="Favicon"
                    value={draft.branding?.faviconUrl ?? ''}
                    onChange={(faviconUrl) => setBranding({ faviconUrl })}
                  />
                </div>
              </Card>

              <Card>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Header &amp; sidebar</strong>
                <div className="form-grid-2" style={{ gap: 8, marginTop: 12 }}>
                  <Toggle
                    label="Show the school name in the browser tab"
                    checked={draft.header?.showSchoolName ?? true}
                    onChange={(showSchoolName) => setDraft((d) => ({ ...d, header: { ...d.header, showSchoolName } }))}
                  />
                  <Toggle
                    label="Show the tagline under the page title"
                    checked={draft.header?.showTagline ?? false}
                    onChange={(showTagline) => setDraft((d) => ({ ...d, header: { ...d.header, showTagline } }))}
                  />
                  <Toggle
                    label="Show the logo in the sidebar"
                    checked={draft.sidebar?.showLogo ?? true}
                    onChange={(showLogo) => setDraft((d) => ({ ...d, sidebar: { ...d.sidebar, showLogo } }))}
                  />
                  <Toggle
                    label="Show the portal name under the school's"
                    checked={draft.sidebar?.showPortalLabel ?? true}
                    onChange={(showPortalLabel) =>
                      setDraft((d) => ({ ...d, sidebar: { ...d.sidebar, showPortalLabel } }))}
                  />
                  <Toggle
                    label="Start with the sidebar collapsed"
                    checked={draft.sidebar?.defaultCollapsed ?? false}
                    onChange={(defaultCollapsed) =>
                      setDraft((d) => ({ ...d, sidebar: { ...d.sidebar, defaultCollapsed } }))}
                  />
                </div>
              </Card>

              <DropdownEditor
                dropdowns={draft.dropdowns ?? []}
                onChange={(dropdowns) => setDraft((d) => ({ ...d, dropdowns }))}
              />

              <Card>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Preview</strong>
                <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '4px 0 12px' }}>
                  Validated by the server with the same rules the save uses, and painted with the variables it
                  returns — so what renders here is what the school will get.
                </p>
                {previewError && (
                  <div role="alert" style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{previewError}</div>
                )}
                {!preview && !previewError && (
                  <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Choose <em>Preview</em> to render this draft.</div>
                )}
                {preview && <ThemeSwatch variables={preview} draft={draft} fallbackName={current.tenantName} />}
              </Card>
            </>
          )}
        </div>
      </div>
    </PortalShell>
  );
}

function ColorField({
  label, hint, value, onChange,
}: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
  return (
    <Field label={label} hint={hint}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#1f4a3a" />
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 38, height: 34, padding: 0, border: '1px solid var(--input-border)', borderRadius: 8, flex: 'none' }}
        />
      </span>
    </Field>
  );
}

/**
 * A logo or favicon: uploaded through the existing upload endpoint, or pasted.
 *
 * The upload is the same `/uploads` endpoint documents and course material
 * already use, so there is one place where files land and one allow-list of
 * types deciding what may be stored.
 */
function AssetField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const result = await api.uploadFile(file);
      onChange(result.fileUrl);
    } catch (e) {
      toast(errorMessage(e, 'Could not upload that file.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={label} hint="Upload a file, or paste an https URL. SVG is not accepted.">
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/uploads/…" />
        <label
          className="btn btn-soft"
          style={{ flex: 'none', padding: '7px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer' }}
        >
          {busy ? '…' : 'Upload'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      </span>
    </Field>
  );
}

function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '6px 0' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * The school's option lists.
 *
 * Each list is a key the forms ask for and the values it offers. Values are
 * kept separate from labels in the model; this editor keeps them together for
 * simplicity and sends the value as the label, which is what an operator typing
 * "Red" means. Renaming a label without moving the value stays possible through
 * the API for the case where records already reference the old value.
 */
function DropdownEditor({
  dropdowns, onChange,
}: {
  dropdowns: NonNullable<SchoolCustomizationInput['dropdowns']>;
  onChange: (next: NonNullable<SchoolCustomizationInput['dropdowns']>) => void;
}) {
  const [newKey, setNewKey] = useState('');

  const addList = () => {
    const key = newKey.trim().toLowerCase();
    if (!key) return;
    onChange([...dropdowns, { key, label: key.replace(/-/g, ' '), options: [] }]);
    setNewKey('');
  };

  const patch = (index: number, next: SchoolDropdownDto | null) => {
    const copy = [...dropdowns];
    if (next === null) copy.splice(index, 1);
    else copy[index] = next;
    onChange(copy);
  };

  return (
    <Card>
      <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Dropdown values</strong>
      <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '4px 0 12px' }}>
        Option lists this school&rsquo;s forms offer. Each school has its own — one school&rsquo;s houses are never
        shown to another.
      </p>

      {dropdowns.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 12 }}>No lists configured.</div>
      )}

      {dropdowns.map((list, index) => (
        <div key={list.key} style={{ borderTop: '1px solid var(--hairline)', padding: '12px 0' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <code style={{ fontSize: 12, color: 'var(--text-2)' }}>{list.key}</code>
            <Input
              value={list.label}
              onChange={(e) => patch(index, { ...list, label: e.target.value } as SchoolDropdownDto)}
              placeholder="Label"
            />
            <Button variant="ghost" small onClick={() => patch(index, null)}>Remove</Button>
          </div>
          <Field label="Options" hint="One per line. These are the values the form will offer.">
            <textarea
              className="input"
              rows={Math.min(Math.max(list.options.length + 1, 3), 10)}
              value={list.options.map((o) => o.label).join('\n')}
              onChange={(e) =>
                patch(index, {
                  ...list,
                  options: e.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line, order) => ({ value: line, label: line, order })),
                } as SchoolDropdownDto)}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </Field>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
        <Field label="Add a list" hint="A key its forms will ask for, e.g. house.">
          <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="house" />
        </Field>
        <Button variant="soft" small onClick={addList} disabled={!newKey.trim()}>Add</Button>
      </div>
    </Card>
  );
}

/** A miniature portal, painted with the variables the server returned. */
function ThemeSwatch({
  variables, draft, fallbackName,
}: { variables: Record<string, string>; draft: SchoolCustomizationInput; fallbackName: string }) {
  const name = draft.branding?.displayName || fallbackName;
  return (
    <div
      style={{
        ...themeStyle(variables),
        display: 'grid', gridTemplateColumns: '150px 1fr',
        border: '1px solid var(--hairline-2)', borderRadius: 10, overflow: 'hidden', minHeight: 150,
      }}
    >
      <div style={{ background: 'var(--accent)', color: 'var(--sidebar-text)', padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          {draft.sidebar?.showLogo && (
            <span
              style={{
                width: 26, height: 26, borderRadius: 7, background: 'var(--on-accent)',
                color: 'var(--accent)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13,
              }}
            >
              {name.trim().charAt(0).toUpperCase() || 'E'}
            </span>
          )}
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sidebar-heading)' }}>{name}</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--sidebar-group)', letterSpacing: '.06em' }}>WORKSPACE</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>Dashboard</div>
        <div style={{ fontSize: 12, marginTop: 4, color: 'var(--sidebar-secondary)' }}>Attendance</div>
      </div>
      <div style={{ padding: 14, background: 'var(--parchment)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--header-title, var(--text-1))' }}>Dashboard</div>
        {draft.header?.showTagline && draft.branding?.tagline && (
          <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-2)' }}>{draft.branding.tagline}</div>
        )}
        <button
          type="button"
          style={{
            marginTop: 12, padding: '6px 12px', borderRadius: 8, border: 0,
            background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 12, fontWeight: 600,
          }}
        >
          Primary action
        </button>
        {draft.theme?.accentColor && (
          <span
            style={{
              display: 'inline-block', marginLeft: 8, padding: '4px 10px', borderRadius: 999,
              background: 'var(--brand-accent)', color: '#fff', fontSize: 11, fontWeight: 600,
            }}
          >
            Highlight
          </span>
        )}
      </div>
    </div>
  );
}
