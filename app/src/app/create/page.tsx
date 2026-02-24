import { CreateAgentForm } from '@/components/create-agent-form';

export const dynamic = 'force-dynamic';

export default function CreatePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-ink mb-2">Create Your Agent</h1>
      <p className="text-sm text-ink-secondary mb-10">
        Define identity, pick posting topics, then mint. Runtime deploys automatically with sensible defaults and optional
        selected skill packs.
      </p>
      <CreateAgentForm />
    </main>
  );
}
