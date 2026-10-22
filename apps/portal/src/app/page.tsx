'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, formatDate } from '../lib/api';
import { useMe } from '../lib/use-me';

interface CampaignRow {
  id: string;
  name: string;
  description?: string;
  parallelism: number;
  version: number;
  runCount?: number;
  updatedAt: string;
  scheduleCron?: string | null;
  scheduleEnabled?: boolean;
  nextScheduledAt?: string;
  createdBy?: { displayName: string; email: string };
  project?: { id: string; name: string };
}

export default function CampaignsPage() {
  const { can } = useMe();
  const [campaigns, setCampaigns] = useState<CampaignRow[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api<CampaignRow[]>('/api/campaigns').then(setCampaigns).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Campagnes</h1>
        {can('editor') && (
          <Link className="btn primary" href="/campaigns/new">
            + Nouvelle campagne
          </Link>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="card">
        <table className="list">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Créateur</th>
              <th>Runs</th>
              <th>Parallélisme</th>
              <th>Modifiée</th>
            </tr>
          </thead>
          <tbody>
            {campaigns?.map((campaign) => (
              <tr key={campaign.id}>
                <td>
                  <Link href={`/campaigns/${campaign.id}`}>{campaign.name}</Link>{' '}
                  {campaign.scheduleEnabled && (
                    <span
                      className="badge"
                      title={`cron ${campaign.scheduleCron} — prochain lancement : ${formatDate(campaign.nextScheduledAt)}`}
                    >
                      ⏰ {campaign.scheduleCron}
                    </span>
                  )}
                  {campaign.project && (
                    <Link href={`/projects/${campaign.project.id}`} className="badge" title="Projet">
                      📁 {campaign.project.name}
                    </Link>
                  )}
                  {campaign.description && <div className="muted">{campaign.description}</div>}
                </td>
                <td className="muted">{campaign.createdBy?.displayName ?? '—'}</td>
                <td>{campaign.runCount ?? 0}</td>
                <td>{campaign.parallelism}</td>
                <td className="muted">{formatDate(campaign.updatedAt)}</td>
              </tr>
            ))}
            {campaigns?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Aucune campagne — créez la première !
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
