'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Address } from '@solana/kit';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { fetchAgentsByOwner } from '@agents-haus/sdk';
import { STRATEGY_LABELS, truncateAddress, type Strategy } from '@agents-haus/common';
import { useSolanaRpc } from '@/hooks/use-solana-rpc';

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
  onOpenDirectory,
}: {
  node: FileTreeNode;
  level: number;
  onOpenDirectory: (path: string) => void;
}) {
  const isDirectory = node.type === 'directory';

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (isDirectory) onOpenDirectory(node.path);
        }}
        disabled={!isDirectory}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
          isDirectory
            ? 'text-ink hover:bg-surface-overlay'
            : 'text-ink-secondary'
        }`}
        style={{ paddingLeft: `${8 + level * 16}px` }}
      >
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
              onOpenDirectory={onOpenDirectory}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilesPage() {
  const { authenticated, login } = usePrivy();
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

  const walletAddress = wallets[0]?.address as Address | undefined;
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.soulMint === selectedAgentMint) || null,
    [agents, selectedAgentMint],
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
      const entries = await Promise.all(
        results.map(async ({ state }) => {
          const soulMint = state.soulMint as string;
          const cachedName = parseAssetName(
            typeof window !== 'undefined'
              ? localStorage.getItem(`agent-name:${soulMint}`)
              : null,
          );

          let machine: AgentMachineState = { deployed: false, state: null };
          try {
            const machineRes = await fetch(`/api/agent/${soulMint}/machine`, {
              cache: 'no-store',
            });
            if (machineRes.ok) {
              const machinePayload = await machineRes.json();
              machine = {
                deployed: Boolean(machinePayload?.deployed),
                state:
                  typeof machinePayload?.state === 'string'
                    ? machinePayload.state
                    : null,
              };
            }
          } catch {
            machine = { deployed: false, state: null };
          }

          return {
            soulMint,
            name: cachedName || `Agent ${soulMint.slice(0, 6)}`,
            strategy: state.strategy,
            isActive: state.isActive,
            machine,
          } satisfies AgentEntry;
        }),
      );

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
  }, [authenticated, walletAddress, rpc]);

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
  }, [activePath, depth, selectedAgentMint, selectedRoot, selectedAgent]);

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

  const pathSegments =
    normalizeRelativePath(pathInput) === '.'
      ? []
      : normalizeRelativePath(pathInput).split('/').filter(Boolean);

  return (
    <main className="min-h-[calc(100dvh-56px)] px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Files</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Upload custom files/images per agent and browse each machine&apos;s filesystem structure.
        </p>
      </div>

      {!authenticated ? (
        <div className="max-w-3xl rounded-2xl border border-border bg-surface-raised p-6">
          <p className="text-sm text-ink-secondary">
            Connect your wallet to manage files across your agent machines.
          </p>
          <button
            onClick={login}
            className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-black hover:bg-brand-600 transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-border bg-surface-raised p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Your Agents</h2>
              <button
                type="button"
                onClick={loadAgents}
                className="text-xs text-ink-muted hover:text-ink transition-colors"
              >
                Refresh
              </button>
            </div>

            {loadingAgents && (
              <p className="text-xs text-ink-muted">Loading agents...</p>
            )}
            {agentError && (
              <p className="text-xs text-danger">{agentError}</p>
            )}
            {!loadingAgents && agents.length === 0 && (
              <div className="rounded-xl border border-border-light bg-surface px-3 py-4 text-xs text-ink-muted">
                No agents found for this wallet.
              </div>
            )}

            <div className="space-y-2">
              {agents.map((agent) => {
                const selected = selectedAgentMint === agent.soulMint;
                return (
                  <button
                    key={agent.soulMint}
                    type="button"
                    onClick={() => setSelectedAgentMint(agent.soulMint)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      selected
                        ? 'border-brand-500/40 bg-brand-500/5'
                        : 'border-border-light bg-surface hover:border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{agent.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          agent.isActive
                            ? 'bg-success/10 text-success'
                            : 'bg-surface-inset text-ink-muted'
                        }`}
                      >
                        {agent.isActive ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-ink-muted">
                      {truncateAddress(agent.soulMint, 6)}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-ink-muted">
                        {STRATEGY_LABELS[agent.strategy as Strategy]}
                      </span>
                      <span className="font-medium text-ink-secondary">
                        {agent.machine.deployed ? agent.machine.state || 'deployed' : 'not deployed'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface-raised p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Upload to Selected Agent</h2>
                {selectedAgent && (
                  <Link
                    href={`/agent/${selectedAgent.soulMint}`}
                    className="text-xs text-brand-500 hover:text-brand-700 transition-colors"
                  >
                    Open Agent
                  </Link>
                )}
              </div>
              <p className="mb-3 text-xs text-ink-muted">
                Files upload into <span className="font-mono">workspace/user-files</span> and are available to the runtime file tools.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                <input
                  key={fileInputKey}
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  disabled={!selectedAgentMint || uploading}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-surface disabled:opacity-60"
                />
                <input
                  type="text"
                  value={uploadPath}
                  onChange={(e) => setUploadPath(e.target.value)}
                  placeholder="Optional path e.g. research/market-notes.md"
                  disabled={!selectedAgentMint || uploading}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!selectedAgentMint || !uploadFile || uploading}
                  className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-black hover:bg-brand-600 transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
              {uploadStatus && (
                <p className={`mt-2 text-xs ${uploadStatus.startsWith('Uploaded') ? 'text-success' : 'text-danger'}`}>
                  {uploadStatus}
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-surface-raised p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">Machine File Structure</h2>
                <div className="flex flex-wrap items-center gap-2">
                  {roots.map((root) => (
                    <button
                      key={root.key}
                      type="button"
                      onClick={() => setSelectedRoot(root.key)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        selectedRoot === root.key
                          ? 'bg-ink text-surface'
                          : 'bg-surface-inset text-ink-secondary hover:bg-surface-overlay'
                      }`}
                    >
                      {root.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3 rounded-xl border border-border-light bg-surface px-3 py-2 text-[11px] text-ink-muted">
                Root path:{' '}
                <span className="font-mono">
                  {roots.find((root) => root.key === selectedRoot)?.rootPath || '—'}
                </span>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const parent = getParentPath(activePath);
                    setActivePath(parent);
                    setPathInput(parent);
                  }}
                  disabled={normalizeRelativePath(activePath) === '.'}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-overlay disabled:opacity-40"
                >
                  Up
                </button>
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="."
                  className="min-w-[260px] flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-xs text-ink focus:border-ink focus:outline-none"
                />
                <select
                  value={String(depth)}
                  onChange={(e) => setDepth(Number.parseInt(e.target.value, 10))}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-ink focus:outline-none"
                >
                  <option value="1">Depth 1</option>
                  <option value="2">Depth 2</option>
                  <option value="3">Depth 3</option>
                  <option value="4">Depth 4</option>
                  <option value="5">Depth 5</option>
                  <option value="6">Depth 6</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const normalized = normalizeRelativePath(pathInput);
                    setActivePath(normalized);
                    setPathInput(normalized);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-overlay"
                >
                  Go
                </button>
                <button
                  type="button"
                  onClick={loadTree}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-overlay"
                >
                  Refresh
                </button>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                <button
                  type="button"
                  onClick={() => {
                    setActivePath('.');
                    setPathInput('.');
                  }}
                  className="rounded px-1.5 py-0.5 hover:bg-surface-overlay"
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
                      className="rounded px-1.5 py-0.5 hover:bg-surface-overlay"
                    >
                      / {segment}
                    </button>
                  );
                })}
              </div>

              {!selectedAgentMint && (
                <div className="rounded-xl border border-border-light bg-surface px-4 py-6 text-sm text-ink-muted">
                  Select an agent to browse files.
                </div>
              )}

              {selectedAgentMint && treeLoading && (
                <div className="rounded-xl border border-border-light bg-surface px-4 py-6 text-sm text-ink-muted">
                  Loading file tree...
                </div>
              )}

              {selectedAgentMint && treeError && !treeLoading && (
                <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                  {treeError}
                </div>
              )}

              {selectedAgentMint && tree && !treeLoading && (
                <div className="max-h-[560px] overflow-auto rounded-xl border border-border-light bg-surface p-2">
                  <TreeNodeRows
                    node={tree}
                    level={0}
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
        </div>
      )}
    </main>
  );
}
