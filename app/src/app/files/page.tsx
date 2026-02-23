'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Address } from '@solana/kit';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { fetchAgentsByOwner } from '@agents-haus/sdk';
import { STRATEGY_LABELS, truncateAddress, type Strategy } from '@agents-haus/common';
import { useSolanaRpc } from '@/hooks/use-solana-rpc';
import { getPreferredSolanaWallet } from '@/lib/solana-wallet-preference';

type FileRootKey = 'user' | 'workspace' | 'runtime' | 'tmp';

type RootDescriptor = {
  key: FileRootKey;
  label: string;
  rootPath: string;
};

type FileTreeNode = {
  type: 'file' | 'directory';
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  childCount?: number;
  truncated?: boolean;
  children?: FileTreeNode[];
};

type AgentMachineState = {
  deployed: boolean;
  state: string | null;
};

type AgentEntry = {
  soulMint: string;
  name: string;
  strategy: number;
  isActive: boolean;
  machine: AgentMachineState;
};

const TREE_FETCH_TIMEOUT_MS = 12000;

function defaultMachineState(): AgentMachineState {
  return { deployed: false, state: null };
}

const DEFAULT_ROOTS: RootDescriptor[] = [
  { key: 'user', label: 'Custom Files', rootPath: 'workspace/user-files' },
  { key: 'workspace', label: 'Workspace', rootPath: 'workspace' },
  { key: 'runtime', label: 'Runtime', rootPath: '.' },
  { key: 'tmp', label: 'Tmp', rootPath: '/tmp' },
];

function parseAssetName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function normalizeRelativePath(value: string): string {
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();
  return normalized || '.';
}

function getParentPath(value: string): string {
  const normalized = normalizeRelativePath(value);
  if (normalized === '.') return '.';
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 1) return '.';
  return segments.slice(0, -1).join('/');
}

function isRuntimeStarted(machine: AgentMachineState): boolean {
  return machine.deployed && machine.state?.toLowerCase() === 'started';
}

function TreeNodeRows({
  node,
  level,
  activePath,
  onOpenDirectory,
}: {
  node: FileTreeNode;
  level: number;
  activePath: string;
  onOpenDirectory: (path: string) => void;
}) {
  const isDirectory = node.type === 'directory';
  const normalizedNodePath = normalizeRelativePath(node.path);
  const isActiveDirectory =
    isDirectory && normalizedNodePath === normalizeRelativePath(activePath);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (isDirectory) onOpenDirectory(node.path);
        }}
        disabled={!isDirectory}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
          isDirectory
            ? isActiveDirectory
              ? 'bg-surface-overlay text-ink'
              : 'text-ink hover:bg-surface-overlay/70'
            : 'text-ink-secondary hover:bg-surface-overlay/40'
        }`}
        style={{ paddingLeft: `${10 + level * 18}px` }}
      >
        <span className="text-ink-muted">
          {isDirectory ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 2.5L6.5 5L3 7.5" />
            </svg>
          ) : (
            <span className="inline-block w-[10px]" />
          )}
        </span>
        <span className={isDirectory ? 'text-brand-500' : 'text-ink-muted'}>
          {isDirectory ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1 1H12.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 2.5h5l3 3v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1z" />
              <path d="M8.5 2.5v3h3" />
            </svg>
          )}
        </span>
        <span className="truncate">{node.name || '.'}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-muted">
          {isDirectory ? `${node.childCount ?? 0} items` : formatBytes(node.sizeBytes)}
        </span>
      </button>

      {isDirectory && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
          <TreeNodeRows
            key={`${child.path}:${child.name}:${child.type}`}
            node={child}
            level={level + 1}
            activePath={activePath}
            onOpenDirectory={onOpenDirectory}
          />
        ))}
      </div>
    )}
  </div>
  );
}

function ToolbarIconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-light bg-surface text-ink-secondary transition-colors hover:bg-surface-overlay disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export default function FilesPage() {
  const { authenticated, login, getAccessToken, user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { rpc } = useSolanaRpc();

  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selectedAgentMint, setSelectedAgentMint] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [roots, setRoots] = useState<RootDescriptor[]>(DEFAULT_ROOTS);
  const [selectedRoot, setSelectedRoot] = useState<FileRootKey>('user');
  const [pathInput, setPathInput] = useState('.');
  const [activePath, setActivePath] = useState('.');
  const [depth, setDepth] = useState(3);
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPath, setUploadPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const walletAddress = getPreferredSolanaWallet(wallets, user)?.address as Address | undefined;
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.soulMint === selectedAgentMint) || null,
    [agents, selectedAgentMint],
  );

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error('Wallet session expired. Reconnect and try again.');
    }
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }, [getAccessToken]);

  const fetchMachineStatesBulk = useCallback(
    async (soulMints: string[]): Promise<Record<string, AgentMachineState>> => {
      const normalized = Array.from(
        new Set(
          soulMints
            .map((mint) => mint.trim())
            .filter(Boolean),
        ),
      ).slice(0, 200);
      if (normalized.length === 0) return {};

      try {
        const response = await fetch('/api/agent/machines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ soulMints: normalized }),
          cache: 'no-store',
        });
        if (!response.ok) {
          return Object.fromEntries(
            normalized.map((mint) => [mint, defaultMachineState()]),
          );
        }

        const payload = await response.json().catch(() => ({}));
        const rawMachines =
          payload &&
          typeof payload === 'object' &&
          payload.machines &&
          typeof payload.machines === 'object'
            ? (payload.machines as Record<string, unknown>)
            : {};

        const result: Record<string, AgentMachineState> = {};
        for (const mint of normalized) {
          const machine =
            rawMachines[mint] && typeof rawMachines[mint] === 'object'
              ? (rawMachines[mint] as {
                  deployed?: unknown;
                  state?: unknown;
                })
              : null;
          result[mint] = {
            deployed: Boolean(machine?.deployed),
            state: typeof machine?.state === 'string' ? machine.state : null,
          };
        }
        return result;
      } catch {
        return Object.fromEntries(
          normalized.map((mint) => [mint, defaultMachineState()]),
        );
      }
    },
    [],
  );

  const loadAgents = useCallback(async () => {
    if (!authenticated || !walletAddress) {
      setAgents([]);
      setSelectedAgentMint(null);
      return;
    }

    setLoadingAgents(true);
    setAgentError(null);
    try {
      const owner = walletAddress as Address;
      const results = await fetchAgentsByOwner(rpc, owner);
      const soulMints = results.map(({ state }) => state.soulMint as string);
      const machineStates = await fetchMachineStatesBulk(soulMints);
      const entries = results.map(({ state }) => {
        const soulMint = state.soulMint as string;
        const cachedName = parseAssetName(
          typeof window !== 'undefined'
            ? localStorage.getItem(`agent-name:${soulMint}`)
            : null,
        );

        return {
          soulMint,
          name: cachedName || `Agent ${soulMint.slice(0, 6)}`,
          strategy: state.strategy,
          isActive: state.isActive,
          machine: machineStates[soulMint] || defaultMachineState(),
        } satisfies AgentEntry;
      });

      setAgents(entries);
      setSelectedAgentMint((prev) => {
        if (prev && entries.some((entry) => entry.soulMint === prev)) return prev;
        return entries[0]?.soulMint || null;
      });
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoadingAgents(false);
    }
  }, [authenticated, walletAddress, rpc, fetchMachineStatesBulk]);

  const loadTree = useCallback(async () => {
    if (!selectedAgentMint) {
      setTreeLoading(false);
      setTree(null);
      setTreeError(null);
      return;
    }

    if (selectedAgent && !isRuntimeStarted(selectedAgent.machine)) {
      const machineState = selectedAgent.machine.deployed
        ? selectedAgent.machine.state || 'not running'
        : 'not deployed';
      setTreeLoading(false);
      setTree(null);
      setTreeError(
        `Selected agent runtime is ${machineState}. Start or deploy the machine first.`,
      );
      return;
    }

    setTreeLoading(true);
    setTreeError(null);
    try {
      const query = new URLSearchParams({
        root: selectedRoot,
        path: activePath,
        depth: String(depth),
      });
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), TREE_FETCH_TIMEOUT_MS);
      const res = await fetch(`/api/agent/${selectedAgentMint}/files?${query.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: await getAuthHeaders(),
      }).finally(() => window.clearTimeout(timeout));
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to load files');
      }

      if (Array.isArray(payload?.roots)) {
        const parsedRoots = payload.roots
          .map((root: any) => ({
            key: root?.key,
            label: root?.label,
            rootPath: root?.rootPath,
          }))
          .filter(
            (root: any): root is RootDescriptor =>
              (root.key === 'user' ||
                root.key === 'workspace' ||
                root.key === 'runtime' ||
                root.key === 'tmp') &&
              typeof root.label === 'string' &&
              typeof root.rootPath === 'string',
          );
        if (parsedRoots.length > 0) setRoots(parsedRoots);
      }

      setTree(payload?.tree ?? null);
      setPathInput(typeof payload?.requestedPath === 'string' ? payload.requestedPath : activePath);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setTree(null);
        setTreeError(
          `File tree request timed out after ${Math.floor(
            TREE_FETCH_TIMEOUT_MS / 1000,
          )}s. The runtime may be unhealthy.`,
        );
      } else {
        setTree(null);
        setTreeError(err instanceof Error ? err.message : 'Failed to load files');
      }
    } finally {
      setTreeLoading(false);
    }
  }, [activePath, depth, getAuthHeaders, selectedAgentMint, selectedRoot, selectedAgent]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    setActivePath('.');
    setPathInput('.');
    setTree(null);
    setTreeError(null);
  }, [selectedRoot, selectedAgentMint]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const handleUpload = async () => {
    if (!selectedAgentMint || !uploadFile) return;

    if (selectedAgent && !isRuntimeStarted(selectedAgent.machine)) {
      const machineState = selectedAgent.machine.deployed
        ? selectedAgent.machine.state || 'not running'
        : 'not deployed';
      setUploadStatus(
        `Selected agent runtime is ${machineState}. Start or deploy the machine first.`,
      );
      return;
    }

    setUploading(true);
    setUploadStatus(null);
    try {
      const formData = new FormData();
      formData.set('file', uploadFile);
      if (uploadPath.trim()) {
        formData.set('path', uploadPath.trim());
      }

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), TREE_FETCH_TIMEOUT_MS);
      const res = await fetch(`/api/agent/${selectedAgentMint}/files`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: await getAuthHeaders(),
      }).finally(() => window.clearTimeout(timeout));
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Upload failed');
      }

      const uploadedPath =
        payload && typeof payload.path === 'string' ? payload.path : uploadFile.name;
      const uploadedDir = getParentPath(uploadedPath);
      setUploadStatus(`Uploaded ${uploadedPath}`);
      setUploadPath('');
      setUploadFile(null);
      setFileInputKey((prev) => prev + 1);
      setSelectedRoot('user');
      setActivePath(uploadedDir);
      setPathInput(uploadedDir);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setUploadStatus(
          `Upload timed out after ${Math.floor(
            TREE_FETCH_TIMEOUT_MS / 1000,
          )}s. The runtime may be unhealthy.`,
        );
      } else {
        setUploadStatus(err instanceof Error ? err.message : 'Upload failed');
      }
    } finally {
      setUploading(false);
    }
  };

  const normalizedActivePath = normalizeRelativePath(activePath);
  const pathSegments =
    normalizedActivePath === '.'
      ? []
      : normalizedActivePath.split('/').filter(Boolean);
  const selectedRootDescriptor = roots.find((root) => root.key === selectedRoot) || null;
  const runtimeLabel = selectedAgent
    ? selectedAgent.machine.deployed
      ? selectedAgent.machine.state || 'deployed'
      : 'not deployed'
    : 'No runtime selected';

  return (
    <main className="min-h-[calc(100dvh-56px)] px-2 py-3 sm:px-4 sm:py-4 lg:px-6">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div>
          <h1 className="text-lg font-semibold text-ink sm:text-xl">Files</h1>
          <p className="text-xs text-ink-muted sm:text-sm">
            Browse machine files and upload assets to agent workspaces.
          </p>
        </div>
      </div>

      {!authenticated ? (
        <div className="max-w-3xl rounded-2xl border border-border bg-surface-raised p-5 sm:p-6">
          <p className="text-sm text-ink-secondary">
            Connect your wallet to manage files across your agent machines.
          </p>
          <button
            onClick={login}
            className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-brand-600"
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
          <section className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-sm">
            <div className="border-b border-border-light bg-surface/70 px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 rounded-lg border border-border-light bg-surface px-3 py-1.5 text-sm text-ink">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1 1H12.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
                  </svg>
                  <span className="font-medium">Files</span>
                  <span className="text-ink-muted">x</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <ToolbarIconButton
                    title="Go up"
                    disabled={normalizedActivePath === '.'}
                    onClick={() => {
                      const parent = getParentPath(activePath);
                      setActivePath(parent);
                      setPathInput(parent);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 12V4" />
                      <path d="M4.5 7.5L8 4l3.5 3.5" />
                    </svg>
                  </ToolbarIconButton>
                  <ToolbarIconButton title="Refresh files" onClick={loadTree}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 8a5 5 0 1 1-1.2-3.2" />
                      <path d="M13 3v2.9h-2.9" />
                    </svg>
                  </ToolbarIconButton>
                  <ToolbarIconButton title="Reload agents" onClick={loadAgents}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3.5A2.5 2.5 0 1 0 8 8.5A2.5 2.5 0 1 0 8 3.5Z" />
                      <path d="M3 13a5 5 0 0 1 10 0" />
                    </svg>
                  </ToolbarIconButton>
                </div>
              </div>

              <div className="mt-2">
                <span className="inline-flex rounded-md border border-border-light bg-surface px-2 py-1 text-xs text-ink-muted">
                  Browse and manage your files.
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="min-w-0 text-xs text-ink-muted">
                  <span className="mb-1 block">Agent</span>
                  <select
                    value={selectedAgentMint ?? ''}
                    onChange={(e) => setSelectedAgentMint(e.target.value || null)}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink focus:border-ink focus:outline-none disabled:opacity-60"
                    disabled={loadingAgents || agents.length === 0}
                  >
                    <option value="">
                      {loadingAgents
                        ? 'Loading agents...'
                        : agents.length === 0
                          ? 'No agents found'
                          : 'Select an agent'}
                    </option>
                    {agents.map((agent) => (
                      <option key={agent.soulMint} value={agent.soulMint}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-ink-muted">
                  <span className="mb-1 block">Root</span>
                  <select
                    value={selectedRoot}
                    onChange={(e) => setSelectedRoot(e.target.value as FileRootKey)}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink focus:border-ink focus:outline-none"
                  >
                    {roots.map((root) => (
                      <option key={root.key} value={root.key}>
                        {root.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-ink-muted">
                  <span className="mb-1 block">Depth</span>
                  <select
                    value={String(depth)}
                    onChange={(e) => setDepth(Number.parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink focus:border-ink focus:outline-none"
                  >
                    <option value="1">Depth 1</option>
                    <option value="2">Depth 2</option>
                    <option value="3">Depth 3</option>
                    <option value="4">Depth 4</option>
                    <option value="5">Depth 5</option>
                    <option value="6">Depth 6</option>
                  </select>
                </label>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <button
                  type="button"
                  onClick={() => {
                    const parent = getParentPath(activePath);
                    setActivePath(parent);
                    setPathInput(parent);
                  }}
                  disabled={normalizedActivePath === '.'}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-ink-secondary transition-colors hover:bg-surface-overlay disabled:opacity-50"
                >
                  Up
                </button>
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="."
                  className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-ink focus:border-ink focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const normalized = normalizeRelativePath(pathInput);
                    setActivePath(normalized);
                    setPathInput(normalized);
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-ink-secondary transition-colors hover:bg-surface-overlay"
                >
                  Go
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                <button
                  type="button"
                  onClick={() => {
                    setActivePath('.');
                    setPathInput('.');
                  }}
                  className="rounded border border-transparent px-1.5 py-0.5 hover:border-border-light hover:bg-surface-overlay"
                >
                  root
                </button>
                {pathSegments.map((segment, index) => {
                  const segmentPath = pathSegments.slice(0, index + 1).join('/');
                  return (
                    <button
                      key={`${segment}:${index}`}
                      type="button"
                      onClick={() => {
                        setActivePath(segmentPath);
                        setPathInput(segmentPath);
                      }}
                      className="rounded border border-transparent px-1.5 py-0.5 hover:border-border-light hover:bg-surface-overlay"
                    >
                      / {segment}
                    </button>
                  );
                })}
              </div>

              {(loadingAgents || agentError) && (
                <div className="mt-2 text-xs">
                  {loadingAgents && <p className="text-ink-muted">Refreshing agents...</p>}
                  {agentError && <p className="text-danger">{agentError}</p>}
                </div>
              )}
            </div>

            <div className="border-b border-border-light bg-surface px-3 py-2 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">Name</span>
                <span className="truncate font-mono text-[11px] text-ink-muted">
                  {selectedRootDescriptor?.rootPath || '—'}
                </span>
              </div>
            </div>

            <div className="h-[58dvh] min-h-[340px] overflow-auto bg-surface px-2 py-2 sm:px-3">
              {!selectedAgentMint && (
                <div className="rounded-xl border border-border-light bg-surface-raised px-4 py-6 text-sm text-ink-muted">
                  Select an agent to browse files.
                </div>
              )}

              {selectedAgentMint && treeLoading && (
                <div className="rounded-xl border border-border-light bg-surface-raised px-4 py-6 text-sm text-ink-muted">
                  Loading file tree...
                </div>
              )}

              {selectedAgentMint && treeError && !treeLoading && (
                <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                  {treeError}
                </div>
              )}

              {selectedAgentMint && tree && !treeLoading && (
                <div className="rounded-xl border border-border-light bg-surface-raised p-2">
                  <TreeNodeRows
                    node={tree}
                    level={0}
                    activePath={activePath}
                    onOpenDirectory={(nextPath) => {
                      const normalized = normalizeRelativePath(nextPath);
                      setActivePath(normalized);
                      setPathInput(normalized);
                    }}
                  />
                  {tree.truncated && (
                    <div className="px-2 py-2 text-xs text-ink-muted">
                      Directory truncated to first 200 entries.
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-sm">
            <div className="border-b border-border-light px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Workspace</h2>
                {selectedAgent && (
                  <Link
                    href={`/agent/${selectedAgent.soulMint}`}
                    className="text-xs text-brand-500 transition-colors hover:text-brand-700"
                  >
                    Open Agent
                  </Link>
                )}
              </div>
            </div>

            <div className="space-y-4 p-4">
              <section className="rounded-xl border border-border-light bg-surface p-3">
                <div className="text-[11px] uppercase tracking-wide text-ink-muted">
                  Selected Agent
                </div>
                {selectedAgent ? (
                  <div className="mt-2 space-y-2">
                    <div className="text-sm font-medium text-ink">{selectedAgent.name}</div>
                    <div className="font-mono text-[11px] text-ink-muted">
                      {truncateAddress(selectedAgent.soulMint, 8)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full bg-surface-inset px-2 py-0.5 text-ink-secondary">
                        {STRATEGY_LABELS[selectedAgent.strategy as Strategy]}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          selectedAgent.isActive
                            ? 'bg-success/10 text-success'
                            : 'bg-surface-inset text-ink-muted'
                        }`}
                      >
                        {selectedAgent.isActive ? 'Active' : 'Paused'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink-muted">
                    Choose an agent to inspect files and upload assets.
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-border-light bg-surface p-3">
                <div className="text-[11px] uppercase tracking-wide text-ink-muted">Upload</div>
                <p className="mt-1 text-xs text-ink-muted">
                  Uploads land in <span className="font-mono">workspace/user-files</span>.
                </p>
                <div className="mt-3 space-y-2">
                  <input
                    key={fileInputKey}
                    type="file"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    disabled={!selectedAgentMint || uploading}
                    className="w-full rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-xs text-ink file:mr-2 file:rounded-full file:border-0 file:bg-ink file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-surface disabled:opacity-60"
                  />
                  <input
                    type="text"
                    value={uploadPath}
                    onChange={(e) => setUploadPath(e.target.value)}
                    placeholder="Optional path e.g. notes/today.md"
                    disabled={!selectedAgentMint || uploading}
                    className="w-full rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-xs text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={!selectedAgentMint || !uploadFile || uploading}
                    className="w-full rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-black transition-colors hover:bg-brand-600 disabled:opacity-50"
                  >
                    {uploading ? 'Uploading...' : 'Upload file'}
                  </button>
                  {uploadStatus && (
                    <p className={`text-xs ${uploadStatus.startsWith('Uploaded') ? 'text-success' : 'text-danger'}`}>
                      {uploadStatus}
                    </p>
                  )}
                </div>
              </section>

              <section
                className="rounded-xl border border-border-light p-3"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 1px 1px, var(--color-border-light) 1px, transparent 0)',
                  backgroundSize: '14px 14px',
                }}
              >
                <div className="text-sm text-ink-secondary">What can I do for you?</div>
                <div className="mt-2 rounded-xl border border-border-light bg-surface/90 px-3 py-2 text-xs text-ink-muted">
                  Runtime status: <span className="font-medium text-ink-secondary">{runtimeLabel}</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Ask your selected agent to read, summarize, and transform files from its workspace.
                </p>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
