'use client';

import { useTheme } from '@/components/theme-provider';
import { DEFAULT_THEME } from '@/lib/themes';

export default function SettingsPage() {
  const { theme, ready, themes, setTheme } = useTheme();

  return (
    <main className="px-10 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Customize appearance and switch between UI themes.</p>
      </div>

      <section className="max-w-4xl rounded-2xl border border-border bg-surface-raised">
        <div className="border-b border-border-light px-5 py-4">
          <h2 className="text-base font-semibold text-ink">Appearance & Theme</h2>
          <p className="mt-1 text-sm text-ink-muted">Choose one theme. Changes apply instantly and persist across sessions.</p>
        </div>

        <div className="p-4">
          <div className="space-y-2" role="radiogroup" aria-label="Theme selector">
            {themes.map((option) => {
              const isActive = ready ? theme === option.id : option.id === DEFAULT_THEME;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setTheme(option.id)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                    isActive
                      ? 'border-brand-500/50 bg-brand-500/10'
                      : 'border-border bg-surface hover:bg-surface-overlay/50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink">{option.label}</p>
                      {option.id === DEFAULT_THEME && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">{option.description}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      {option.swatches.map((swatch) => (
                        <span
                          key={swatch}
                          className="inline-block h-3.5 w-3.5 rounded-full border border-black/10"
                          style={{ backgroundColor: swatch }}
                        />
                      ))}
                    </div>
                  </div>

                  <span
                    className={`ml-3 inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                      isActive ? 'border-brand-500 bg-brand-500 text-black' : 'border-border text-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2.5 6.3l2.1 2.1 4.9-4.9" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
