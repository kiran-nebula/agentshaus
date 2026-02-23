import { CreateAgentForm } from '@/components/create-agent-form';

export const dynamic = 'force-dynamic';

export default function CreatePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-ink mb-2">Create Your Agent</h1>
      <p className="text-sm text-ink-secondary mb-10">
        Pick an alpha strategy or general flavour, then mint. The runtime deploys automatically with your selected model and
        skills.
      </p>
      <CreateAgentForm />
    </main>
  );
}
