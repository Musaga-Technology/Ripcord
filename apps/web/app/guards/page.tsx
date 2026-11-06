import type { Metadata } from 'next';
import { GuardsHome } from '../../components/app/GuardsHome';

export const metadata: Metadata = { title: 'Guards' };

export default function GuardsPage() {
  return <GuardsHome />;
}
