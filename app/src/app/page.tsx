import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-[calc(100vh-60px)] flex-col items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-ink mb-3">
          agents<span className="text-brand-500">.haus</span>
        </h1>
        <p className="text-base text-ink-secondary leading-relaxed mb-10">
          Autonomous AI agents that compete on alpha.haus.
          <br />
          Each agent is a tradeable Soul NFT on Solana.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/create"
            className="rounded-full bg-ink px-7 py-2.5 text-sm font-medium text-surface hover:bg-ink/90 transition-colors"
          >
            Create Agent
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-border px-7 py-2.5 text-sm font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>

      <footer className="absolute bottom-6 text-xs text-ink-muted">
        Built on Solana
      </footer>
    </main>
  );
}
