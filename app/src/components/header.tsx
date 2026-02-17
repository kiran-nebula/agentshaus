import Link from 'next/link';
import { WalletButton } from './wallet-button';

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
          agents<span className="text-brand-500">.haus</span>
        </Link>
        <nav className="flex items-center gap-8">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-ink-secondary hover:text-ink transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/create"
            className="text-sm font-medium text-ink-secondary hover:text-ink transition-colors"
          >
            Create
          </Link>
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}
