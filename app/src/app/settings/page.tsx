'use client';

import { useEffect, useState } from 'react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { truncateAddress } from '@agents-haus/common';
import { useTheme } from '@/components/theme-provider';
import { DEFAULT_THEME } from '@/lib/themes';
import { getPreferredSolanaWallet } from '@/lib/solana-wallet-preference';

const NOTIFICATION_PREFS_KEY = 'agentshaus:notification-prefs';

interface NotificationPrefs {
  runtimeAlerts: boolean;
  epochRecaps: boolean;
  securityNotices: boolean;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  runtimeAlerts: true,
  epochRecaps: true,
  securityNotices: true,
};

interface ToggleRowProps {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, description, enabled, onToggle }: ToggleRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-overlay/50"
    >
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-xs text-ink-muted">{description}</div>
      </div>
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          enabled ? 'bg-brand-500' : 'bg-surface-inset'
        }`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const { theme, ready, themes, setTheme } = useTheme();
  const { authenticated, login, logout, user } = usePrivy();
  const { wallets } = useSolanaWallets();

  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);

  const walletAddress = getPreferredSolanaWallet(wallets)?.address || user?.wallet?.address || null;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIFICATION_PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
        setPrefs({
          runtimeAlerts:
            typeof parsed.runtimeAlerts === 'boolean'
              ? parsed.runtimeAlerts
              : DEFAULT_NOTIFICATION_PREFS.runtimeAlerts,
          epochRecaps:
            typeof parsed.epochRecaps === 'boolean'
              ? parsed.epochRecaps
              : DEFAULT_NOTIFICATION_PREFS.epochRecaps,
          securityNotices:
            typeof parsed.securityNotices === 'boolean'
              ? parsed.securityNotices
              : DEFAULT_NOTIFICATION_PREFS.securityNotices,
        });
      }
    } catch {
      setPrefs(DEFAULT_NOTIFICATION_PREFS);
    } finally {
      setPrefsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
  }, [prefs, prefsLoaded]);

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <section className="mb-6 rounded-2xl border border-border bg-surface-raised px-5 py-5 sm:px-6 sm:py-6">
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Manage appearance, wallet access, runtime defaults, and notification preferences.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-border bg-surface-raised">
          <div className="border-b border-border-light px-5 py-4">
            <h2 className="text-base font-semibold text-ink">Appearance & Theme</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Choose one theme. Changes apply instantly and persist across sessions.
            </p>
          </div>

          <div className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2" role="radiogroup" aria-label="Theme selector">
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

        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-surface-raised p-5">
            <h3 className="text-sm font-semibold text-ink">Wallet & Account</h3>
            <p className="mt-1 text-xs text-ink-muted">Connect a wallet to mint, fund, and manage your agents.</p>

            <div className="mt-4 rounded-xl border border-border-light bg-surface px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-muted">Current Wallet</div>
              <div className="mt-1 font-mono text-sm text-ink">
                {walletAddress ? truncateAddress(walletAddress, 8) : 'Not connected'}
              </div>
            </div>

            <button
              type="button"
              onClick={authenticated ? logout : login}
              className={`mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                authenticated
                  ? 'border border-border text-ink-secondary hover:bg-surface-overlay'
                  : 'bg-brand-500 text-black hover:bg-brand-600'
              }`}
            >
              {authenticated ? 'Disconnect Wallet' : 'Connect Wallet'}
            </button>
          </section>

          <section className="rounded-2xl border border-border bg-surface-raised p-5">
            <h3 className="text-sm font-semibold text-ink">Notifications</h3>
            <p className="mt-1 text-xs text-ink-muted">Choose which updates appear in your in-app activity feed.</p>
            <div className="mt-4 space-y-2.5">
              <ToggleRow
                label="Runtime Alerts"
                description="Machine deploy, start, and stop status updates."
                enabled={prefs.runtimeAlerts}
                onToggle={() => setPrefs((prev) => ({ ...prev, runtimeAlerts: !prev.runtimeAlerts }))}
              />
              <ToggleRow
                label="Epoch Recaps"
                description="TOP ALPHA / TOP BURNER movement and reward windows."
                enabled={prefs.epochRecaps}
                onToggle={() => setPrefs((prev) => ({ ...prev, epochRecaps: !prev.epochRecaps }))}
              />
              <ToggleRow
                label="Security Notices"
                description="Wallet ownership changes and executor updates."
                enabled={prefs.securityNotices}
                onToggle={() => setPrefs((prev) => ({ ...prev, securityNotices: !prev.securityNotices }))}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
