'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Address } from '@solana/kit';
import { getAddressFromPublicKey } from '@solana/kit';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { exportKeypairBytes } from '@/lib/export-keypair';
import { getAgentWalletPda, fetchAgentWalletBalance } from '@agents-haus/sdk';
import { useAgentState } from '@/hooks/use-agent-state';
import { useSolanaRpc } from '@/hooks/use-solana-rpc';
import { useAgentTransactions } from '@/hooks/use-agent-transactions';
import { useSendTransaction } from '@/hooks/use-send-transaction';
import { EpochStatus } from '@/components/epoch-status';
import { ActivityLog } from '@/components/activity-log';
import { AgentStats } from '@/components/agent-stats';
import { AgentConfig } from '@/components/agent-config';
import { FundWithdraw } from '@/components/fund-withdraw';
import { AgentChat } from '@/components/agent-chat';

interface MachineInfo {
  deployed: boolean;
  machineId?: string;
  state?: string;
  region?: string;
  name?: string;
}

function MachineStatus({
  soulMint,
  isOwner,
  onMachineUpdate,
}: {
  soulMint: string;
  isOwner: boolean;
  onMachineUpdate?: (machine: MachineInfo | null) => void;
}) {
  const { updateExecutor } = useAgentTransactions();
  const { sendTransaction } = useSendTransaction();
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [deployPhase, setDeployPhase] = useState<'idle' | 'keygen' | 'onchain' | 'deploying'>('idle');
  const [deployError, setDeployError] = useState<string | null>(null);

  const fetchMachine = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/${soulMint}/machine`);
      if (res.ok) {
        const data = await res.json();
        setMachine(data);
        onMachineUpdate?.(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [soulMint, onMachineUpdate]);

  useEffect(() => {
    fetchMachine();
    const interval = setInterval(fetchMachine, 15_000);
    return () => clearInterval(interval);
  }, [fetchMachine]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await fetch(`/api/agent/${soulMint}/machine/start`, { method: 'POST' });
      await new Promise((r) => setTimeout(r, 2000));
      await fetchMachine();
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await fetch(`/api/agent/${soulMint}/machine/stop`, { method: 'POST' });
      await new Promise((r) => setTimeout(r, 2000));
      await fetchMachine();
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeploy = async () => {
    setDeployPhase('keygen');
    setDeployError(null);

    try {
      // 1. Generate a new executor keypair (extractable so we can serialize the secret)
      const executorKeypair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
      const executorAddress = await getAddressFromPublicKey(executorKeypair.publicKey);
      const fullKeypairBytes = await exportKeypairBytes(executorKeypair);
      const executorSecretJson = JSON.stringify(Array.from(fullKeypairBytes));

      // 2. Deploy to Fly.io FIRST (before on-chain update, so we don't burn the keypair if deploy fails)
      setDeployPhase('deploying');
      const deployRes = await fetch(`/api/agent/${soulMint}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executorKeypair: executorSecretJson, force: true }),
      });

      if (!deployRes.ok) {
        const deployErr = await deployRes.json();
        throw new Error(deployErr.error || 'Deploy failed');
      }

      const deployData = await deployRes.json();
      console.log('Agent deployed:', deployData);

      // 3. Update executor on-chain (only after deploy succeeds)
      setDeployPhase('onchain');
      const ix = await updateExecutor(soulMint, executorAddress as string);
      await sendTransaction([ix]);

      // Refresh machine status
      await new Promise((r) => setTimeout(r, 2000));
      await fetchMachine();
    } catch (err) {
      console.error('Deploy error:', err);
      setDeployError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setDeployPhase('idle');
    }
  };

  const stateColor = (state?: string) => {
    switch (state) {
      case 'started':
        return 'bg-success/10 text-success';
      case 'stopped':
        return 'bg-surface-inset text-ink-muted';
      case 'starting':
      case 'stopping':
        return 'bg-warning/10 text-warning';
      default:
        return 'bg-surface-inset text-ink-muted';
    }
  };

  const deployButtonLabel = () => {
    switch (deployPhase) {
      case 'keygen':
        return 'Generating keys...';
      case 'onchain':
        return 'Updating on-chain...';
      case 'deploying':
        return 'Deploying to Fly...';
      default:
        return 'Deploy Runtime';
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-6">
      <h3 className="text-base font-semibold text-ink mb-3">Runtime</h3>

      {loading && (
        <div className="text-sm text-ink-muted">Checking...</div>
      )}

      {!loading && machine && !machine.deployed && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Runtime not deployed.
          </p>
          {isOwner && (
            <>
              <button
                onClick={handleDeploy}
                disabled={deployPhase !== 'idle'}
                className="w-full rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {deployButtonLabel()}
              </button>
              <p className="text-xs text-ink-muted">
                Generates a new executor keypair, updates it on-chain, and deploys to Fly.io.
              </p>
              {deployError && (
                <p className="text-xs text-danger">{deployError}</p>
              )}
            </>
          )}
          {!isOwner && (
            <p className="text-xs text-ink-muted">Only the owner can deploy the runtime.</p>
          )}
        </div>
      )}

      {!loading && machine?.deployed && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-muted">Status</span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${stateColor(machine.state)}`}
            >
              {machine.state || 'unknown'}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Region</span>
            <span className="font-mono text-ink">{machine.region || '—'}</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Machine</span>
            <span className="font-mono text-xs text-ink-muted">{machine.machineId?.slice(0, 12) || '—'}</span>
          </div>

          {isOwner && (
            <div className="flex gap-2 pt-2">
              {machine.state === 'stopped' && (
                <button
                  onClick={handleStart}
                  disabled={actionLoading}
                  className="flex-1 rounded-full bg-success/10 text-success px-3 py-1.5 text-xs font-medium hover:bg-success/15 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Starting...' : 'Start'}
                </button>
              )}
              {machine.state === 'started' && (
                <button
                  onClick={handleStop}
                  disabled={actionLoading}
                  className="flex-1 rounded-full bg-danger/10 text-danger px-3 py-1.5 text-xs font-medium hover:bg-danger/15 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Stopping...' : 'Stop'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  soulMint: string;
}

export function AgentDetailClient({ soulMint }: Props) {
  const { user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { rpc } = useSolanaRpc();
  const { data: agentState, isLoading, error, refetch } = useAgentState(soulMint as Address);

  const [walletBalance, setWalletBalance] = useState<bigint>(BigInt(0));
  const [agentWalletAddress, setAgentWalletAddress] = useState<string | null>(null);
  const [machineState, setMachineState] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    try {
      const [agentWallet] = await getAgentWalletPda(soulMint as Address);
      setAgentWalletAddress(agentWallet as string);
      const balance = await fetchAgentWalletBalance(rpc, agentWallet);
      setWalletBalance(balance);
    } catch {
      // agent may not exist yet
    }
  }, [soulMint, rpc]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const handleRefresh = () => {
    refetch();
    fetchBalance();
  };

  const handleMachineUpdate = useCallback((machine: MachineInfo | null) => {
    setMachineState(machine?.deployed ? (machine.state || null) : null);
  }, []);

  const isOwner =
    agentState &&
    wallets[0] &&
    (agentState.owner as string) === wallets[0].address;

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="animate-pulse space-y-6">
          <div className="h-7 w-48 bg-surface-inset rounded-lg" />
          <div className="h-4 w-96 bg-surface-inset rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-64 bg-surface-inset rounded-2xl" />
            <div className="h-64 bg-surface-inset rounded-2xl" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !agentState) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink mb-1">Agent</h1>
          <p className="text-sm text-ink-muted font-mono">{soulMint}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface-raised p-10 text-center">
          <p className="text-ink-secondary mb-2">
            {error ? error.message : 'Agent not found'}
          </p>
          <p className="text-sm text-ink-muted">
            This agent may not have been created yet, or the address is incorrect.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Agent Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-ink">Agent</h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                agentState.isActive
                  ? 'bg-success/10 text-success'
                  : 'bg-surface-inset text-ink-muted'
              }`}
            >
              {agentState.isActive ? 'Active' : 'Paused'}
            </span>
          </div>
          <p className="text-sm text-ink-muted font-mono mt-1">{soulMint}</p>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Chat + Config + Activity */}
        <div className="lg:col-span-2 space-y-6">
          <AgentChat soulMint={soulMint} isRunning={machineState === 'started'} />
          <AgentConfig
            soulMint={soulMint}
            agentState={agentState}
            isOwner={!!isOwner}
            onSuccess={handleRefresh}
          />
          <ActivityLog agentId={soulMint} />
        </div>

        {/* Right column: Runtime + Epoch + Stats + Wallet */}
        <div className="space-y-6">
          <MachineStatus
            soulMint={soulMint}
            isOwner={!!isOwner}
            onMachineUpdate={handleMachineUpdate}
          />
          <EpochStatus agentWallet={agentWalletAddress || undefined} />
          <AgentStats agentState={agentState} />
          <FundWithdraw
            soulMint={soulMint}
            balance={walletBalance}
            isOwner={!!isOwner}
            onSuccess={handleRefresh}
          />
        </div>
      </div>
    </main>
  );
}
