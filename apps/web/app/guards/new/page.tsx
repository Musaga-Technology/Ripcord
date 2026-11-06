import type { Metadata } from 'next';
import { NewGuard } from '../../../components/app/NewGuard';

export const metadata: Metadata = { title: 'New guard' };

export default function NewGuardPage() {
  return <NewGuard />;
}
