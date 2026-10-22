'use client';

import { Suspense, use, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { CampaignForm, type CampaignInput } from '../../../../components/campaign-form';

export default function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [initial, setInitial] = useState<CampaignInput | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api<CampaignInput>(`/api/campaigns/${id}`).then(setInitial).catch((e) => setError(e.message));
  }, [id]);

  return (
    <div>
      <h1>Modifier la campagne</h1>
      {error && <div className="error-box">{error}</div>}
      {initial ? (
        <Suspense>
          <CampaignForm initial={initial} campaignId={id} />
        </Suspense>
      ) : (
        <p className="muted">Chargement…</p>
      )}
    </div>
  );
}
