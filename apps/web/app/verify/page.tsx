import type { Metadata } from 'next';
import { VerifyView } from '../../components/app/VerifyPage';

export const metadata: Metadata = { title: 'Verify a guard' };

export default function VerifyPage() {
  return <VerifyView />;
}
