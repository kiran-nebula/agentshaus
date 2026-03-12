'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { formatRunDate, formatCountdown, timeAgo } from '@/lib/time-utils';

interface AgentDetail {
  id: string;
  name: string;
  query: string;
  status: string;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  outputInterval: number;
  isPublic: boolean;
  updateCount: number;
  subscriberCount: number;
}

interface CitationPreview {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

interface Citation {
  id: string;
  url: string;
  previewData: CitationPreview | null;
}

interface AgentResultItem {
  id: string;
  runAt: string;
  content: string;
  headerImage: string | null;
  citations: Citation[];
  stats: {
    num_tool_calls: number;
    num_webpages_read: number;
    num_websites_visited: number;
    sec_saved: number;
  } | null;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function getFavicon(url: string): string {
  try {
    const domain = new URL(url).origin;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

function getSourceName(url: string): string {
  const domain = getDomain(url);
  const names: Record<string, string> = {
    'x.com': 'X',
    'twitter.com': 'X',
    'youtube.com': 'YouTube',
    'netflix.com': 'Netflix',
    'rottentomatoes.com': 'Rotten Tomatoes',
    'github.com': 'GitHub',
    'reddit.com': 'Reddit',
    'news.ycombinator.com': 'Hacker News',
    'arxiv.org': 'arXiv',
    'substack.com': 'Substack',
  };
  return names[domain] || domain.split('.').slice(-2, -1)[0] || domain;
}

export default function DiscoverAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [results, setResults] = useState<AgentResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('');

  const fetchAgent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/discover/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAgent(data.agent);
      setResults(data.results || []);
    } catch {
      setError('Failed to load agent details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  // Countdown timer
  useEffect(() => {
    if (!agent?.nextRunAt) return;
    const update = () => setCountdown(formatCountdown(agent.nextRunAt!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [agent?.nextRunAt]);

  if (loading) {
    return (
      <main className="min-h-[calc(100dvh-56px)]">
        <div className="py-20 text-center text-sm text-ink-muted">Loading agent...</div>
      </main>
    );
  }

  if (error || !agent) {
    return (
      <main className="min-h-[calc(100dvh-56px)]">
        <div className="py-20 text-center">
          <p className="text-sm text-danger">{error || 'Agent not found'}</p>
          <Link
            href="/dashboard/discover"
            className="mt-3 inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-brand-600"
          >
            Back to Discover
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-56px)]">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Header */}
        <h1 className="mb-2 text-3xl font-light text-ink sm:text-4xl">
          {agent.name}
        </h1>
        <p className="mb-4 text-sm italic text-ink-secondary leading-relaxed">
          {agent.query}
        </p>

        {/* Actions */}
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <button className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-surface transition-colors hover:bg-ink/80">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
            Subscribe to this Agent
          </button>
          <button className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-overlay">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            Remix
          </button>
          {agent.isPublic && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
              Public
            </span>
          )}
          {agent.subscriberCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {agent.subscriberCount} subscriber{agent.subscriberCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Status pill */}
        {agent.nextRunAt && countdown && (
          <div className="mb-10 flex justify-center">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-surface-raised px-4 py-2 shadow-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
              <span className="font-mono text-xs font-medium tracking-wider text-ink-secondary">
                NEXT RUN IN {countdown}
              </span>
            </div>
          </div>
        )}

        {/* Results */}
        {results.length === 0 && (
          <div className="py-12 text-center text-sm text-ink-muted">
            No results yet. This agent hasn&apos;t completed a run.
          </div>
        )}

        <div className="space-y-10">
          {results.map((result) => (
            <ResultEntry key={result.id} result={result} />
          ))}
        </div>
      </div>
    </main>
  );
}

function ResultEntry({ result }: { result: AgentResultItem }) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Extract a title from the HTML content (first <h1>-<h4> tag)
  const headingMatch = result.content.match(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/i);
  const title = headingMatch
    ? headingMatch[1].replace(/<[^>]+>/g, '')
    : 'Update';
  // Remove the first heading from body to avoid duplication
  const bodyContent = headingMatch
    ? result.content.replace(headingMatch[0], '').trim()
    : result.content;

  // Deduplicate citations by domain
  const uniqueSources = result.citations.reduce<
    { url: string; name: string; favicon: string }[]
  >((acc, citation) => {
    const domain = getDomain(citation.url);
    if (!acc.some((s) => getDomain(s.url) === domain)) {
      acc.push({
        url: citation.url,
        name: getSourceName(citation.url),
        favicon: getFavicon(citation.url),
      });
    }
    return acc;
  }, []);

  return (
    <article className="border-t border-border-light pt-8">
      {/* Date header */}
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {formatRunDate(result.runAt)}
      </p>

      {/* Title */}
      <h2 className="mb-4 text-xl font-normal text-ink sm:text-2xl">
        {title}
      </h2>

      {/* Header image */}
      {result.headerImage && (
        <div className="mb-5 overflow-hidden rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.headerImage}
            alt=""
            className="w-full object-cover"
            style={{ maxHeight: 360 }}
          />
        </div>
      )}

      {/* Content */}
      <div
        className="prose prose-sm max-w-none text-ink-secondary
          prose-headings:text-ink prose-headings:font-semibold
          prose-strong:text-ink
          prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline
          prose-ul:my-3 prose-li:my-0.5
          prose-p:leading-relaxed"
        dangerouslySetInnerHTML={{ __html: bodyContent }}
      />

      {/* Stats + Sources footer */}
      <div className="mt-5 space-y-3">
        {result.stats && result.stats.sec_saved > 0 && (
          <p className="text-xs text-ink-muted">
            Report generated using{' '}
            <span className="font-medium">
              {result.stats.num_tool_calls || result.stats.num_webpages_read || 0} tool calls
            </span>
            , saving you ~<span className="font-medium">{Math.round(result.stats.sec_saved / 60)} minutes</span> of research time.
          </p>
        )}

        {/* Source badges */}
        {uniqueSources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {uniqueSources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={source.favicon}
                  alt=""
                  width={14}
                  height={14}
                  className="rounded-sm"
                />
                {source.name}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-1">
        <button
          onClick={handleCopyLink}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink"
          title="Copy link"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          {copied ? 'Copied!' : ''}
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink"
          title="Copy content"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink"
          title="Thumbs up"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 10v12" />
            <path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88z" />
          </svg>
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink"
          title="Thumbs down"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 14V2" />
            <path d="M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88z" />
          </svg>
        </button>
      </div>
    </article>
  );
}
