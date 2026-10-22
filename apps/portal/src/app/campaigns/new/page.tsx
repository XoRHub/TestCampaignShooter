'use client';

import { Suspense } from 'react';
import { CampaignForm } from '../../../components/campaign-form';

export default function NewCampaignPage() {
  return (
    <div>
      <h1>Nouvelle campagne</h1>
      <Suspense>
        <CampaignForm />
      </Suspense>
    </div>
  );
}
