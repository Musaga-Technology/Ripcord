import type { Metadata } from 'next';
import { LedgerView } from '../../components/app/LedgerPage';

export const metadata: Metadata = { title: 'Ledger' };

export default function LedgerPage() {
  return <LedgerView />;
}
