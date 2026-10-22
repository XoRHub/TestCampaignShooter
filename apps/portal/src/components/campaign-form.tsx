'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DiscoveryIssue, SelectionRule, TestsSource } from '@tcs/shared-types';
import { api } from '../lib/api';
import { useMe } from '../lib/use-me';
import { RuleBuilder } from './rule-builder';

export interface CampaignInput {
  name: string;
  description?: string;
  selectionRule: SelectionRule;
  source: TestsSource;
  parallelism?: number;
  scheduleCron?: string | null;
  scheduleEnabled?: boolean;
  adapterManifestUrl?: string | null;
  projectId?: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface PreviewResult {
  totalDiscovered: number;
  selectedCount: number;
  selected: Array<{ id: string; name: string; engine: string; file: string }>;
  issues: DiscoveryIssue[];
}

const DEFAULT_RULE: SelectionRule = { all: [{ prop: 'tags', op: 'contains', value: 'smoke' }] };

/** Create/edit form with the rule builder and a live preview of the selection. */
export function CampaignForm({
  initial,
  campaignId,
}: {
  initial?: CampaignInput;
  campaignId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useMe();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [parallelism, setParallelism] = useState(initial?.parallelism ?? 5);
  const [scheduleCron, setScheduleCron] = useState(initial?.scheduleCron ?? '');
  const [scheduleEnabled, setScheduleEnabled] = useState(initial?.scheduleEnabled ?? false);
  const [adapterManifestUrl, setAdapterManifestUrl] = useState(initial?.adapterManifestUrl ?? '');
  const [projectId, setProjectId] = useState(initial?.projectId ?? searchParams.get('projectId') ?? '');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rule, setRule] = useState<SelectionRule>(initial?.selectionRule ?? DEFAULT_RULE);
  const [source, setSource] = useState<TestsSource>(initial?.source ?? { type: 'git', url: '' });
  const [preview, setPreview] = useState<PreviewResult | undefined>();
  const [busy, setBusy] = useState<'preview' | 'save' | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api<ProjectOption[]>('/api/projects').then(setProjects).catch(() => undefined);
  }, []);

  const runPreview = async () => {
    setBusy('preview');
    setError(undefined);
    try {
      setPreview(
        await api<PreviewResult>('/api/campaigns/preview', {
          method: 'POST',
          body: JSON.stringify({ selectionRule: rule, source }),
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(undefined);
    try {
      const body = JSON.stringify({
        name,
        description,
        selectionRule: rule,
        source,
        parallelism,
        scheduleCron: scheduleCron.trim() || null,
        scheduleEnabled: scheduleEnabled && scheduleCron.trim() !== '',
        projectId: projectId || null,
        // Omitted entirely for non-admins so a PUT by an editor never trips
        // the server's admin-only check on this field (it stays untouched).
        ...(can('admin') ? { adapterManifestUrl: adapterManifestUrl.trim() || null } : {}),
      });
      const saved = await api<{ id: string }>(
        campaignId ? `/api/campaigns/${campaignId}` : '/api/campaigns',
        { method: campaignId ? 'PUT' : 'POST', body },
      );
      router.push(`/campaigns/${campaignId ?? saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(undefined);
    }
  };

  return (
    <div className="grid cols-2">
      <div>
        <div className="card">
          <label className="field">
            Nom
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Smoke paiements"
            />
          </label>
          <label className="field">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            Parallélisme (tests simultanés)
            <input
              type="number"
              min={1}
              max={200}
              value={parallelism}
              onChange={(e) => setParallelism(Number(e.target.value))}
            />
          </label>
          <label className="field">
            Projet (optionnel)
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Aucun — visible par tous les viewers</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {can('admin') && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Manifeste d&apos;adaptateurs (admin)</h2>
            <label className="field">
              URL du manifeste (optionnel)
              <input
                value={adapterManifestUrl}
                onChange={(e) => setAdapterManifestUrl(e.target.value)}
                placeholder="https://example.com/adapters/manifest.yaml"
              />
            </label>
            <p className="muted">
              Ajoute ou surcharge des moteurs de test pour les runs de{' '}
              <strong>cette campagne uniquement</strong> — résolu une seule fois au lancement, figé
              sur le run. Réservé aux admins (peut exécuter une commande arbitraire en provider{' '}
              <code className="chip">local</code>). Voir{' '}
              <a href="/admin/adapter-manifests">manifestes d&apos;instance</a> pour une extension
              globale. Détails : docs/adapter-plugins.md.
            </p>
          </div>
        )}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Planification automatique (cron)</h2>
          <label className="field">
            Expression cron (5 champs — min heure jour mois jour-semaine)
            <input
              value={scheduleCron}
              onChange={(e) => setScheduleCron(e.target.value)}
              placeholder="ex. 0 6 * * 1-5  (6h00 du lundi au vendredi)"
            />
          </label>
          <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
              disabled={scheduleCron.trim() === ''}
              style={{ width: 'auto' }}
            />
            Activer le lancement automatique planifié
          </label>
          <p className="muted">
            Exemples : <code className="chip">*/30 * * * *</code> toutes les 30 min ·{' '}
            <code className="chip">0 3 * * *</code> chaque nuit à 3h ·{' '}
            <code className="chip">0 8 * * 1</code> le lundi à 8h. Un tick est ignoré si un run de
            la campagne est encore en cours.
          </p>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Source des tests</h2>
          <label className="field">
            Type
            <select
              value={source.type}
              onChange={(e) =>
                setSource(
                  e.target.value === 'git' ? { type: 'git', url: '' } : { type: 'local', path: '' },
                )
              }
            >
              <option value="git">Dépôt Git</option>
              <option value="local">Dossier local (dev)</option>
            </select>
          </label>
          {source.type === 'git' ? (
            <>
              <label className="field">
                URL du dépôt
                <input
                  value={source.url}
                  onChange={(e) => setSource({ ...source, url: e.target.value })}
                  placeholder="https://git.example.com/qa/tests.git"
                />
              </label>
              <label className="field">
                Révision (branche/tag/sha, optionnel)
                <input
                  value={source.revision ?? ''}
                  onChange={(e) => setSource({ ...source, revision: e.target.value || undefined })}
                />
              </label>
            </>
          ) : (
            <label className="field">
              Chemin du dossier (ou .zip)
              <input
                value={source.path}
                onChange={(e) => setSource({ ...source, path: e.target.value })}
                placeholder="examples/tests"
              />
            </label>
          )}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Règle de sélection</h2>
          <p className="muted">
            Conditions ET/OU imbriquables sur les propriétés des metadata.json + restriction par
            sous-arbre.
          </p>
          <RuleBuilder rule={rule} onChange={setRule} />
        </div>

        {error && <div className="error-box">{error}</div>}
        <div className="row">
          <button className="btn" onClick={runPreview} disabled={busy !== undefined}>
            {busy === 'preview' ? 'Aperçu…' : 'Prévisualiser la sélection'}
          </button>
          <button className="btn primary" onClick={save} disabled={busy !== undefined || !name}>
            {campaignId ? 'Enregistrer' : 'Créer la campagne'}
          </button>
        </div>
      </div>

      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Aperçu de la sélection</h2>
          {!preview && (
            <p className="muted">Cliquez sur « Prévisualiser » pour évaluer la règle.</p>
          )}
          {preview && (
            <>
              <p>
                <strong>{preview.selectedCount}</strong> test(s) sélectionné(s) sur{' '}
                {preview.totalDiscovered} découvert(s).
              </p>
              <table className="list">
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Moteur</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.selected.map((test) => (
                    <tr key={test.id}>
                      <td>
                        {test.name}
                        <div className="muted">{test.file}</div>
                      </td>
                      <td>
                        <code className="chip">{test.engine}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.issues.length > 0 && (
                <>
                  <h2>Problèmes de découverte ({preview.issues.length})</h2>
                  {preview.issues.map((issue, i) => (
                    <p key={i} className="muted">
                      ⚠ <code className="chip">{issue.kind}</code> {issue.file} — {issue.message}
                    </p>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
