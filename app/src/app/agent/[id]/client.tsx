'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Address } from '@solana/kit';
import {
  useIdentityToken,
  useLinkAccount,
  usePrivy,
  useSolanaWallets,
} from '@privy-io/react-auth';
import { getAgentWalletPda, fetchAgentWalletBalance, fetchCurrentSoulOwner } from '@agents-haus/sdk';
import { useAgentState } from '@/hooks/use-agent-state';
import { useSolanaRpc } from '@/hooks/use-solana-rpc';
import { useAgentTransactions } from '@/hooks/use-agent-transactions';
import { useSendTransaction } from '@/hooks/use-send-transaction';
import { getPreferredSolanaWallet } from '@/lib/solana-wallet-preference';
import {
  DEFAULT_RUNTIME_PROVIDER,
  normalizeRuntimeProvider,
  type RuntimeProvider,
} from '@/lib/runtime-provider';
import { DEFAULT_LLM_MODELS } from '@agents-haus/common';
import {
  Strategy,
  STRATEGY_LABELS,
  truncateAddress,
  formatSol,
  lamportsToSol,
  solToLamports,
} from '@agents-haus/common';
import { findCurrentEpochStatus, type EpochStatus as EpochStatusData } from '@agents-haus/sdk';
import type { AgentState } from '@agents-haus/sdk';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/* ─── Types ─── */

interface MachineInfo {
  deployed: boolean;
  machineId?: string;
  state?: string;
  region?: string;
  name?: string;
  runtimeProvider?: RuntimeProvider | null;
  runtimeExecutor?: string | null;
  profileId?: string | null;
  skills?: string[];
  model?: string | null;
  hasGrokApiKey?: boolean;
  postingTopics?: string[];
  scheduler?: {
    enabled?: boolean | null;
    intervalMinutes?: number | null;
    startupDelaySeconds?: number | null;
    mode?: string | null;
    autoReclaim?: boolean | null;
  };
  telegram?: {
    enabled?: boolean | null;
    hasBotToken?: boolean;
    allowedChatIds?: string[];
    model?: string | null;
  };
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
}

interface CronJobInfo {
  schedule: string;
  command: string;
  marker: string;
  jobName: string | null;
  raw: string;
}

const CHAT_STORAGE_VERSION = 1;
const MAX_PERSISTED_CHAT_MESSAGES = 120;
const MAX_CHAT_MESSAGES = 120;
const MAX_GROK_API_KEY_LENGTH = 600;
const BALANCE_POLL_INTERVAL_MS = 15_000;
const CHAT_QUICK_PROMPTS = [
  {
    label: 'Try to automatically reclaim lost Alpha spots',
    message:
      'Try to automatically reclaim lost Alpha spots. Enable runtime auto reclaim and keep scheduler enabled every 10 minutes.',
  },
  {
    label: 'Make my first alpha post',
    message: 'Make my first alpha post with a concise intro memo.',
  },
  {
    label: 'Make a burn post',
    message: 'Make a burn post with a concise memo.',
  },
] as const;
const CHAT_SLASH_COMMANDS = [
  {
    label: 'Show auto reclaim settings',
    command: '/reclaim show',
    description: 'Show current auto-reclaim memo override and posting topics.',
  },
  {
    label: 'Set auto reclaim memo',
    command: '/reclaim memo ',
    description: 'Set exact memo text used for auto-reclaim posts.',
  },
  {
    label: 'Clear auto reclaim memo',
    command: '/reclaim memo clear',
    description: 'Clear memo override and fall back to Soul/topics context.',
  },
  {
    label: 'Set auto reclaim topics',
    command: '/reclaim topics ',
    description: 'Set topics used when memo is not explicit in Soul.',
  },
  {
    label: 'Show scheduler settings',
    command: '/scheduler show settings',
    description: 'Show runtime scheduler env configuration.',
  },
  {
    label: 'Enable auto reclaim scheduler',
    command: '/scheduler enable auto reclaim',
    description: 'Turn on runtime auto-reclaim behavior.',
  },
] as const;

function clampChatMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_CHAT_MESSAGES) return messages;
  return messages.slice(-MAX_CHAT_MESSAGES);
}

function isPersistedMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('role' in value) &&
    ('content' in value) &&
    ((value as { role?: unknown }).role === 'user' ||
      (value as { role?: unknown }).role === 'assistant') &&
    typeof (value as { content?: unknown }).content === 'string'
  );
}

function getModelName(modelId?: string): string | null {
  if (!modelId) return null;
  const normalized = modelId.trim();
  if (!normalized) return null;
  const found = DEFAULT_LLM_MODELS.find((entry) => entry.id === normalized);
  return found ? found.name : normalized;
}

function parsePostingTopics(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      return parsePostingTopics(JSON.parse(trimmed));
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return trimmed
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const OWNER_WALLET_NOT_LINKED_HINTS = new Set([
  'owner-wallet-not-linked',
  'identity-token-present-but-owner-wallet-not-linked',
]);

function parseAuthHint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function formatAgentApiError(payload: unknown, fallback: string): string {
  const message =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : fallback;
  const currentOwner =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { currentOwner?: unknown }).currentOwner === 'string'
      ? (payload as { currentOwner: string }).currentOwner
      : null;
  if (
    currentOwner &&
    message === 'Forbidden: current user is not the Soul NFT owner'
  ) {
    return `${message} (current owner: ${currentOwner})`;
  }
  return message;
}

interface DeployPreset {
  profileId: string;
  skills: string[];
  model: string | null;
  runtimeProvider: RuntimeProvider;
}

/* ─── Icons ─── */

function IconSettings({ className = '' }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconPanel({ className = '' }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

function IconSend({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  );
}

function IconX({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconBack({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function CopyAddressButton({
  value,
  className = '',
}: {
  value: string | null;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Ignore clipboard failures silently.
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!value}
      className={className}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/* ─── Right Info Panel ─── */

function InfoPanel({
  agentState,
  walletBalance,
  agentWalletAddress,
  machineState,
  soulMint,
}: {
  agentState: AgentState;
  walletBalance: bigint;
  agentWalletAddress: string | null;
  machineState: string | null;
  soulMint: string;
}) {
  const { rpc } = useSolanaRpc();
  const [epochStatus, setEpochStatus] = useState<EpochStatusData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await findCurrentEpochStatus(rpc);
        if (result && !cancelled) setEpochStatus(result.status);
      } catch { /* ignore */ }
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [rpc]);

  const strategyLabel = STRATEGY_LABELS[agentState.strategy as Strategy] || 'Unknown';
  const isAgentAlpha = agentWalletAddress && epochStatus?.topAlpha === agentWalletAddress;
  const isAgentBurner = agentWalletAddress && epochStatus?.topBurner === agentWalletAddress;

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto px-4 py-4 text-sm">
      {/* Agent identity */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-block h-2 w-2 rounded-full ${agentState.isActive ? 'bg-success' : 'bg-ink-muted'}`} />
          <span className="text-xs font-medium text-ink">{agentState.isActive ? 'Active' : 'Paused'}</span>
          {machineState && (
            <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              machineState === 'started' ? 'bg-success/10 text-success' : 'bg-surface-inset text-ink-muted'
            }`}>
              {machineState}
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-ink-muted truncate">{soulMint}</div>
      </div>

      {/* Wallet */}
      <div className="rounded-xl bg-surface-inset p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-[10px] text-ink-muted uppercase tracking-wider">Wallet</div>
          <CopyAddressButton
            value={agentWalletAddress}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
        <div className="text-lg font-mono font-bold text-ink">
          {lamportsToSol(walletBalance).toFixed(4)}
          <span className="text-xs text-ink-muted font-normal ml-1">SOL</span>
        </div>
        <div className="mt-1 break-all font-mono text-[10px] text-ink-muted">
          {agentWalletAddress || 'Loading PDA wallet...'}
        </div>
      </div>

      {/* Epoch */}
      <div className="rounded-xl bg-surface-inset p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-ink-muted uppercase tracking-wider">Epoch</span>
          <span className="font-mono text-xs text-ink">{epochStatus ? Number(epochStatus.epoch) : '—'}</span>
        </div>
        <div className="space-y-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-ink-muted">Alpha</span>
              {isAgentAlpha && <span className="text-[9px] bg-warning/10 text-warning px-1 py-0.5 rounded-full font-medium">YOU</span>}
            </div>
            <div className="font-mono text-[11px] text-ink-muted">{epochStatus?.topAlpha ? truncateAddress(epochStatus.topAlpha as string) : '—'}</div>
            <div className="font-mono text-xs text-ink">{epochStatus ? `${lamportsToSol(epochStatus.topAlphaAmount).toFixed(4)} SOL` : '—'}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-ink-muted">Burner</span>
              {isAgentBurner && <span className="text-[9px] bg-brand-500/10 text-brand-500 px-1 py-0.5 rounded-full font-medium">YOU</span>}
            </div>
            <div className="font-mono text-[11px] text-ink-muted">{epochStatus?.topBurner ? truncateAddress(epochStatus.topBurner as string) : '—'}</div>
            <div className="font-mono text-xs text-ink">{epochStatus ? `${Number(epochStatus.topBurnAmount).toLocaleString()} tokens` : '—'}</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-xl bg-surface-inset p-3">
        <div className="text-[10px] text-ink-muted uppercase tracking-wider mb-2">Stats</div>
        <div className="space-y-1.5 text-xs">
          <Row label="Strategy" value={strategyLabel} />
          <Row label="Tips" value={agentState.totalTips.toString()} mono />
          <Row label="Burns" value={agentState.totalBurns.toString()} mono />
          <Row label="SOL Spent" value={formatSol(agentState.totalSolSpent)} mono />
          <Row label="Tokens Burned" value={(Number(agentState.totalTokensBurned) / 1_000_000).toLocaleString()} mono />
          <Row label="Rewards" value={`${formatSol(agentState.totalRewards)} SOL`} mono className="text-success" />
          <div className="border-t border-border-light pt-1.5 mt-1.5 space-y-1.5">
            <Row label="Alpha Wins" value={agentState.epochsWonAlpha.toString()} mono />
            <Row label="Burner Wins" value={agentState.epochsWonBurner.toString()} mono />
          </div>
        </div>
      </div>

      <div className="text-[10px] text-ink-muted text-center">
        Created {new Date(Number(agentState.createdAt) * 1000).toLocaleDateString()}
        {agentState.lastActivity > BigInt(0) && (
          <> · Active {new Date(Number(agentState.lastActivity) * 1000).toLocaleDateString()}</>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className={`${mono ? 'font-mono' : 'font-medium'} ${className || 'text-ink'}`}>{value}</span>
    </div>
  );
}

/* ─── Settings Modal ─── */

type SettingsTab = 'general' | 'runtime' | 'wallet';

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: 'runtime',
    label: 'Runtime',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
  },
  {
    id: 'wallet',
    label: 'Wallet',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
        <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
      </svg>
    ),
  },
];

function SettingsModal({
  soulMint,
  agentState,
  isOwner,
  currentOwner,
  walletBalance,
  machineState,
  machineInfo,
  onRefresh,
  onClose,
  onDeploy,
  onMachineAction,
}: {
  soulMint: string;
  agentState: AgentState;
  isOwner: boolean;
  currentOwner: string | null;
  walletBalance: bigint;
  machineState: string | null;
  machineInfo: MachineInfo | null;
  onRefresh: () => void;
  onClose: () => void;
  onDeploy: () => Promise<void>;
  onMachineAction: (action: 'start' | 'stop') => Promise<void>;
}) {
  const { authenticated, login, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { updateConfig, updateExecutor, fundAgent, withdrawFromAgent } = useAgentTransactions();
  const { sendTransaction } = useSendTransaction();

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('Wallet session expired. Reconnect and try again.');
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (identityToken) {
      headers['X-Privy-Identity-Token'] = identityToken;
    }
    return headers;
  }, [getAccessToken, identityToken]);

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newExecutor, setNewExecutor] = useState('');
  const [showExecutorInput, setShowExecutorInput] = useState(false);
  const [fundMode, setFundMode] = useState<'fund' | 'withdraw' | null>(null);
  const [fundAmount, setFundAmount] = useState('');
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([]);
  const [cronLoading, setCronLoading] = useState(false);
  const [cronAvailable, setCronAvailable] = useState<boolean | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);
  const [grokApiKeyDraft, setGrokApiKeyDraft] = useState('');
  const [grokDraftSavedAt, setGrokDraftSavedAt] = useState<string | null>(null);
  const [telegramBotTokenDraft, setTelegramBotTokenDraft] = useState('');
  const [telegramAllowedChatIdsDraft, setTelegramAllowedChatIdsDraft] = useState('');
  const [telegramDraftSavedAt, setTelegramDraftSavedAt] = useState<string | null>(null);

  const handleToggleActive = async () => {
    if (!authenticated) { login(); return; }
    setLoading(true);
    setError(null);
    try {
      const ix = await updateConfig(soulMint, { isActive: !agentState.isActive });
      await sendTransaction([ix]);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStrategy = async (strategy: number) => {
    if (!authenticated) { login(); return; }
    if (strategy === agentState.strategy) return;
    setLoading(true);
    setError(null);
    try {
      const ix = await updateConfig(soulMint, { strategy });
      await sendTransaction([ix]);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateExecutor = async () => {
    if (!authenticated) { login(); return; }
    if (!newExecutor.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const ix = await updateExecutor(soulMint, newExecutor.trim());
      await sendTransaction([ix]);
      setNewExecutor('');
      setShowExecutorInput(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  const handleFundAction = async () => {
    if (!authenticated) { login(); return; }
    const solAmount = parseFloat(fundAmount);
    if (isNaN(solAmount) || solAmount <= 0) { setError('Enter a valid amount'); return; }
    if (fundMode === 'withdraw' && solToLamports(solAmount) > walletBalance) { setError('Insufficient balance'); return; }
    setLoading(true);
    setError(null);
    try {
      const lamports = solToLamports(solAmount);
      const ix = fundMode === 'fund'
        ? await fundAgent(soulMint, lamports)
        : await withdrawFromAgent(soulMint, lamports);
      await sendTransaction([ix]);
      setFundAmount('');
      setFundMode(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  const runtimeExecutor = machineInfo?.runtimeExecutor || null;
  const chainExecutor = agentState.executor as string;
  const executorMismatch = Boolean(
    runtimeExecutor && chainExecutor && runtimeExecutor !== chainExecutor,
  );

  const handleDeployRuntime = async () => {
    setLoading(true);
    setError(null);
    try {
      await onDeploy();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Runtime deploy failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchCronJobs = useCallback(async () => {
    setCronLoading(true);
    setCronError(null);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/agent/${soulMint}/cron`, { cache: 'no-store', headers: authHeaders });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch cron jobs');
      }

      const jobs = Array.isArray(data?.jobs)
        ? data.jobs.filter(
            (value: unknown): value is CronJobInfo =>
              typeof value === 'object' &&
              value !== null &&
              typeof (value as { schedule?: unknown }).schedule === 'string' &&
              typeof (value as { command?: unknown }).command === 'string' &&
              typeof (value as { marker?: unknown }).marker === 'string' &&
              typeof (value as { raw?: unknown }).raw === 'string',
          )
        : [];

      setCronJobs(jobs);
      setCronAvailable(
        typeof data?.available === 'boolean' ? data.available : true,
      );

      if (data?.ok === false && typeof data?.error === 'string') {
        setCronError(data.error);
      }
    } catch (err) {
      setCronJobs([]);
      setCronAvailable(null);
      setCronError(err instanceof Error ? err.message : 'Failed to fetch cron jobs');
    } finally {
      setCronLoading(false);
    }
  }, [soulMint, getAuthHeaders]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedGrokApiKey =
      localStorage.getItem(`agent-grok-api-key:${soulMint}`)?.trim() || '';
    const storedBotToken =
      localStorage.getItem(`agent-telegram-bot-token:${soulMint}`)?.trim() || '';
    const storedAllowedChatIds =
      localStorage.getItem(`agent-telegram-chat-ids:${soulMint}`)?.trim() || '';
    setGrokApiKeyDraft(storedGrokApiKey);
    setTelegramBotTokenDraft(storedBotToken);
    setTelegramAllowedChatIdsDraft(storedAllowedChatIds);
    setGrokDraftSavedAt(null);
    setTelegramDraftSavedAt(null);
  }, [soulMint]);

  const saveGrokDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    const grokApiKey = grokApiKeyDraft.trim();

    if (grokApiKey) {
      localStorage.setItem(`agent-grok-api-key:${soulMint}`, grokApiKey);
    } else {
      localStorage.removeItem(`agent-grok-api-key:${soulMint}`);
    }

    setGrokDraftSavedAt(new Date().toISOString());
  }, [grokApiKeyDraft, soulMint]);

  const saveTelegramDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    const token = telegramBotTokenDraft.trim();
    const chatIds = telegramAllowedChatIdsDraft.trim();

    if (token) {
      localStorage.setItem(`agent-telegram-bot-token:${soulMint}`, token);
    } else {
      localStorage.removeItem(`agent-telegram-bot-token:${soulMint}`);
    }

    if (chatIds) {
      localStorage.setItem(`agent-telegram-chat-ids:${soulMint}`, chatIds);
    } else {
      localStorage.removeItem(`agent-telegram-chat-ids:${soulMint}`);
    }

    setTelegramDraftSavedAt(new Date().toISOString());
  }, [soulMint, telegramAllowedChatIdsDraft, telegramBotTokenDraft]);

  useEffect(() => {
    if (activeTab !== 'runtime') return;

    void fetchCronJobs();
    const intervalId = setInterval(() => {
      void fetchCronJobs();
    }, 30_000);

    return () => clearInterval(intervalId);
  }, [activeTab, fetchCronJobs]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={onClose} />
      <div className="settings-modal-enter relative flex h-[100dvh] w-full flex-col overflow-hidden bg-surface-raised shadow-xl sm:h-[min(520px,80vh)] sm:max-w-[680px] sm:flex-row sm:rounded-2xl sm:border sm:border-border">
        {/* Left nav */}
        <div className="shrink-0 border-b border-border-light px-3 py-3 sm:w-44 sm:border-b-0 sm:border-r sm:px-3 sm:py-5">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-muted sm:mb-3 sm:px-3">
            Settings
          </h2>
          <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:gap-0.5">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-surface-overlay text-ink'
                    : 'text-ink-secondary hover:bg-surface-overlay/50 hover:text-ink'
                }`}
              >
                <span className={activeTab === tab.id ? 'text-brand-500' : 'text-ink-muted'}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Close button */}
          <div className="flex justify-end px-4 pb-0 pt-3 sm:pt-4">
            <button onClick={onClose} className="rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors">
              <IconX />
            </button>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto px-4 pb-5 pt-2 sm:px-6 sm:pb-6">
            {error && <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-2 text-xs text-danger mb-4">{error}</div>}

            {/* General tab */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                {/* Agent Status */}
                <div className="rounded-xl border border-border-light p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-ink">Agent Status</div>
                      <div className="text-xs text-ink-muted mt-0.5">{agentState.isActive ? 'Agent is running' : 'Agent is paused'}</div>
                    </div>
                    {isOwner && (
                      <button
                        onClick={handleToggleActive}
                        disabled={loading}
                        className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                          agentState.isActive ? 'bg-danger/10 text-danger hover:bg-danger/15' : 'bg-success/10 text-success hover:bg-success/15'
                        }`}
                      >
                        {agentState.isActive ? 'Pause' : 'Resume'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Strategy */}
                <div className="rounded-xl border border-border-light p-4">
                  <div className="text-sm font-medium text-ink mb-1">Strategy</div>
                  <div className="text-xs text-ink-muted mb-3">How your agent participates in epochs</div>
                  {isOwner ? (
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.values(Strategy).filter((v) => typeof v === 'number') as Strategy[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => handleUpdateStrategy(s)}
                          disabled={loading}
                          className={`rounded-xl px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                            agentState.strategy === s ? 'bg-ink text-surface' : 'bg-surface-inset text-ink-secondary hover:bg-surface-overlay'
                          }`}
                        >
                          {STRATEGY_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-ink">{STRATEGY_LABELS[agentState.strategy as Strategy]}</div>
                  )}
                </div>

                {/* Executor */}
                <div className="rounded-xl border border-border-light p-4">
                  <div className="text-sm font-medium text-ink mb-1">Executor</div>
                  <div className="text-xs text-ink-muted font-mono mb-2">{truncateAddress(agentState.executor as string, 8)}</div>
                  <div className="mb-2 text-[10px] text-ink-muted">
                    Runtime signing key is managed in Runtime settings. If this value changes, redeploy runtime to sync keys.
                  </div>
                  {isOwner && !showExecutorInput && (
                    <button onClick={() => setShowExecutorInput(true)} className="text-xs text-brand-500 hover:text-brand-700 font-medium transition-colors">Change executor</button>
                  )}
                  {isOwner && showExecutorInput && (
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input value={newExecutor} onChange={(e) => setNewExecutor(e.target.value)} placeholder="New executor pubkey" className="w-full rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink transition-colors focus:border-ink focus:outline-none sm:flex-1" />
                      <button onClick={handleUpdateExecutor} disabled={loading} className="w-full rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50 sm:w-auto">Save</button>
                      <button onClick={() => { setShowExecutorInput(false); setNewExecutor(''); }} className="text-left text-xs text-ink-muted transition-colors hover:text-ink-secondary sm:text-center">Cancel</button>
                    </div>
                  )}
                </div>

                {/* Owner info */}
                <div className="text-[10px] text-ink-muted">
                  Owner: <span className="font-mono">{truncateAddress(currentOwner || (agentState.owner as string), 8)}</span>
                  {' · '}
                  Soul: <span className="font-mono">{truncateAddress(agentState.soulMint as string, 8)}</span>
                </div>
              </div>
            )}

            {/* Runtime tab */}
            {activeTab === 'runtime' && (
              <div className="space-y-5">
                <div className="rounded-xl border border-border-light p-4">
                  <div className="text-sm font-medium text-ink mb-1">Runtime Status</div>
                  {machineInfo && !machineInfo.deployed && (
                    <>
                      <div className="text-xs text-ink-muted mb-3">Runtime not deployed yet.</div>
                      <div className="text-xs text-ink-muted mb-3">
                        Runtime defaults to OpenClaw unless an IronClaw preset is saved for this agent.
                      </div>
                      <button onClick={handleDeployRuntime} disabled={loading} className="w-full rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-black hover:bg-brand-600 transition-colors disabled:opacity-50">
                        Deploy Runtime
                      </button>
                    </>
                  )}
                  {machineInfo?.deployed && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`inline-block h-2 w-2 rounded-full ${machineState === 'started' ? 'bg-success' : 'bg-ink-muted'}`} />
                        <span className="text-ink font-medium">{machineState || 'unknown'}</span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-ink-muted">Runtime</span>
                          <span className="font-mono text-ink">
                            {machineInfo.runtimeProvider === 'ironclaw' ? 'ironclaw' : 'openclaw'}
                          </span>
                        </div>
                        <div className="flex justify-between"><span className="text-ink-muted">Region</span><span className="font-mono text-ink">{machineInfo.region || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-ink-muted">Machine</span><span className="font-mono text-ink-muted">{machineInfo.machineId?.slice(0, 12) || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-ink-muted">Runtime executor</span><span className="font-mono text-ink">{runtimeExecutor ? truncateAddress(runtimeExecutor, 8) : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-ink-muted">On-chain executor</span><span className="font-mono text-ink">{truncateAddress(chainExecutor, 8)}</span></div>
                        <div className="flex justify-between">
                          <span className="text-ink-muted">Automation</span>
                          <span className="font-mono text-ink">
                            {machineInfo.scheduler?.enabled === true ? 'enabled' : machineInfo.scheduler?.enabled === false ? 'disabled' : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-muted">Grok key</span>
                          <span className="font-mono text-ink">
                            {machineInfo.hasGrokApiKey ? 'configured' : 'not set'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-muted">Telegram</span>
                          <span className="font-mono text-ink">
                            {machineInfo.telegram?.enabled === true
                              ? 'enabled'
                              : machineInfo.telegram?.hasBotToken
                                ? 'token set'
                                : 'disabled'}
                          </span>
                        </div>
                        {Array.isArray(machineInfo.telegram?.allowedChatIds) &&
                          machineInfo.telegram.allowedChatIds.length > 0 && (
                            <div className="flex justify-between gap-3">
                              <span className="text-ink-muted">TG chats</span>
                              <span className="font-mono text-ink text-right break-all">
                                {machineInfo.telegram.allowedChatIds.join(', ')}
                              </span>
                            </div>
                          )}
                        {machineInfo.scheduler?.enabled === true && (
                          <div className="flex justify-between">
                            <span className="text-ink-muted">Interval</span>
                            <span className="font-mono text-ink">
                              {machineInfo.scheduler.intervalMinutes || 10}m ({machineInfo.scheduler.mode || 'alpha-maintenance'})
                            </span>
                          </div>
                        )}
                        {executorMismatch && (
                          <div className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-warning">
                            Runtime executor differs from on-chain executor. Redeploy runtime to sync keys before funding.
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                        <button onClick={handleDeployRuntime} disabled={loading} className="flex-1 rounded-xl bg-brand-500 px-3 py-2 text-xs font-medium text-black hover:bg-brand-600 transition-colors disabled:opacity-50">Redeploy</button>
                        {machineState === 'stopped' && (
                          <button onClick={() => onMachineAction('start')} disabled={loading} className="flex-1 rounded-xl bg-success/10 text-success px-3 py-2 text-xs font-medium hover:bg-success/15 transition-colors disabled:opacity-50">Start</button>
                        )}
                        {machineState === 'started' && (
                          <button onClick={() => onMachineAction('stop')} disabled={loading} className="flex-1 rounded-xl bg-danger/10 text-danger px-3 py-2 text-xs font-medium hover:bg-danger/15 transition-colors disabled:opacity-50">Stop</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border-light p-4">
                  <div className="text-sm font-medium text-ink mb-1">Grok API Key</div>
                  <div className="text-xs text-ink-muted mb-3">
                    Saved locally for this browser and applied on the next deploy/redeploy so chat can use Grok-backed responses.
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">API key</label>
                      <input
                        type="password"
                        autoComplete="off"
                        value={grokApiKeyDraft}
                        onChange={(e) =>
                          setGrokApiKeyDraft(
                            e.target.value.slice(0, MAX_GROK_API_KEY_LENGTH),
                          )
                        }
                        placeholder={machineInfo?.hasGrokApiKey ? 'Already configured on runtime' : 'xai-...'}
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs font-mono text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
                      />
                      <p className="mt-1 text-[10px] text-ink-muted">
                        Store a per-agent key locally, then redeploy to inject it into runtime as <span className="font-mono">GROK_API_KEY</span>.
                      </p>
                    </div>

                    {isOwner ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={saveGrokDraft}
                          className="flex-1 rounded-xl border border-border px-3 py-2 text-xs font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
                        >
                          Save Local
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            saveGrokDraft();
                            await handleDeployRuntime();
                          }}
                          disabled={loading}
                          className="flex-1 rounded-xl bg-brand-500 px-3 py-2 text-xs font-medium text-black hover:bg-brand-600 transition-colors disabled:opacity-50"
                        >
                          Save and Redeploy
                        </button>
                      </div>
                    ) : (
                      <div className="text-xs text-ink-muted">
                        Only the owner can redeploy runtime settings.
                      </div>
                    )}

                    {grokDraftSavedAt && (
                      <div className="text-[10px] text-ink-muted">
                        Local draft saved at {new Date(grokDraftSavedAt).toLocaleTimeString()}.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border-light p-4">
                  <div className="text-sm font-medium text-ink mb-1">Telegram Bridge</div>
                  <div className="text-xs text-ink-muted mb-3">
                    Saved locally for this browser and applied on the next deploy/redeploy.
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">Bot token</label>
                      <input
                        type="password"
                        autoComplete="off"
                        value={telegramBotTokenDraft}
                        onChange={(e) => setTelegramBotTokenDraft(e.target.value)}
                        placeholder={machineInfo?.telegram?.hasBotToken ? 'Already configured on runtime' : '123456:ABC-DEF...'}
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs font-mono text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">
                        Allowed chat IDs (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={telegramAllowedChatIdsDraft}
                        onChange={(e) => setTelegramAllowedChatIdsDraft(e.target.value)}
                        placeholder={
                          Array.isArray(machineInfo?.telegram?.allowedChatIds) &&
                          machineInfo.telegram.allowedChatIds.length > 0
                            ? machineInfo.telegram.allowedChatIds.join(', ')
                            : '-1001234567890, 123456789'
                        }
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs font-mono text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
                      />
                      <p className="mt-1 text-[10px] text-ink-muted">
                        Leave empty to allow all chats. Use numeric chat IDs from Telegram.
                      </p>
                    </div>

                    {machineInfo?.telegram?.model && (
                      <div className="text-[10px] text-ink-muted">
                        Runtime Telegram model override: <span className="font-mono">{machineInfo.telegram.model}</span>
                      </div>
                    )}

                    {isOwner ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={saveTelegramDraft}
                          className="flex-1 rounded-xl border border-border px-3 py-2 text-xs font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
                        >
                          Save Local
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            saveTelegramDraft();
                            await handleDeployRuntime();
                          }}
                          disabled={loading}
                          className="flex-1 rounded-xl bg-brand-500 px-3 py-2 text-xs font-medium text-black hover:bg-brand-600 transition-colors disabled:opacity-50"
                        >
                          Save and Redeploy
                        </button>
                      </div>
                    ) : (
                      <div className="text-xs text-ink-muted">Only the owner can redeploy runtime settings.</div>
                    )}

                    {telegramDraftSavedAt && (
                      <div className="text-[10px] text-ink-muted">
                        Local draft saved at {new Date(telegramDraftSavedAt).toLocaleTimeString()}.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border-light p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium text-ink">Local Cron Jobs</div>
                    <button
                      onClick={() => {
                        void fetchCronJobs();
                      }}
                      disabled={cronLoading}
                      className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium text-ink-secondary hover:bg-surface-overlay transition-colors disabled:opacity-50"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="text-xs text-ink-muted mb-3">
                    Jobs installed via <span className="font-mono">agent-cron.mjs</span> on this host.
                  </div>

                  {cronLoading && (
                    <div className="text-xs text-ink-muted">Loading cron jobs…</div>
                  )}

                  {!cronLoading && cronAvailable === false && (
                    <div className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
                      {cronError || 'crontab is not available in this environment.'}
                    </div>
                  )}

                  {!cronLoading && cronAvailable !== false && cronJobs.length === 0 && (
                    <div className="text-xs text-ink-muted">No active cron jobs for this agent.</div>
                  )}

                  {!cronLoading && cronAvailable !== false && cronJobs.length > 0 && (
                    <div className="space-y-2">
                      {cronJobs.map((job) => (
                        <div key={`${job.marker}:${job.schedule}`} className="rounded-lg border border-border-light bg-surface-inset px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2 text-[10px] mb-1">
                            <span className="text-ink-muted">{job.jobName || 'job'}</span>
                            <span className="font-mono text-ink">{job.schedule || '—'}</span>
                          </div>
                          <div className="font-mono text-[10px] text-ink-muted break-all">{job.command}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!cronLoading && cronAvailable !== false && cronError && (
                    <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
                      {cronError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Wallet tab */}
            {activeTab === 'wallet' && (
              <div className="space-y-5">
                <div className="rounded-xl border border-border-light p-4">
                  <div className="text-sm font-medium text-ink mb-1">Balance</div>
                  <div className="text-2xl font-mono font-bold text-ink mb-4">
                    {lamportsToSol(walletBalance).toFixed(4)} <span className="text-sm text-ink-muted font-sans font-normal">SOL</span>
                  </div>
                  {fundMode === null ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button onClick={() => setFundMode('fund')} className="flex-1 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-surface hover:bg-ink/90 transition-colors">Fund</button>
                      {isOwner && (
                        <button onClick={() => setFundMode('withdraw')} className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-ink-secondary hover:bg-surface-overlay transition-colors">Withdraw</button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input type="number" step="0.001" min="0" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} placeholder="0.00" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-mono text-ink transition-colors focus:border-ink focus:outline-none sm:flex-1" />
                        <span className="text-sm text-ink-muted">SOL</span>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button onClick={handleFundAction} disabled={loading} className="flex-1 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-surface disabled:opacity-50">
                          {loading ? 'Processing...' : fundMode === 'fund' ? 'Deposit' : 'Withdraw'}
                        </button>
                        <button onClick={() => { setFundMode(null); setFundAmount(''); setError(null); }} className="rounded-full border border-border px-4 py-2.5 text-sm text-ink-secondary hover:bg-surface-overlay transition-colors">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-ink-muted uppercase tracking-wider mb-2">{title}</div>
      {children}
    </div>
  );
}

/* ─── Model Selector ─── */

function ModelSelector({
  modelRef,
  modelOpen,
  setModelOpen,
  currentModel,
  selectedModel,
  setSelectedModel,
  size = 'sm',
}: {
  modelRef: React.RefObject<HTMLDivElement | null>;
  modelOpen: boolean;
  setModelOpen: (v: boolean) => void;
  currentModel: (typeof DEFAULT_LLM_MODELS)[number];
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  size?: 'sm' | 'lg';
}) {
  const isLg = size === 'lg';
  return (
    <div className="relative" ref={modelRef}>
      <button
        type="button"
        onClick={() => setModelOpen(!modelOpen)}
        className={`inline-flex items-center rounded-full border border-border-light text-ink-secondary hover:bg-surface-overlay transition-colors ${
          isLg ? 'gap-2 px-3.5 py-1.5 text-sm' : 'gap-1.5 px-2.5 py-0.5 text-[11px]'
        }`}
      >
        <svg width={isLg ? '14' : '10'} height={isLg ? '14' : '10'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        {currentModel.name}
        <svg width={isLg ? '10' : '8'} height={isLg ? '10' : '8'} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-ink-muted">
          <path d="M2.5 4L5 6.5L7.5 4" />
        </svg>
      </button>
      {modelOpen && (
        <div className={`absolute bottom-full left-0 mb-1 rounded-xl border border-border bg-surface-raised shadow-lg py-1 z-50 ${isLg ? 'w-60' : 'w-52'}`}>
          {DEFAULT_LLM_MODELS.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => { setSelectedModel(model.id); setModelOpen(false); }}
              className={`flex w-full items-center justify-between transition-colors ${
                isLg ? 'px-4 py-2 text-xs' : 'px-3 py-1.5 text-[11px]'
              } ${
                model.id === selectedModel ? 'bg-surface-overlay text-ink font-medium' : 'text-ink-secondary hover:bg-surface-overlay/50'
              }`}
            >
              <span>{model.name}</span>
              <span className={`text-ink-muted ${isLg ? 'text-[11px]' : 'text-[10px]'}`}>{model.provider}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatQuickPrompts({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (message: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {CHAT_QUICK_PROMPTS.map((prompt) => (
        <button
          key={prompt.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(prompt.message)}
          className="rounded-full border border-border-light bg-surface px-3 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-overlay disabled:opacity-40"
        >
          {prompt.label}
        </button>
      ))}
    </div>
  );
}

function ChatSlashCommandPicker({
  input,
  disabled,
  onSelect,
}: {
  input: string;
  disabled?: boolean;
  onSelect: (command: string) => void;
}) {
  const normalized = input.trimStart();
  if (!normalized.startsWith('/')) return null;

  const query = normalized.slice(1).toLowerCase();
  const matching = CHAT_SLASH_COMMANDS.filter((command) => {
    if (!query) return true;
    const haystack = `${command.command} ${command.label} ${command.description}`.toLowerCase();
    return haystack.includes(query);
  }).slice(0, 8);

  if (matching.length === 0) {
    return (
      <div className="mx-2 mt-2 rounded-xl border border-border-light bg-surface px-3 py-2 text-xs text-ink-muted">
        No matching slash command.
      </div>
    );
  }

  return (
    <div className="mx-2 mt-2 rounded-xl border border-border-light bg-surface p-1.5">
      {matching.map((command) => (
        <button
          key={`${command.label}:${command.command}`}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(command.command)}
          className="flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-overlay disabled:opacity-40"
        >
          <span className="min-w-0">
            <span className="block text-xs font-medium text-ink">{command.label}</span>
            <span className="block text-[11px] text-ink-muted">{command.description}</span>
          </span>
          <span className="shrink-0 rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            {command.command}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ─── Main Component ─── */

interface Props {
  soulMint: string;
}

export function AgentDetailClient({ soulMint }: Props) {
  const { authenticated, login, getAccessToken, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { linkWallet } = useLinkAccount();
  const { wallets } = useSolanaWallets();
  const searchParams = useSearchParams();
  const { rpc } = useSolanaRpc();
  const { data: agentState, isLoading, error, refetch } = useAgentState(soulMint as Address);
  const { updateExecutor } = useAgentTransactions();
  const { sendTransaction } = useSendTransaction();

  const [walletBalance, setWalletBalance] = useState<bigint>(BigInt(0));
  const [agentWalletAddress, setAgentWalletAddress] = useState<string | null>(null);
  const [currentSoulOwner, setCurrentSoulOwner] = useState<string | null>(null);
  const [machineInfo, setMachineInfo] = useState<MachineInfo | null>(null);
  const [machineState, setMachineState] = useState<string | null>(null);

  const [showPanel, setShowPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [deployPreset, setDeployPreset] = useState<DeployPreset>({
    profileId: 'balanced',
    skills: [],
    model: null,
    runtimeProvider: DEFAULT_RUNTIME_PROVIDER,
  });

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_LLM_MODELS[0].id);
  const [modelOpen, setModelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const currentModel = DEFAULT_LLM_MODELS.find((m) => m.id === selectedModel) || DEFAULT_LLM_MODELS[0];
  const queryProfile = searchParams.get('profile');
  const querySkills = searchParams.get('skills');
  const queryModel = searchParams.get('model');
  const chatStorageKey = `agent-chat:v${CHAT_STORAGE_VERSION}:${soulMint}`;
  const [chatHydrated, setChatHydrated] = useState(false);
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('Wallet session expired. Reconnect and try again.');
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (identityToken) {
      headers['X-Privy-Identity-Token'] = identityToken;
    }
    return headers;
  }, [getAccessToken, identityToken]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(chatStorageKey);
      if (!raw) {
        setChatHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw) as {
        messages?: unknown[];
        selectedModel?: unknown;
      };

      if (Array.isArray(parsed.messages)) {
        const persistedMessages = clampChatMessages(
          parsed.messages
            .filter(isPersistedMessage)
            .slice(-MAX_PERSISTED_CHAT_MESSAGES),
        );
        setMessages(persistedMessages);
      }

      if (typeof parsed.selectedModel === 'string' && parsed.selectedModel.trim()) {
        setSelectedModel(parsed.selectedModel.trim());
      }
    } catch {
      // Ignore malformed storage and continue with empty state.
    } finally {
      setChatHydrated(true);
    }
  }, [chatStorageKey]);

  useEffect(() => {
    if (!chatHydrated) return;
    try {
      localStorage.setItem(
        chatStorageKey,
        JSON.stringify({
          messages: clampChatMessages(messages).slice(-MAX_PERSISTED_CHAT_MESSAGES),
          selectedModel,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // Ignore storage quota/permission errors.
    }
  }, [chatHydrated, chatStorageKey, messages, selectedModel]);

  useEffect(() => {
    const parseSkills = (input: string | null): string[] =>
      (input || '')
        .split(',')
        .map((skill) => skill.trim())
        .filter(Boolean);

    const fromStorageRaw = localStorage.getItem(`agent-deploy-preset:${soulMint}`);
    let fromStorage: DeployPreset | null = null;
    if (fromStorageRaw) {
      try {
        const parsed = JSON.parse(fromStorageRaw);
        fromStorage = {
          profileId: typeof parsed.profileId === 'string' ? parsed.profileId : 'balanced',
          skills: Array.isArray(parsed.skills)
            ? parsed.skills.filter((v: unknown) => typeof v === 'string')
            : [],
          model: typeof parsed.model === 'string' ? parsed.model : null,
          runtimeProvider: normalizeRuntimeProvider(parsed.runtimeProvider),
        };
      } catch {
        fromStorage = null;
      }
    }

    const querySkillsList = parseSkills(querySkills);
    const machineSkills = Array.isArray(machineInfo?.skills)
      ? machineInfo.skills.filter((skill): skill is string => typeof skill === 'string')
      : [];
    const machineProfile =
      typeof machineInfo?.profileId === 'string' && machineInfo.profileId.trim()
        ? machineInfo.profileId.trim()
        : null;
    const machineModel =
      typeof machineInfo?.model === 'string' && machineInfo.model.trim()
        ? machineInfo.model.trim()
        : null;
    const machineRuntimeProvider = normalizeRuntimeProvider(
      machineInfo?.runtimeProvider,
    );

    const merged: DeployPreset = {
      profileId: queryProfile || fromStorage?.profileId || machineProfile || 'balanced',
      skills:
        querySkillsList.length > 0
          ? querySkillsList
          : fromStorage?.skills?.length
          ? fromStorage.skills
          : machineSkills,
      model: queryModel || fromStorage?.model || machineModel || null,
      runtimeProvider:
        fromStorage?.runtimeProvider ||
        machineRuntimeProvider ||
        DEFAULT_RUNTIME_PROVIDER,
    };

    setDeployPreset(merged);
    localStorage.setItem(`agent-deploy-preset:${soulMint}`, JSON.stringify(merged));
  }, [soulMint, queryModel, queryProfile, querySkills, machineInfo]);

  /* Data fetching */
  const fetchBalance = useCallback(async () => {
    try {
      const [agentWallet] = await getAgentWalletPda(soulMint as Address);
      setAgentWalletAddress(agentWallet as string);
      const balance = await fetchAgentWalletBalance(rpc, agentWallet);
      setWalletBalance(balance);
    } catch { /* */ }
  }, [soulMint, rpc]);

  const fetchMachine = useCallback(async () => {
    try {
      const headers = await getAuthHeaders().catch(() => null);
      if (!headers) return;
      const res = await fetch(`/api/agent/${soulMint}/machine`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMachineInfo(data);
        setMachineState(data.deployed ? (data.state || null) : null);
      }
    } catch { /* */ }
  }, [soulMint, getAuthHeaders]);

  const fetchSoulOwner = useCallback(async () => {
    try {
      const owner = await fetchCurrentSoulOwner(rpc, soulMint as Address);
      setCurrentSoulOwner(owner ? (owner as string) : null);
    } catch {
      setCurrentSoulOwner(null);
    }
  }, [soulMint, rpc]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);
  useEffect(() => { fetchSoulOwner(); }, [fetchSoulOwner]);
  useEffect(() => {
    fetchMachine();
    const iv = setInterval(fetchMachine, 15_000);
    return () => clearInterval(iv);
  }, [fetchMachine]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const handleRefresh = () => { refetch(); fetchBalance(); fetchMachine(); fetchSoulOwner(); };

  const clearConversation = useCallback(() => {
    setMessages([]);
    setChatError(null);
    setChatLoading(false);
    try {
      localStorage.removeItem(chatStorageKey);
    } catch {
      // Ignore storage errors.
    }
  }, [chatStorageKey]);

  const displayOwner = currentSoulOwner || (agentState ? (agentState.owner as string) : null);
  const connectedWalletAddresses = (wallets || [])
    .map((wallet) => wallet.address)
    .filter((address): address is string => typeof address === 'string' && address.trim().length > 0);
  const preferredWalletAddress =
    getPreferredSolanaWallet(wallets, user)?.address || null;
  const isOwner = Boolean(
    displayOwner &&
      (connectedWalletAddresses.includes(displayOwner) ||
        preferredWalletAddress === displayOwner),
  );
  const isRunning = machineState === 'started';

  /* Chat */
  const sendMessage = async (overrideMessage?: string) => {
    if (chatLoading) return;
    if (!authenticated) {
      login();
      return;
    }
    if (!isOwner) {
      setChatError('Only the current Soul owner can chat with this runtime.');
      return;
    }

    const userMessage = (overrideMessage ?? input).trim();
    if (!userMessage) return;
    const modelForRequest = selectedModel;
    const history = clampChatMessages(messages);
    setInput('');
    setChatError(null);
    setAuthHint(null);
    const newMessages: Message[] = clampChatMessages([
      ...history,
      { role: 'user', content: userMessage },
    ]);
    setMessages(newMessages);
    setChatLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/agent/${soulMint}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          message: userMessage,
          history,
          model: modelForRequest,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthHint(parseAuthHint(data?.authHint));
        setChatError(formatAgentApiError(data, 'Failed to get response'));
        return;
      }
      const responseModel =
        typeof data.model === 'string' && data.model.trim()
          ? data.model.trim()
          : modelForRequest;
      setMessages(
        clampChatMessages([
          ...newMessages,
          { role: 'assistant', content: data.response, model: responseModel },
        ]),
      );
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setChatLoading(false);
    }
  };

  const handleSelectSlashCommand = useCallback((command: string) => {
    setInput(command);
    setChatError(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const cursor = command.length;
      textareaRef.current.setSelectionRange(cursor, cursor);
    });
  }, []);

  /* Machine actions */
  const handleDeploy = async () => {
    if (!authenticated) {
      login();
      return;
    }

    setChatError(null);
    setAuthHint(null);
    setDeploying(true);
    try {
      const authHeaders = await getAuthHeaders();
      const storedSoulText =
        typeof window !== 'undefined'
          ? localStorage.getItem(`agent-soul-text:${soulMint}`)?.trim() || ''
          : '';
      const storedGrokApiKey =
        typeof window !== 'undefined'
          ? localStorage.getItem(`agent-grok-api-key:${soulMint}`)?.trim() || ''
          : '';
      const storedPostingTopicsRaw =
        typeof window !== 'undefined'
          ? localStorage.getItem(`agent-posting-topics:${soulMint}`)
          : null;
      const storedTelegramBotToken =
        typeof window !== 'undefined'
          ? localStorage.getItem(`agent-telegram-bot-token:${soulMint}`)?.trim() || ''
          : '';
      const storedTelegramAllowedChatIds =
        typeof window !== 'undefined'
          ? localStorage.getItem(`agent-telegram-chat-ids:${soulMint}`)?.trim() || ''
          : '';
      const storedPostingTopics = parsePostingTopics(storedPostingTopicsRaw);
      const fallbackPostingTopics = parsePostingTopics(machineInfo?.postingTopics);
      const fallbackTelegramAllowedChatIds = Array.isArray(
        machineInfo?.telegram?.allowedChatIds,
      )
        ? machineInfo.telegram.allowedChatIds.join(',')
        : '';
      const runtimePostingTopics =
        storedPostingTopics.length > 0
          ? storedPostingTopics
          : fallbackPostingTopics;
      const runtimeTelegramAllowedChatIds =
        storedTelegramAllowedChatIds || fallbackTelegramAllowedChatIds;
      const deployPayload = {
        force: true,
        profileId: deployPreset.profileId,
        skills: deployPreset.skills,
        model: deployPreset.model,
        runtimeProvider: deployPreset.runtimeProvider,
        ...(storedSoulText ? { soulText: storedSoulText } : {}),
        ...(storedGrokApiKey ? { grokApiKey: storedGrokApiKey } : {}),
        ...(storedTelegramBotToken
          ? { telegramBotToken: storedTelegramBotToken }
          : {}),
        ...(runtimeTelegramAllowedChatIds
          ? { telegramAllowedChatIds: runtimeTelegramAllowedChatIds }
          : {}),
        ...(runtimePostingTopics.length > 0
          ? { postingTopics: runtimePostingTopics }
          : {}),
      };

      const deployRes = await fetch(`/api/agent/${soulMint}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(deployPayload),
      });

      const deployData = await deployRes.json().catch(() => null);
      if (!deployRes.ok) {
        setAuthHint(parseAuthHint(deployData?.authHint));
        throw new Error(formatAgentApiError(deployData, 'Deploy failed'));
      }

      const runtimeExecutorAddress =
        typeof deployData?.runtimeExecutor === 'string' && deployData.runtimeExecutor.trim()
          ? deployData.runtimeExecutor.trim()
          : null;
      if (!runtimeExecutorAddress) {
        throw new Error('Deploy succeeded but runtime executor address was missing');
      }

      try {
        const ix = await updateExecutor(soulMint, runtimeExecutorAddress);
        await sendTransaction([ix]);
      } catch (updateErr) {
        // Roll back the machine so we do not leave runtime and on-chain executor out of sync.
        try {
          await fetch(`/api/agent/${soulMint}/machine`, {
            method: 'DELETE',
            headers: authHeaders,
          });
        } catch {
          // Best-effort rollback.
        }
        throw new Error(
          `Runtime deployed with executor ${truncateAddress(
            runtimeExecutorAddress,
            8,
          )}, but on-chain executor update failed. The runtime was destroyed to avoid key mismatch.`,
        );
      }

      await new Promise((r) => setTimeout(r, 2000));
      await fetchMachine();
    } catch (err) {
      console.error('Deploy error:', err);
      const message = err instanceof Error ? err.message : 'Deploy failed';
      setChatError(message);
      throw new Error(message);
    } finally {
      setDeploying(false);
    }
  };

  const handleMachineAction = async (action: 'start' | 'stop') => {
    if (!authenticated) {
      login();
      return;
    }

    try {
      setAuthHint(null);
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/agent/${soulMint}/machine/${action}`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setAuthHint(parseAuthHint(payload?.authHint));
        throw new Error(
          formatAgentApiError(payload, `Failed to ${action} runtime`),
        );
      }
      await new Promise((r) => setTimeout(r, 2000));
      await fetchMachine();
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Machine action failed');
    }
  };

  /* ─── Loading / Error ─── */
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-3.5rem)]">
        <div className="animate-pulse space-y-4 text-center">
          <div className="h-4 w-32 bg-surface-inset rounded-lg mx-auto" />
          <div className="h-3 w-48 bg-surface-inset rounded-lg mx-auto" />
        </div>
      </div>
    );
  }

  if (error || !agentState) {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-3.5rem)]">
        <div className="text-center max-w-sm">
          <div className="mb-3 inline-flex rounded-xl border border-border-light bg-surface p-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <p className="text-sm font-medium text-ink mb-1">{error ? error.message : 'Agent not found'}</p>
          <p className="text-xs text-ink-muted">This agent may not have been created yet, or the address is incorrect.</p>
        </div>
      </div>
    );
  }

  /* ─── Chat-centric layout ─── */
  const hasMessages = messages.length > 0 || chatLoading;
  const isBooting =
    machineState === 'starting' ||
    machineState === 'created' ||
    machineState === 'restarting';

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] overflow-hidden">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border-light px-3 py-2.5 sm:gap-3 sm:px-4">
          <Link href="/dashboard" className="rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors">
            <IconBack />
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${agentState.isActive ? 'bg-success' : 'bg-ink-muted'}`} />
            <span className="text-sm font-medium text-ink truncate">Agent</span>
            <span className="text-[11px] text-ink-muted font-mono truncate hidden sm:inline">{truncateAddress(soulMint, 4)}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <div className="shrink-0 rounded-lg border border-brand-500/35 bg-brand-500/10 px-2 py-1 sm:px-2.5 sm:py-1.5">
              <div className="text-[9px] font-medium uppercase tracking-[0.08em] text-brand-700/90 dark:text-brand-400/90">
                PDA Wallet
              </div>
              <div className="font-mono text-xs font-semibold text-brand-700 dark:text-brand-300 sm:text-sm">
                {lamportsToSol(walletBalance).toFixed(4)} <span className="text-[10px] font-medium sm:text-xs">SOL</span>
              </div>
            </div>
            <button
              onClick={clearConversation}
              disabled={chatLoading || messages.length === 0}
              className="rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors disabled:opacity-30"
              title="Clear conversation"
            >
              <IconX />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors"
              title="Settings"
            >
              <IconSettings />
            </button>
            <button
              onClick={() => setShowPanel(!showPanel)}
              className={`hidden rounded-lg p-1.5 transition-colors md:inline-flex ${showPanel ? 'text-brand-500 bg-brand-500/10' : 'text-ink-muted hover:text-ink hover:bg-surface-overlay'}`}
              title="Toggle info panel"
            >
              <IconPanel />
            </button>
          </div>
        </div>

        {/* Chat body */}
        {!isRunning && !hasMessages ? (
          isBooting ? (
            <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6">
              <div className="relative mb-6 h-28 w-28">
                <div className="absolute inset-[14px] rounded-full border border-brand-500/30 animate-pulse" />
                <div className="absolute inset-0 animate-[spin_7s_linear_infinite]">
                  <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-brand-500 shadow-[0_0_16px_rgba(127,192,62,0.55)]" />
                  <span className="absolute right-1.5 top-6 h-2.5 w-2.5 rounded-full bg-brand-500/70" />
                  <span className="absolute right-2.5 bottom-6 h-2.5 w-2.5 rounded-full bg-brand-500/60" />
                  <span className="absolute left-1/2 bottom-0 h-3 w-3 -translate-x-1/2 rounded-full bg-brand-500/65" />
                  <span className="absolute bottom-6 left-2.5 h-2.5 w-2.5 rounded-full bg-brand-500/70" />
                  <span className="absolute left-1.5 top-6 h-2.5 w-2.5 rounded-full bg-brand-500/60" />
                </div>
                <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500 shadow-[0_0_22px_rgba(127,192,62,0.65)]" />
              </div>
              <h2 className="text-lg font-semibold text-ink mb-1">Booting agent runtime…</h2>
              <p className="max-w-sm text-center text-sm text-ink-muted">
                Your machine is starting on Fly. Chat will unlock automatically once it is online.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6">
              <div className="w-full max-w-md rounded-2xl border border-border-light bg-surface-raised px-6 py-8 text-center">
                <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                    <rect x="2.5" y="2.5" width="19" height="19" rx="3" />
                    <path d="M8 12h8" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-ink mb-2">Agent is offline</h2>
                <p className="text-sm text-ink-muted">
                  Start the runtime to chat with your agent.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {machineInfo?.deployed ? (
                    <button
                      onClick={() => handleMachineAction('start')}
                      className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-black hover:bg-brand-600 transition-colors"
                    >
                      Start Runtime
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        handleDeploy().catch(() => {
                          // Error is surfaced via chatError state.
                        });
                      }}
                      disabled={deploying}
                      className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-black hover:bg-brand-600 transition-colors disabled:opacity-50"
                    >
                      {deploying ? 'Deploying...' : 'Deploy Runtime'}
                    </button>
                  )}
                  <button
                    onClick={() => setShowSettings(true)}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
                  >
                    Open Settings
                  </button>
                </div>
                {chatError && (
                  <div className="mt-3 rounded-xl bg-danger/5 px-3 py-2 text-left text-xs text-danger">
                    <div>{chatError}</div>
                    {OWNER_WALLET_NOT_LINKED_HINTS.has(authHint || '') && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => linkWallet()}
                          className="rounded-lg border border-danger/30 bg-surface px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger/10"
                        >
                          Link Wallet In Privy
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        ) : !hasMessages ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 pb-10 sm:px-6 sm:pb-16">
            <h2 className="mb-6 text-xl font-semibold text-ink sm:mb-10 sm:text-2xl">What should your agent do?</h2>
            <div className="w-full max-w-2xl">
              <div className="rounded-2xl border border-border bg-surface-raised shadow-sm">
                <ChatSlashCommandPicker
                  input={input}
                  disabled={chatLoading}
                  onSelect={handleSelectSlashCommand}
                />
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Ask anything... (type / for commands)"
                  rows={1}
                  className="w-full resize-none bg-transparent px-4 pb-2 pt-4 text-sm text-ink placeholder:text-ink-muted focus:outline-none sm:px-5 sm:pt-5 sm:text-base"
                />
                <div className="flex items-center justify-between px-3 pb-3 sm:px-4 sm:pb-3.5">
                  <ModelSelector
                    modelRef={modelRef}
                    modelOpen={modelOpen}
                    setModelOpen={setModelOpen}
                    currentModel={currentModel}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    size="lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void sendMessage();
                    }}
                    disabled={!input.trim()}
                    className="rounded-full p-2 text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors disabled:opacity-30"
                  >
                    <IconSend />
                  </button>
                </div>
              </div>
              <ChatQuickPrompts
                disabled={chatLoading}
                onSelect={(message) => {
                  void sendMessage(message);
                }}
              />
            </div>
            {chatError && (
              <div className="mt-4 rounded-xl bg-danger/5 px-3 py-2 text-xs text-danger">
                <div>{chatError}</div>
                {OWNER_WALLET_NOT_LINKED_HINTS.has(authHint || '') && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => linkWallet()}
                      className="rounded-lg border border-danger/30 bg-surface px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger/10"
                    >
                      Link Wallet In Privy
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6">
              <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[92%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[80%] sm:px-5 sm:py-3 sm:text-[15px] ${
                      msg.role === 'user'
                        ? 'bg-ink text-surface rounded-br-md'
                        : 'bg-surface-raised border border-border-light text-ink rounded-bl-md'
                    }`}>
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      {msg.role === 'assistant' && msg.model && (
                        <div className="mt-1 text-[10px] text-ink-muted/80">
                          Model: {getModelName(msg.model)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md border border-border-light bg-surface-raised px-4 py-2.5 text-sm text-ink-muted sm:px-5 sm:py-3 sm:text-[15px]">
                      <span className="inline-flex gap-1">
                        <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                        <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                        <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                      </span>
                    </div>
                  </div>
                )}
                {chatError && (
                  <div className="rounded-xl bg-danger/5 px-3 py-2 text-center text-xs text-danger">
                    <div>{chatError}</div>
                    {OWNER_WALLET_NOT_LINKED_HINTS.has(authHint || '') && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => linkWallet()}
                          className="rounded-lg border border-danger/30 bg-surface px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger/10"
                        >
                          Link Wallet In Privy
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Bottom input */}
            <div className="shrink-0 border-t border-border-light px-3 py-3 sm:px-4">
              <div className="max-w-2xl mx-auto">
                <div className="rounded-2xl border border-border bg-surface-raised">
                  <ChatSlashCommandPicker
                    input={input}
                    disabled={chatLoading}
                    onSelect={handleSelectSlashCommand}
                  />
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Message your agent... (type / for commands)"
                    disabled={chatLoading}
                    rows={1}
                    className="w-full resize-none bg-transparent px-4 pb-1.5 pt-3.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-50 sm:px-5 sm:pt-4 sm:text-base"
                  />
                  <div className="flex items-center justify-between px-3 pb-2.5 sm:px-4 sm:pb-3">
                    <ModelSelector
                      modelRef={modelRef}
                      modelOpen={modelOpen}
                      setModelOpen={setModelOpen}
                      currentModel={currentModel}
                      selectedModel={selectedModel}
                      setSelectedModel={setSelectedModel}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void sendMessage();
                      }}
                      disabled={chatLoading || !input.trim()}
                      className="rounded-full p-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors disabled:opacity-30"
                    >
                      <IconSend />
                    </button>
                  </div>
                </div>
                <ChatQuickPrompts
                  disabled={chatLoading}
                  onSelect={(message) => {
                    void sendMessage(message);
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Right info panel */}
      {showPanel && (
        <div className="w-72 border-l border-border-light bg-surface shrink-0 hidden md:block">
          <InfoPanel
            agentState={agentState}
            walletBalance={walletBalance}
            agentWalletAddress={agentWalletAddress}
            machineState={machineState}
            soulMint={soulMint}
          />
        </div>
      )}

      {/* Settings drawer */}
      {showSettings && (
        <SettingsModal
          soulMint={soulMint}
          agentState={agentState}
          isOwner={!!isOwner}
          currentOwner={displayOwner}
          walletBalance={walletBalance}
          machineState={machineState}
          machineInfo={machineInfo}
          onRefresh={handleRefresh}
          onClose={() => setShowSettings(false)}
          onDeploy={handleDeploy}
          onMachineAction={handleMachineAction}
        />
      )}
    </div>
  );
}
