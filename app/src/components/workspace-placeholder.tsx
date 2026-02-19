import Link from 'next/link';

interface WorkspacePlaceholderProps {
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel?: string;
}

export function WorkspacePlaceholder({
  title,
  description,
  primaryHref,
  primaryLabel,
}: WorkspacePlaceholderProps) {
  return (
    <main className="px-10 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      </div>

      <div className="max-w-4xl rounded-2xl border border-border bg-surface-raised px-6 py-10">
        <p className="text-sm text-ink-secondary">
          This workspace section is now part of the shell layout and ready for deeper tooling.
        </p>
        {primaryHref && primaryLabel && (
          <Link
            href={primaryHref}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-black hover:bg-brand-600 transition-colors"
          >
            {primaryLabel}
          </Link>
        )}
      </div>
    </main>
  );
}
