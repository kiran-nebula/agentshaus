import { AgentDetailClient } from './client';

interface AgentPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { id } = await params;
  return <AgentDetailClient soulMint={id} />;
}
