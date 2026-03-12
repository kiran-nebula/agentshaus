'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'New',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M8 3v10M3 8h10" />
      </svg>
    ),
  },
  {
    href: '/dashboard/discover',
    label: 'Discover',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6" />
        <path d="M10.5 5.5l-2 3-3 2 2-3 3-2z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/agents',
    label: 'My Agents',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M13.5 8.5l-3-3M4.5 2.5l1.7 4.3L2 11l4.2-.2L8.5 15l1.3-4.2L14 9.5" />
      </svg>
    ),
  },
  {
    href: '/files',
    label: 'Files',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1 1H12.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
];

const FOOTER_NAV_ITEMS: NavItem[] = [
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.2 3.2l1 1M11.8 11.8l1 1M12.8 3.2l-1 1M4.2 11.8l-1 1" />
      </svg>
    ),
  },
];

function isItemActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return pathname === '/' || pathname === '/dashboard' || pathname.startsWith('/create');
  }
  if (href === '/dashboard/discover') {
    return pathname.startsWith('/dashboard/discover') || pathname.startsWith('/discover/');
  }
  if (href === '/dashboard/agents') {
    return pathname.startsWith('/dashboard/agents') || pathname.startsWith('/agent/');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({
  pathname,
  items,
  onNavigate,
}: {
  pathname: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <>
      {items.map((item) => {
        const isActive = isItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-surface-overlay text-ink'
                : 'text-ink-secondary hover:bg-surface-overlay/50 hover:text-ink'
            }`}
          >
            <span className={isActive ? 'text-brand-500' : 'text-ink-muted'}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
  onClose,
}: {
  pathname: string;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 items-center justify-between px-5">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4" fill="currentColor" className="text-brand-500" />
            <circle cx="12" cy="3.5" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.7" />
            <circle cx="19.5" cy="8" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.5" />
            <circle cx="19.5" cy="16" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.4" />
            <circle cx="12" cy="20.5" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.5" />
            <circle cx="4.5" cy="16" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.6" />
            <circle cx="4.5" cy="8" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.7" />
          </svg>
          <span>
            agents<span className="text-brand-500">.haus</span>
          </span>
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink md:hidden"
            aria-label="Close navigation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        )}
      </div>

      <nav className="mt-1 flex flex-col gap-0.5 px-3">
        <NavList pathname={pathname} items={MAIN_NAV_ITEMS} onNavigate={onNavigate} />
      </nav>

      <div className="flex-1" />

      <nav className="flex flex-col gap-0.5 border-t border-border-light px-3 py-3">
        <NavList pathname={pathname} items={FOOTER_NAV_ITEMS} onNavigate={onNavigate} />
      </nav>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-raised text-ink-muted shadow-sm transition-colors hover:bg-surface-overlay hover:text-ink md:hidden"
        aria-label="Open navigation"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <div
        className={`fixed inset-0 z-40 bg-ink/35 backdrop-blur-[1px] transition-opacity duration-200 md:hidden ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden={!mobileOpen}
      />

      <aside
        className={`fixed left-0 top-0 z-50 flex h-dvh w-[260px] flex-col border-r border-border-light bg-surface transition-transform duration-200 md:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
          onClose={() => setMobileOpen(false)}
        />
      </aside>

      <aside className="hidden md:fixed md:left-0 md:top-0 md:z-40 md:flex md:h-dvh md:w-[240px] md:flex-col md:border-r md:border-border-light md:bg-surface">
        <SidebarContent pathname={pathname} />
      </aside>
    </>
  );
}
