import type { Metadata } from 'next';
import { GuardView } from '../../../components/app/GuardPage';

export const metadata: Metadata = { title: 'Guard' };

export default async function GuardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GuardView id={id} />;
}
