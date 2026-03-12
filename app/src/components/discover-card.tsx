'use client';

import Link from 'next/link';
import { timeAgo } from '@/lib/time-utils';

const GRADIENTS = [
  'from-blue-600 via-purple-600 to-indigo-800',
  'from-emerald-600 via-teal-700 to-cyan-800',
  'from-orange-500 via-rose-600 to-pink-700',
  'from-violet-600 via-fuchsia-600 to-purple-800',
  'from-sky-500 via-blue-600 to-indigo-700',
  'from-amber-500 via-orange-600 to-red-700',
  'from-lime-500 via-green-600 to-emerald-700',
  'from-rose-500 via-pink-600 to-fuchsia-700',
];

interface DiscoverCardProps {
  id: string;
  name: string;
  query: string;
  lastRunAt: string | null;
  subscriberCount: number;
  headerImage?: string | null;
  index?: number;
}

export function DiscoverCard({
  id,
  name,
  query,
  lastRunAt,
  subscriberCount,
  headerImage,
  index = 0,
}: DiscoverCardProps) {
  const gradient = GRADIENTS[index % GRADIENTS.length];

  return (
    <Link
      href={`/discover/${id}`}
      className="group relative flex flex-col justify-end overflow-hidden rounded-2xl border border-border transition-all hover:border-brand-500/30 hover:shadow-md"
      style={{ minHeight: 220 }}
    >
      {/* Background: header image or gradient fallback */}
      {headerImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={headerImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
        </>
      ) : (
        <>
          <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-90`} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        </>
      )}

      <div className="relative z-10 p-5">
        {lastRunAt && (
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white/70">
            Updated {timeAgo(lastRunAt)}
          </p>
        )}
        <h3 className="mb-3 text-lg font-semibold leading-tight text-white line-clamp-3 drop-shadow-sm">
          {name}
        </h3>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm transition-colors group-hover:bg-white/25">
            Subscribe
          </span>
          {subscriberCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-white/70">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {subscriberCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
