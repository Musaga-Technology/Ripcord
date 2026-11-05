import { GuardView } from '../../../components/app/GuardPage';

export default async function GuardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GuardView id={id} />;
}
