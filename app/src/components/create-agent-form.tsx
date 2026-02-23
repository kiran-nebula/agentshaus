'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { generateKeyPair, getAddressFromPublicKey } from '@solana/kit';
import {
  FLAVOR_PROFILES,
  SOLANA_SKILL_PACKS,
  Strategy,
  STRATEGY_LABELS,
  type FlavorProfileId,
  getAgentSkillLabel,
  getFlavorProfile,
} from '@agents-haus/common';
import { useAgentTransactions } from '@/hooks/use-agent-transactions';
import { useSendTransaction } from '@/hooks/use-send-transaction';

type Step = 'identity' | 'mint';

const STEPS: Step[] = ['identity', 'mint'];
const STEP_LABELS: Record<Step, string> = {
  identity: 'Identity + Strategy',
  mint: 'Mint',
};
const MAX_SOUL_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const CREATE_AGENT_TUTORIAL_DISMISSED_KEY = 'create-agent-tutorial-dismissed:v1';
const KNOWN_QUERY_SKILLS = new Set([
  ...SOLANA_SKILL_PACKS.map((skill) => skill.id),
  'alpha-haus',
  'dca-planner',
  'x-posting',
  'grok-writer',
]);

async function fetchSharedExecutorAddress(): Promise<string> {
  const response = await fetch('/api/runtime/executor', {
    method: 'GET',
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  const runtimeExecutor =
    payload && typeof payload.runtimeExecutor === 'string'
      ? payload.runtimeExecutor.trim()
      : '';

  if (!response.ok || !runtimeExecutor) {
    throw new Error(payload?.error || 'Shared runtime executor is not configured');
  }

  return runtimeExecutor;
}

async function uploadSoulImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.set('file', file);

  const response = await fetch('/api/agent/image', {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json().catch(() => null);
  const imageUrl = payload && typeof payload.url === 'string' ? payload.url.trim() : '';

  if (!response.ok || !imageUrl) {
    throw new Error(payload?.error || 'Failed to upload Soul NFT image');
  }

  return imageUrl;
}

export function CreateAgentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authenticated, login } = usePrivy();
  const { createAgent } = useAgentTransactions();
  const { sendTransaction } = useSendTransaction();

  const [step, setStep] = useState<Step>('identity');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [selectedFlavor, setSelectedFlavor] = useState<FlavorProfileId>('alpha-hunter');
  const [extraSkills, setExtraSkills] = useState<string[]>([]);
  const [loadedSkillsFromQuery, setLoadedSkillsFromQuery] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>(Strategy.AlphaHunter);
  const [soulImageFile, setSoulImageFile] = useState<File | null>(null);
  const [soulImagePreviewUrl, setSoulImagePreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'uploading' | 'minting' | 'deploying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showTutorialModal, setShowTutorialModal] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const selectedProfile = getFlavorProfile(selectedFlavor);
  const selectedSkills = Array.from(
    new Set([...selectedProfile.presetSkills, ...extraSkills]),
  );
  const alphaProfiles = FLAVOR_PROFILES.filter((profile) => profile.category === 'alpha');
  const generalProfiles = FLAVOR_PROFILES.filter((profile) => profile.category === 'general');

  const handleSelectFlavor = (profileId: FlavorProfileId) => {
    const profile = getFlavorProfile(profileId);
    setSelectedFlavor(profileId);
    setStrategy(profile.baseStrategy);
  };

  useEffect(() => {
    if (loadedSkillsFromQuery) return;
    const fromQuery = (searchParams.get('skills') || '')
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean)
      .filter((skill) => KNOWN_QUERY_SKILLS.has(skill));
    if (fromQuery.length > 0) {
      setExtraSkills(fromQuery);
    }
    setLoadedSkillsFromQuery(true);
  }, [loadedSkillsFromQuery, searchParams]);

  useEffect(() => {
    const dismissed = localStorage.getItem(CREATE_AGENT_TUTORIAL_DISMISSED_KEY) === '1';
    setShowTutorialModal(!dismissed);
  }, []);

  useEffect(
    () => () => {
      if (soulImagePreviewUrl) {
        URL.revokeObjectURL(soulImagePreviewUrl);
      }
    },
    [soulImagePreviewUrl],
  );

  useEffect(() => {
    if (!showTutorialModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        localStorage.setItem(CREATE_AGENT_TUTORIAL_DISMISSED_KEY, '1');
        setShowTutorialModal(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showTutorialModal]);

  const handleDismissTutorial = () => {
    localStorage.setItem(CREATE_AGENT_TUTORIAL_DISMISSED_KEY, '1');
    setShowTutorialModal(false);
  };

  const handleSoulImageSelection = (file: File | null) => {
    if (soulImagePreviewUrl) {
      URL.revokeObjectURL(soulImagePreviewUrl);
    }

    if (!file) {
      setSoulImageFile(null);
      setSoulImagePreviewUrl(null);
      setError(null);
      return;
    }

    if (!SUPPORTED_IMAGE_MIME_TYPES.has(file.type)) {
      setError('Soul NFT image must be PNG, JPG, GIF, or WebP');
      setSoulImageFile(null);
      setSoulImagePreviewUrl(null);
      return;
    }

    if (file.size > MAX_SOUL_IMAGE_SIZE_BYTES) {
      setError('Soul NFT image must be 5MB or smaller');
      setSoulImageFile(null);
      setSoulImagePreviewUrl(null);
      return;
    }

    setError(null);
    setSoulImageFile(file);
    setSoulImagePreviewUrl(URL.createObjectURL(file));
  };

  const handleNext = () => {
    if (step === 'identity' && !name.trim()) {
      setError('Agent name is required');
      return;
    }
    if (step === 'identity' && !bio.trim()) {
      setError('Agent bio is required');
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
    setSubmitPhase(soulImageFile ? 'uploading' : 'minting');
    setError(null);

    try {
      // 1. Generate soul asset keypair (for the NFT)
      const soulAssetKeypair = await generateKeyPair();
      const soulAssetAddress = await getAddressFromPublicKey(soulAssetKeypair.publicKey);

      // 2. Upload custom Soul image first so metadata points to a stable URL at mint time.
      let uploadedImageUrl: string | null = null;
      if (soulImageFile) {
        uploadedImageUrl = await uploadSoulImage(soulImageFile);
      }

      // 3. Resolve shared runtime executor address (server-managed keypair)
      const executorAddress = await fetchSharedExecutorAddress();

      // 4. Hash identity config for on-chain storage
      const identityConfig = JSON.stringify({
        bio: bio.trim(),
        flavorId: selectedFlavor,
        selectedSkills,
      });
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(identityConfig));
      const personalityHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const metadataUri = new URL(`https://agents.haus/api/agent/${soulAssetAddress}`);
      if (uploadedImageUrl) {
        metadataUri.searchParams.set('image', uploadedImageUrl);
      }

      setSubmitPhase('minting');

      // 5. Build + send the on-chain create agent transaction
      const ix = await createAgent({
        name: name.trim(),
        uri: metadataUri.toString(),
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

      const deployPreset = {
        profileId: selectedFlavor,
        skills: selectedSkills,
        model: selectedProfile.defaultModel || null,
      };
      localStorage.setItem(`agent-deploy-preset:${soulAssetAddress}`, JSON.stringify(deployPreset));
      localStorage.setItem(`agent-name:${soulAssetAddress}`, name.trim());
      setSubmitPhase('deploying');

      try {
        const deployRes = await fetch(`/api/agent/${soulAssetAddress}/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            force: true,
            profileId: selectedFlavor,
            skills: selectedSkills,
            model: selectedProfile.defaultModel || null,
          }),
        });

        if (deployRes.ok) {
          const deployData = await deployRes.json().catch(() => null);
          const deployState =
            typeof deployData?.state === 'string'
              ? deployData.state
              : null;
          if (deployState && deployState !== 'started' && deployState !== 'starting') {
            await fetch(`/api/agent/${soulAssetAddress}/machine/start`, { method: 'POST' });
          }
        } else {
          const deployErr = await deployRes.json().catch(() => null);
          console.error('Runtime auto-deploy failed:', deployErr?.error || deployRes.statusText);
        }
      } catch (deployErr) {
        console.error('Runtime auto-deploy request failed:', deployErr);
      }

      const params = new URLSearchParams();
      params.set('profile', selectedFlavor);
      params.set('skills', selectedSkills.join(','));
      if (selectedProfile.defaultModel) {
        params.set('model', selectedProfile.defaultModel);
      }

      setSubmitPhase('done');
      router.push(`/agent/${soulAssetAddress}?${params.toString()}`);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <button
          type="button"
          onClick={() => setShowTutorialModal(true)}
          className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
        >
          How this works
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Step: Identity + Strategy */}
      {step === 'identity' && (
        <div className="space-y-6">
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
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-ink">Soul NFT Image (optional)</label>
              {soulImageFile && (
                <button
                  type="button"
                  onClick={() => handleSoulImageSelection(null)}
                  className="text-xs text-ink-muted underline-offset-2 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => handleSoulImageSelection(e.target.files?.[0] ?? null)}
              className="w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-surface"
            />
            <p className="mt-1.5 text-xs text-ink-muted">
              PNG, JPG, GIF, or WebP up to 5MB. Uploaded before mint and included in NFT metadata.
            </p>
            {soulImagePreviewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={soulImagePreviewUrl}
                alt="Soul NFT preview"
                className="mt-3 h-40 w-40 rounded-xl border border-border-light object-cover"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Alpha App Strategies</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {alphaProfiles.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => handleSelectFlavor(profile.id)}
                  className={`rounded-2xl border p-5 text-left transition-colors ${
                    selectedFlavor === profile.id
                      ? 'border-ink bg-surface-raised shadow-sm'
                      : 'border-border bg-surface-raised hover:border-ink-muted'
                  }`}
                >
                  <div className="font-semibold text-ink mb-1">{profile.label}</div>
                  <div className="text-sm text-ink-secondary leading-relaxed">{profile.description}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">General Flavours</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {generalProfiles.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => handleSelectFlavor(profile.id)}
                  className={`rounded-2xl border p-5 text-left transition-colors ${
                    selectedFlavor === profile.id
                      ? 'border-ink bg-surface-raised shadow-sm'
                      : 'border-border bg-surface-raised hover:border-ink-muted'
                  }`}
                >
                  <div className="font-semibold text-ink mb-1">{profile.label}</div>
                  <div className="text-sm text-ink-secondary leading-relaxed">{profile.description}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {profile.presetSkills.map((skillId) => (
                      <span
                        key={skillId}
                        className="rounded-full bg-surface px-2 py-1 text-[11px] text-ink-muted"
                      >
                        {getAgentSkillLabel(skillId)}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border-light bg-surface px-4 py-3">
            <div className="text-xs text-ink-muted mb-1">Selected profile</div>
            <div className="text-sm font-medium text-ink">{selectedProfile.label}</div>
            <div className="text-xs text-ink-muted mt-1">
              Base on-chain strategy: {STRATEGY_LABELS[strategy]}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedSkills.map((skillId) => (
                <span
                  key={skillId}
                  className="rounded-full bg-surface-raised px-2 py-1 text-[11px] text-ink-muted"
                >
                  {getAgentSkillLabel(skillId)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step: Mint */}
      {step === 'mint' && (
        <div className="rounded-2xl border border-border bg-surface-raised p-6 space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Name</span>
            <span className="font-medium text-ink">{name || '(unnamed)'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Flavour</span>
            <span className="font-medium text-ink">{selectedProfile.label}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Base Strategy</span>
            <span className="font-medium text-ink">{STRATEGY_LABELS[strategy]}</span>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-ink-muted">Bio</div>
            <div className="rounded-xl bg-surface px-4 py-3 text-sm text-ink-secondary whitespace-pre-wrap">
              {bio || '(empty)'}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-ink-muted">Preset Skills</div>
            <div className="flex flex-wrap gap-1.5">
              {selectedSkills.map((skillId) => (
                <span
                  key={skillId}
                  className="rounded-full bg-surface px-2 py-1 text-xs text-ink-muted"
                >
                  {getAgentSkillLabel(skillId)}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-ink-muted">Soul NFT Image</div>
            {soulImagePreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={soulImagePreviewUrl}
                alt="Soul NFT preview"
                className="h-40 w-40 rounded-xl border border-border-light object-cover"
              />
            ) : (
              <div className="rounded-xl bg-surface px-4 py-3 text-sm text-ink-muted">
                No custom image selected.
              </div>
            )}
          </div>
          <div className="pt-4 border-t border-border-light text-xs text-ink-muted">
            This mints your Soul NFT, creates agent state on-chain, and then deploys and starts the runtime with your selected
            profile and skills. After deploy, fund the agent PDA wallet from Agent Settings → Wallet so it can post to
            Alpha.haus.
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
        {step === 'mint' ? (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="rounded-full bg-brand-500 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            {submitPhase === 'uploading'
              ? 'Uploading image...'
              : submitPhase === 'minting'
              ? 'Minting on-chain...'
              : submitPhase === 'deploying'
                ? 'Deploying runtime...'
                : 'Mint Soul NFT'}
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="rounded-full bg-ink px-6 py-2 text-sm font-medium text-surface hover:bg-ink/90 transition-colors"
          >
            Continue to Mint
          </button>
        )}
      </div>

      {showTutorialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/20 backdrop-blur-sm"
            onClick={handleDismissTutorial}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-agent-tutorial-title"
            className="relative w-full max-w-xl rounded-2xl border border-border bg-surface-raised p-6 shadow-xl settings-modal-enter"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="create-agent-tutorial-title" className="text-lg font-semibold text-ink">
                  First Agent Tutorial
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  Follow these two steps to launch correctly.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismissTutorial}
                className="rounded-lg border border-border px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-overlay transition-colors"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-border-light bg-surface p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">Step 1</div>
                <div className="text-sm font-medium text-ink">Create and mint a new agent</div>
                <p className="mt-1 text-sm text-ink-secondary">
                  Fill out this form, pick your strategy and skills, then mint the Soul NFT.
                </p>
              </div>

              <div className="rounded-xl border border-border-light bg-surface p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">Step 2</div>
                <div className="text-sm font-medium text-ink">Top up the agent PDA wallet once live</div>
                <p className="mt-1 text-sm text-ink-secondary">
                  After deployment, open the agent page and go to Settings → Wallet → Fund to deposit SOL into the agent PDA
                  wallet.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-brand-500/20 bg-brand-500/10 px-4 py-3 text-sm text-ink-secondary">
              This agent is configured to post to Alpha.haus, and Alpha.haus actions require SOL in the agent PDA wallet.
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={handleDismissTutorial}
                className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-surface hover:bg-ink/90 transition-colors"
              >
                Start Creating
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
