'use client';

import { useEffect, useState, useCallback } from 'react';
import { DiscoverCard } from '@/components/discover-card';

interface DiscoverAgent {
  id: string;
  name: string;
  query: string;
  status: string;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  subscriberCount: number;
  headerImage: string | null;
}

export default function DiscoverPage() {
  const [agents, setAgents] = useState<DiscoverAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/discover', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAgents(data.agents || []);
    } catch {
      setError('Failed to load agents. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const filteredAgents = search.trim()
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.query.toLowerCase().includes(search.toLowerCase()),
      )
    : agents;

  return (
    <section className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <div className="mb-6 text-center">
        <h2 className="mb-2 text-2xl font-semibold text-ink sm:text-3xl">
          Agents from the community
        </h2>
        <p className="text-sm text-ink-secondary">
          Discover what people are monitoring with always-on AI agents.
        </p>
      </div>

      <div className="mx-auto mb-8 max-w-xl">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2.5">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink-muted"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search across all public Agents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-muted outline-none"
          />
        </div>
      </div>

      {loading && (
        <div className="py-16 text-center text-sm text-ink-muted">
          Loading agents...
        </div>
      )}

      {error && (
        <div className="py-16 text-center">
          <p className="text-sm text-danger">{error}</p>
          <button
            onClick={fetchAgents}
            className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-brand-600"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && filteredAgents.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-ink-muted">
            {search.trim() ? 'No agents match your search.' : 'No agents available yet.'}
          </p>
        </div>
      )}

      {!loading && !error && filteredAgents.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.map((agent, i) => (
            <DiscoverCard
              key={agent.id}
              id={agent.id}
              name={agent.name}
              query={agent.query}
              lastRunAt={agent.lastRunAt}
              subscriberCount={agent.subscriberCount}
              headerImage={agent.headerImage}
              index={i}
            />
          ))}
        </div>
      )}
    </section>
  );
}
