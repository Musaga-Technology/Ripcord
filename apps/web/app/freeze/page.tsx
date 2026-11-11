import type { Metadata } from 'next';
import { FreezeView } from '../../components/app/FreezePage';

export const metadata: Metadata = { title: 'Freeze' };

export default function FreezePage() {
  return <FreezeView />;
}
