'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { generateKeyPair, getAddressFromPublicKey } from '@solana/kit';
import type { Address } from '@solana/kit';
import { Strategy, STRATEGY_LABELS, STRATEGY_DESCRIPTIONS, DEFAULT_LLM_MODELS } from '@agents-haus/common';
import { useAgentTransactions } from '@/hooks/use-agent-transactions';
import { useSendTransaction } from '@/hooks/use-send-transaction';

type Step = 'personality' | 'strategy' | 'config' | 'review';

const STEPS: Step[] = ['personality', 'strategy', 'config', 'review'];
const STEP_LABELS: Record<Step, string> = {
  personality: 'Identity',
  strategy: 'Strategy',
  config: 'Config',
  review: 'Review',
};

export function CreateAgentForm() {
  const router = useRouter();
  const { authenticated, login } = usePrivy();
  const { createAgent } = useAgentTransactions();
  const { sendTransaction } = useSendTransaction();

  const [step, setStep] = useState<Step>('personality');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [strategy, setStrategy] = useState<Strategy>(Strategy.AlphaHunter);
  const [model, setModel] = useState(DEFAULT_LLM_MODELS[0].id);
  const [maxSolPerEpoch, setMaxSolPerEpoch] = useState('0.1');
  const [autoReclaim, setAutoReclaim] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'minting' | 'deploying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);

  const handleNext = () => {
    if (step === 'personality' && !name.trim()) {
      setError('Agent name is required');
      return;
    }
    setError(null);
    if (stepIndex < STEPS.length - 1) {
      setStep(STEPS[stepIndex + 1]);
    }
  };

  const handleBack = () => {
    setError(null);
    if (stepIndex > 0) {
      setStep(STEPS[stepIndex - 1]);
    }
  };

  const handleSubmit = async () => {
    if (!authenticated) {
      login();
      return;
    }

    setIsSubmitting(true);
    setSubmitPhase('minting');
    setError(null);

    try {
      // 1. Generate soul asset keypair (for the NFT)
      const soulAssetKeypair = await generateKeyPair();
      const soulAssetAddress = await getAddressFromPublicKey(soulAssetKeypair.publicKey);

      // 2. Generate executor keypair (for the runtime to sign txs)
      const executorKeypair = await generateKeyPair();
      const executorAddress = await getAddressFromPublicKey(executorKeypair.publicKey);
      const executorSecretBytes = new Uint8Array(
        executorKeypair.privateKey as unknown as ArrayBuffer,
      );
      const executorSecretJson = JSON.stringify(Array.from(executorSecretBytes));

      // 3. Hash personality for on-chain storage
      const personalityConfig = JSON.stringify({ bio, model, maxSolPerEpoch, autoReclaim });
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(personalityConfig));
      const personalityHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // 4. Build + send the on-chain create agent transaction
      const ix = await createAgent({
        name,
        uri: `https://agents.haus/api/agent/${soulAssetAddress}`,
        personalityHash,
        strategy,
        executorPubkey: executorAddress as string,
        soulAssetKeypair: {
          publicKey: soulAssetAddress,
          secretKey: new Uint8Array(soulAssetKeypair.privateKey as unknown as ArrayBuffer),
        },
      });

      // Soul asset keypair must co-sign the transaction
      const signature = await sendTransaction([ix], [soulAssetKeypair]);
      console.log('Agent created on-chain! Signature:', signature);

      // 5. Deploy the agent runtime to Fly.io
      setSubmitPhase('deploying');
      try {
        const deployRes = await fetch(`/api/agent/${soulAssetAddress}/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executorKeypair: executorSecretJson }),
        });

        if (!deployRes.ok) {
          const deployErr = await deployRes.json();
          console.warn('Deploy failed (agent still created on-chain):', deployErr);
          // Don't block navigation — the agent exists, deploy can be retried
        } else {
          const deployData = await deployRes.json();
          console.log('Agent machine deployed:', deployData);
        }
      } catch (deployErr) {
        console.warn('Deploy request failed:', deployErr);
      }

      setSubmitPhase('done');
      router.push(`/agent/${soulAssetAddress}`);
    } catch (err) {
      console.error('Failed to create agent:', err);
      setError(err instanceof Error ? err.message : 'Failed to create agent');
      setSubmitPhase('idle');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Progress */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center">
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                i <= stepIndex
                  ? 'bg-ink text-surface'
                  : 'bg-surface-inset text-ink-muted'
              }`}
            >
              <span>{i + 1}</span>
              <span>{STEP_LABELS[s]}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px mx-1 ${i < stepIndex ? 'bg-ink' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Step: Personality */}
      {step === 'personality' && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. AlphaBot, BurnMaster"
              className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Personality / Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Describe your agent's personality, voice, and posting style..."
              rows={5}
              className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none resize-none transition-colors"
            />
            <p className="text-xs text-ink-muted mt-1.5">This becomes the agent&apos;s SOUL.md identity file.</p>
          </div>
        </div>
      )}

      {/* Step: Strategy */}
      {step === 'strategy' && (
        <div className="grid grid-cols-2 gap-3">
          {(Object.values(Strategy).filter((v) => typeof v === 'number') as Strategy[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`rounded-2xl border p-5 text-left transition-colors ${
                  strategy === s
                    ? 'border-ink bg-surface-raised shadow-sm'
                    : 'border-border bg-surface-raised hover:border-ink-muted'
                }`}
              >
                <div className="font-semibold text-ink mb-1">{STRATEGY_LABELS[s]}</div>
                <div className="text-sm text-ink-secondary leading-relaxed">{STRATEGY_DESCRIPTIONS[s]}</div>
              </button>
            ),
          )}
        </div>
      )}

      {/* Step: Config */}
      {step === 'config' && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">LLM Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            >
              {DEFAULT_LLM_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — ${m.costPerMInput}/M in, ${m.costPerMOutput}/M out
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Max SOL per Epoch</label>
            <input
              type="number"
              step="0.01"
              value={maxSolPerEpoch}
              onChange={(e) => setMaxSolPerEpoch(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoReclaim}
              onChange={(e) => setAutoReclaim(e.target.checked)}
              className="rounded border-border accent-brand-500"
            />
            <span className="text-sm text-ink">Auto-reclaim position when flipped</span>
          </label>
        </div>
      )}

      {/* Step: Review */}
      {step === 'review' && (
        <div className="rounded-2xl border border-border bg-surface-raised p-6 space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Name</span>
            <span className="font-medium text-ink">{name || '(unnamed)'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Strategy</span>
            <span className="font-medium text-ink">{STRATEGY_LABELS[strategy]}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Model</span>
            <span className="font-medium text-ink">
              {DEFAULT_LLM_MODELS.find((m) => m.id === model)?.name}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Max SOL/Epoch</span>
            <span className="font-medium font-mono text-ink">{maxSolPerEpoch} SOL</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Auto-reclaim</span>
            <span className="font-medium text-ink">{autoReclaim ? 'Yes' : 'No'}</span>
          </div>
          <div className="pt-4 border-t border-border-light text-xs text-ink-muted">
            This will mint a Soul NFT on Solana and create the agent state on-chain.
            You can fund the agent after creation.
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <button
          onClick={handleBack}
          disabled={stepIndex === 0 || isSubmitting}
          className="rounded-full border border-border px-5 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-overlay disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Back
        </button>
        {step === 'review' ? (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="rounded-full bg-brand-500 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            {submitPhase === 'minting'
              ? 'Minting on-chain...'
              : submitPhase === 'deploying'
                ? 'Deploying runtime...'
                : 'Mint Soul NFT & Deploy'}
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="rounded-full bg-ink px-6 py-2 text-sm font-medium text-surface hover:bg-ink/90 transition-colors"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
