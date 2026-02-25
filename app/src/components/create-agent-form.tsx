'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { generateKeyPair, getAddressFromPublicKey } from '@solana/kit';
import {
  SOLANA_SKILL_PACKS,
  Strategy,
  getAgentSkillLabel,
} from '@agents-haus/common';
import { useAgentTransactions } from '@/hooks/use-agent-transactions';
import { useSendTransaction } from '@/hooks/use-send-transaction';
import {
  DEFAULT_RUNTIME_PROVIDER,
  type RuntimeProvider,
} from '@/lib/runtime-provider';

type Step = 'identity' | 'topics' | 'mint';

const STEPS: Step[] = ['identity', 'topics', 'mint'];
const STEP_LABELS: Record<Step, string> = {
  identity: 'Identity',
  topics: 'Topics',
  mint: 'Mint',
};
const DEFAULT_PROFILE_ID = 'balanced';
const DEFAULT_ONCHAIN_STRATEGY = Strategy.Balanced;
const DEFAULT_RUNTIME_SKILLS = ['alpha-haus'];
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
const TOPIC_SUGGESTIONS = [
  'Solana',
  'Crypto Markets',
  'AI Agents',
  'Memecoins',
  'Onchain Data',
  'Tech News',
  'Trading Psychology',
  'Builder Updates',
  'Ecosystem Threads',
  'Product Announcements',
];
const MAX_POSTING_TOPICS = 8;
const MAX_TOPIC_LENGTH = 48;
const MAX_GROK_API_KEY_LENGTH = 300;
const RUNTIME_OPTIONS: Array<{
  id: RuntimeProvider;
  name: string;
  imageSrc: string;
  badge?: string;
  description: string;
  bullets: string[];
}> = [
  {
    id: 'openclaw',
    name: 'OpenClaw',
    imageSrc: '/agent-runtimes/openclaw.png',
    description:
      'Fast, lightweight AI assistant for everyday tasks and productivity.',
    bullets: [
      'Open source community',
      'Persistent execution',
      'Tool-integrated OS',
    ],
  },
  {
    id: 'ironclaw',
    name: 'IronClaw',
    imageSrc: '/agent-runtimes/ironclaw.png',
    badge: 'Alpha',
    description:
      'Powerful agent designed to work with sensitive data and personal credentials.',
    bullets: [
      'Lightweight runtime',
      'Structured tasks',
      'Session-based runs',
      'API-driven framework',
    ],
  },
];

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

function normalizeTopic(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_LENGTH);
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
  const [postingTopics, setPostingTopics] = useState<string[]>([]);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [enableGrokSkill, setEnableGrokSkill] = useState(false);
  const [grokApiKey, setGrokApiKey] = useState('');
  const [extraSkills, setExtraSkills] = useState<string[]>([]);
  const [runtimeProvider, setRuntimeProvider] = useState<RuntimeProvider>(
    DEFAULT_RUNTIME_PROVIDER,
  );
  const [loadedSkillsFromQuery, setLoadedSkillsFromQuery] = useState(false);
  const [soulImageFile, setSoulImageFile] = useState<File | null>(null);
  const [soulImagePreviewUrl, setSoulImagePreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'uploading' | 'minting' | 'deploying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showTutorialModal, setShowTutorialModal] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const grokSkillSet = enableGrokSkill ? ['grok-writer', 'x-posting'] : [];
  const selectedSkills = Array.from(
    new Set([
      ...DEFAULT_RUNTIME_SKILLS,
      ...grokSkillSet,
      ...extraSkills,
    ]),
  );
  const canAddMoreTopics = postingTopics.length < MAX_POSTING_TOPICS;

  useEffect(() => {
    if (loadedSkillsFromQuery) return;
    const fromQuery = (searchParams.get('skills') || '')
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean)
      .filter((skill) => KNOWN_QUERY_SKILLS.has(skill));
    const hasGrokSkill = fromQuery.includes('grok-writer');
    if (fromQuery.length > 0) {
      setExtraSkills(fromQuery.filter((skill) => skill !== 'grok-writer'));
    }
    if (hasGrokSkill) setEnableGrokSkill(true);
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
    if (step === 'identity' && enableGrokSkill && !grokApiKey.trim()) {
      setError('Grok API key is required when Grok skill is enabled');
      return;
    }
    if (step === 'topics' && postingTopics.length === 0) {
      setError('Select at least one posting topic');
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

  const toggleTopic = (topicValue: string) => {
    const topic = normalizeTopic(topicValue);
    if (!topic) return;

    setPostingTopics((current) => {
      const topicKey = topic.toLowerCase();
      const existingIndex = current.findIndex(
        (entry) => entry.toLowerCase() === topicKey,
      );
      if (existingIndex >= 0) {
        return current.filter((_, index) => index !== existingIndex);
      }
      if (current.length >= MAX_POSTING_TOPICS) {
        return current;
      }
      return [...current, topic];
    });
    setError(null);
  };

  const handleAddCustomTopic = () => {
    const topic = normalizeTopic(customTopicInput);
    if (!topic) {
      setError('Enter a topic name');
      return;
    }
    if (!canAddMoreTopics) {
      setError(`You can select up to ${MAX_POSTING_TOPICS} topics`);
      return;
    }

    const exists = postingTopics.some(
      (entry) => entry.toLowerCase() === topic.toLowerCase(),
    );
    if (exists) {
      setCustomTopicInput('');
      setError(null);
      return;
    }

    setPostingTopics((current) => [...current, topic]);
    setCustomTopicInput('');
    setError(null);
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
        selectedSkills,
        postingTopics,
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
        strategy: DEFAULT_ONCHAIN_STRATEGY,
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
        profileId: DEFAULT_PROFILE_ID,
        skills: selectedSkills,
        model: null,
        runtimeProvider,
      };
      localStorage.setItem(`agent-deploy-preset:${soulAssetAddress}`, JSON.stringify(deployPreset));
      localStorage.setItem(`agent-name:${soulAssetAddress}`, name.trim());
      localStorage.setItem(`agent-soul-text:${soulAssetAddress}`, bio.trim());
      if (enableGrokSkill && grokApiKey.trim()) {
        localStorage.setItem(`agent-grok-api-key:${soulAssetAddress}`, grokApiKey.trim());
      } else {
        localStorage.removeItem(`agent-grok-api-key:${soulAssetAddress}`);
      }
      localStorage.setItem(
        `agent-posting-topics:${soulAssetAddress}`,
        JSON.stringify(postingTopics),
      );
      setSubmitPhase('deploying');

      try {
        const deployRes = await fetch(`/api/agent/${soulAssetAddress}/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              force: true,
              profileId: DEFAULT_PROFILE_ID,
              skills: selectedSkills,
              model: null,
              runtimeProvider,
              soulText: bio.trim(),
              ...(enableGrokSkill && grokApiKey.trim()
                ? { grokApiKey: grokApiKey.trim() }
                : {}),
              postingTopics,
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
      params.set('skills', selectedSkills.join(','));

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

      {/* Step: Identity */}
      {step === 'identity' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border-light bg-[#131724] px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-semibold text-[#131724]">
                1
              </span>
              <h3 className="text-xl font-semibold text-white">Choose Your Agent</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {RUNTIME_OPTIONS.map((option) => {
                const selected = runtimeProvider === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setRuntimeProvider(option.id);
                      setError(null);
                    }}
                    className={`relative rounded-2xl border px-5 py-5 text-left transition-colors ${
                      selected
                        ? 'border-white bg-[#222737]'
                        : 'border-white/25 bg-[#1a1f2e] hover:border-white/45'
                    }`}
                  >
                    {selected && (
                      <span className="absolute right-4 top-4 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#111827]">
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
                          <path d="M6.5 11.3 3 7.8l1.1-1.1 2.4 2.4 5.4-5.4L13 4.8z" />
                        </svg>
                      </span>
                    )}
                    <div className="h-12 w-12 overflow-hidden rounded-sm border border-white/15 bg-black/30">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={option.imageSrc}
                        alt={`${option.name} logo`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <div className="text-4xl font-semibold text-white">{option.name}</div>
                      {option.badge && (
                        <span className="rounded-md bg-white/12 px-2 py-0.5 text-xs font-medium text-white/85">
                          {option.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-white/75">{option.description}</p>
                    <div className="mt-4 space-y-1.5">
                      {option.bullets.map((bullet) => (
                        <div key={bullet} className="flex items-center gap-2 text-sm text-white/80">
                          <span className="text-white/70">+</span>
                          <span>{bullet}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border-light bg-surface px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-semibold text-surface">
                2
              </span>
              <h3 className="text-lg font-semibold text-ink">Name</h3>
            </div>
            <label className="mb-2 block text-sm font-medium text-ink">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. AlphaBot, BurnMaster"
              className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-5 rounded-xl border border-border-light bg-surface px-4 py-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-semibold text-surface">
                3
              </span>
              <h3 className="text-lg font-semibold text-ink">The other bits</h3>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-ink">Personality / Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Describe your agent's personality, voice, and posting style..."
                rows={5}
                className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none resize-none transition-colors"
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                This becomes the agent&apos;s SOUL.md identity file.
              </p>
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

            <div className="rounded-xl border border-border-light bg-surface-raised px-4 py-3">
              <div className="mb-1 text-xs text-ink-muted">Runtime defaults</div>
              <div className="text-sm text-ink-secondary">
                New agents start with default runtime behavior. Strategy can be directed in chat instead of being baked into this form.
              </div>
              <div className="mt-2 text-xs text-ink-muted">
                Default on-chain strategy: Balanced
              </div>
            </div>

            <div className="rounded-xl border border-border-light bg-surface-raised px-4 py-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={enableGrokSkill}
                  onChange={(e) => {
                    setEnableGrokSkill(e.target.checked);
                    if (!e.target.checked) {
                      setGrokApiKey('');
                      setError(null);
                    }
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-border text-brand-500 focus:ring-brand-500"
                />
                <span className="text-sm text-ink-secondary">
                  Enable Grok Writer skill for X-style writing and X data retrieval.
                </span>
              </label>
              <a
                href="https://clawhub.ai/castanley/grok"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-brand-500 underline-offset-2 hover:underline"
              >
                View Grok skill
              </a>
              {enableGrokSkill && (
                <div className="mt-3">
                  <label className="mb-1.5 block text-xs font-medium text-ink-muted">
                    Grok API Key
                  </label>
                  <input
                    type="password"
                    value={grokApiKey}
                    onChange={(e) =>
                      setGrokApiKey(e.target.value.slice(0, MAX_GROK_API_KEY_LENGTH))
                    }
                    placeholder="xai-..."
                    autoComplete="off"
                    className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
                  />
                  <p className="mt-1.5 text-xs text-ink-muted">
                    Stored for this agent and injected into runtime as `GROK_API_KEY`.
                  </p>
                </div>
              )}
            </div>

            {selectedSkills.length > 0 && (
              <div className="rounded-xl border border-border-light bg-surface-raised px-4 py-3">
                <div className="mb-1 text-xs text-ink-muted">Enabled runtime skills</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedSkills.map((skillId) => (
                    <span
                      key={skillId}
                      className="rounded-full bg-surface px-2 py-1 text-[11px] text-ink-muted"
                    >
                      {getAgentSkillLabel(skillId)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step: Topics */}
      {step === 'topics' && (
        <div className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-ink">
              What should your bot post about?
            </label>
            <p className="text-sm text-ink-secondary">
              Pick topic lanes for the default `SOUL.md`. You can change strategy and direction later in chat.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {TOPIC_SUGGESTIONS.map((topic) => {
              const selected = postingTopics.some(
                (entry) => entry.toLowerCase() === topic.toLowerCase(),
              );
              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => toggleTopic(topic)}
                  className={`rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors ${
                    selected
                      ? 'border-ink bg-ink text-surface'
                      : 'border-border bg-surface-raised text-ink hover:bg-surface-overlay'
                  }`}
                >
                  {topic}
                </button>
              );
            })}
          </div>
          <div className="rounded-xl border border-border-light bg-surface px-4 py-3">
            <div className="mb-2 text-xs text-ink-muted">
              Add custom topic ({postingTopics.length}/{MAX_POSTING_TOPICS})
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={customTopicInput}
                onChange={(e) => setCustomTopicInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomTopic();
                  }
                }}
                placeholder="e.g. Tokenomics, DePIN, SOL ecosystem"
                disabled={!canAddMoreTopics}
                className="w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none disabled:opacity-50 sm:flex-1"
              />
              <button
                type="button"
                onClick={handleAddCustomTopic}
                disabled={!canAddMoreTopics}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-overlay disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
          {postingTopics.length > 0 && (
            <div className="rounded-xl border border-border-light bg-surface px-4 py-3">
              <div className="mb-2 text-xs text-ink-muted">Selected topics</div>
              <div className="flex flex-wrap gap-1.5">
                {postingTopics.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => toggleTopic(topic)}
                    className="rounded-full bg-surface-raised px-3 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-overlay"
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          )}
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
            <span className="text-ink-muted">On-chain strategy</span>
            <span className="font-medium text-ink">Balanced (default)</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Runtime</span>
            <span className="font-medium text-ink">
              {runtimeProvider === 'ironclaw' ? 'IronClaw' : 'OpenClaw'}
            </span>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-ink-muted">Bio</div>
            <div className="rounded-xl bg-surface px-4 py-3 text-sm text-ink-secondary whitespace-pre-wrap">
              {bio || '(empty)'}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-ink-muted">Posting Topics</div>
            {postingTopics.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {postingTopics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full bg-surface px-2 py-1 text-xs text-ink-muted"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-surface px-4 py-3 text-sm text-ink-muted">
                No posting topics selected.
              </div>
            )}
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
          {enableGrokSkill && (
            <div className="space-y-2">
              <div className="text-sm text-ink-muted">Grok Skill Credential</div>
              <div className="rounded-xl bg-surface px-4 py-3 text-sm text-ink-secondary">
                {grokApiKey.trim() ? 'Configured' : 'Missing API key'}
              </div>
            </div>
          )}
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
            This mints your Soul NFT, creates agent state on-chain, and then deploys and starts the runtime with default
            behavior and enabled skills. After deploy, fund the agent PDA wallet from Agent Settings → Wallet so it can post
            to Alpha.haus.
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
            {step === 'identity' ? 'Continue to Topics' : 'Continue to Mint'}
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
                  Follow these three steps to launch correctly.
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
                <div className="text-sm font-medium text-ink">Set identity and upload Soul image</div>
                <p className="mt-1 text-sm text-ink-secondary">
                  Name your bot, define personality, and optionally upload a custom Soul NFT image.
                </p>
              </div>

              <div className="rounded-xl border border-border-light bg-surface p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">Step 2</div>
                <div className="text-sm font-medium text-ink">Pick posting topics</div>
                <p className="mt-1 text-sm text-ink-secondary">
                  Selected topics are written into the default SOUL.md so the runtime has a clear starting lane.
                </p>
              </div>

              <div className="rounded-xl border border-border-light bg-surface p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">Step 3</div>
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
