'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Agents',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M13.5 8.5l-3-3M4.5 2.5l1.7 4.3L2 11l4.2-.2L8.5 15l1.3-4.2L14 9.5" />
      </svg>
    ),
  },
  {
    href: '/skills',
    label: 'Skills',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4.5h10M3 8h10M3 11.5h6" />
        <circle cx="12.5" cy="11.5" r="1.5" />
      </svg>
    ),
  },
  {
    href: '/hosting',
    label: 'Hosting',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5.5h10v5H3z" />
        <path d="M5 10.5v2M8 10.5v2M11 10.5v2" />
      </svg>
    ),
  },
  {
    href: '/system',
    label: 'System',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
        <path d="M5.5 8h5" />
        <path d="M8 5.5v5" />
      </svg>
    ),
  },
];

const FOOTER_NAV_ITEMS: NavItem[] = [
  {
    href: '/bookmarks',
    label: 'Bookmarks',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2.5h8v11l-4-2.5-4 2.5z" />
      </svg>
    ),
  },
  {
    href: '/terminal',
    label: 'Terminal',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
        <path d="M5 6l2 2-2 2" />
        <path d="M8.5 10h2.5" />
      </svg>
    ),
  },
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
    return pathname === '/' || pathname.startsWith('/dashboard') || pathname.startsWith('/agent/') || pathname.startsWith('/create');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ pathname, items }: { pathname: string; items: NavItem[] }) {
  return (
    <>
      {items.map((item) => {
        const isActive = isItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
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

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-dvh w-[240px] flex-col border-r border-border-light bg-surface">
      {/* Logo */}
      <div className="flex h-14 items-center px-5">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4" fill="currentColor" className="text-brand-500" />
            <circle cx="12" cy="3.5" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.7" />
            <circle cx="19.5" cy="8" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.5" />
            <circle cx="19.5" cy="16" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.4" />
            <circle cx="12" cy="20.5" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.5" />
            <circle cx="4.5" cy="16" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.6" />
            <circle cx="4.5" cy="8" r="2.5" fill="currentColor" className="text-brand-500" opacity="0.7" />
          </svg>
          <span>agents<span className="text-brand-500">.haus</span></span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-3 mt-1">
        <NavList pathname={pathname} items={MAIN_NAV_ITEMS} />
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer nav */}
      <nav className="flex flex-col gap-0.5 border-t border-border-light px-3 py-3">
        <NavList pathname={pathname} items={FOOTER_NAV_ITEMS} />
      </nav>
    </aside>
  );
}
