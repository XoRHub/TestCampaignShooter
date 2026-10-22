import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TopNav } from '../components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'TestCampaignShooter',
  description: 'Orchestration de campagnes de tests sur Kubernetes/Argo',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <TopNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
