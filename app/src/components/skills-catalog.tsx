'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SOLANA_SKILL_PACKS } from '@agents-haus/common';
import { AnimatedSkillLines } from './animated-skill-lines';

export function SkillsCatalog() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SOLANA_SKILL_PACKS;
    return SOLANA_SKILL_PACKS.filter((skill) => {
      return (
        skill.name.toLowerCase().includes(q) ||
        skill.slug.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q)
      );
    });
  }, [query]);

  const toggleSkill = (skillId: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skillId)
        ? prev.filter((id) => id !== skillId)
        : [...prev, skillId],
    );
  };

  const handleUseSelected = () => {
    const params = new URLSearchParams();
    if (selectedSkills.length > 0) {
      params.set('skills', selectedSkills.join(','));
    }
    const suffix = params.toString();
    router.push(suffix ? `/create?${suffix}` : '/create');
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="relative mb-8 overflow-hidden rounded-3xl border border-border-light bg-surface-raised p-5 sm:p-8 lg:p-10">
        <AnimatedSkillLines variant="light" className="absolute inset-0 h-full w-full opacity-65" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-surface-raised/95" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-500/12 via-transparent to-brand-500/8" />

        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs text-ink-secondary">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" />
            Solana Skills Directory
          </div>
          <h1 className="max-w-2xl text-2xl font-semibold leading-tight text-ink sm:text-5xl">
            Add skill packs to your agents
          </h1>
          <p className="mt-4 max-w-3xl text-sm text-ink-secondary sm:text-base">
            Pulled from `sendaifun/skills`. Select skills here, then apply them to a new agent in one click.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href="https://github.com/sendaifun/skills"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink sm:w-auto"
            >
              View Source Repo
            </a>
            <button
              type="button"
              onClick={handleUseSelected}
              className="w-full rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-600 sm:w-auto"
            >
              Use {selectedSkills.length > 0 ? `${selectedSkills.length} Selected` : 'Selected'} in New Agent
            </button>
          </div>
        </div>
      </section>

      <section className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Skills</h2>
          <p className="text-xs text-ink-muted">
            {filteredSkills.length} of {SOLANA_SKILL_PACKS.length} packs
          </p>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills..."
          className="w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none sm:w-80"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredSkills.map((skill) => {
          const selected = selectedSkills.includes(skill.id);
          return (
            <article
              key={skill.id}
              className={`rounded-2xl border p-4 transition-colors ${
                selected
                  ? 'border-ink bg-surface-raised'
                  : 'border-border-light bg-surface-raised hover:border-border'
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink">{skill.name}</h3>
                <button
                  type="button"
                  onClick={() => toggleSkill(skill.id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    selected
                      ? 'bg-ink text-surface'
                      : 'bg-surface-inset text-ink-secondary hover:bg-surface-overlay'
                  }`}
                >
                  {selected ? 'Added' : 'Add'}
                </button>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-ink-secondary">{skill.description}</p>
              <div className="flex items-center justify-between text-[11px] text-ink-muted">
                <span>{skill.slug}</span>
                <a
                  href={skill.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-700 hover:text-brand-600"
                >
                  Open
                </a>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
