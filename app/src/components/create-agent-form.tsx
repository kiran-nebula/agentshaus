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
  const [skillsQuery, setSkillsQuery] = useState('');
  const [extraSkills, setExtraSkills] = useState<string[]>([]);
  const [loadedSkillsFromQuery, setLoadedSkillsFromQuery] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>(Strategy.AlphaHunter);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'minting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);
  const selectedProfile = getFlavorProfile(selectedFlavor);
  const selectedSkills = Array.from(
    new Set([...selectedProfile.presetSkills, ...extraSkills]),
  );
  const alphaProfiles = FLAVOR_PROFILES.filter((profile) => profile.category === 'alpha');
  const generalProfiles = FLAVOR_PROFILES.filter((profile) => profile.category === 'general');
  const filteredSkillPacks = SOLANA_SKILL_PACKS.filter((skill) => {
    if (!skillsQuery.trim()) return true;
    const q = skillsQuery.trim().toLowerCase();
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.slug.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q)
    );
  });

  const handleSelectFlavor = (profileId: FlavorProfileId) => {
    const profile = getFlavorProfile(profileId);
    setSelectedFlavor(profileId);
    setStrategy(profile.baseStrategy);
  };

  const handleToggleSkill = (skillId: string) => {
    setExtraSkills((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId],
    );
  };

  useEffect(() => {
    if (loadedSkillsFromQuery) return;
    const fromQuery = (searchParams.get('skills') || '')
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean)
      .filter((skill) => skill.startsWith('sendaifun:'));
    if (fromQuery.length > 0) {
      setExtraSkills(fromQuery);
    }
    setLoadedSkillsFromQuery(true);
  }, [loadedSkillsFromQuery, searchParams]);

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
    setSubmitPhase('minting');
    setError(null);

    try {
      // 1. Generate soul asset keypair (for the NFT)
      const soulAssetKeypair = await generateKeyPair();
      const soulAssetAddress = await getAddressFromPublicKey(soulAssetKeypair.publicKey);

      // 2. Generate executor keypair pubkey (can be replaced later from the agent page)
      const executorKeypair = await generateKeyPair();
      const executorAddress = await getAddressFromPublicKey(executorKeypair.publicKey);

      // 3. Hash identity config for on-chain storage
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

      // 4. Build + send the on-chain create agent transaction
      const ix = await createAgent({
        name: name.trim(),
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

      const deployPreset = {
        profileId: selectedFlavor,
        skills: selectedSkills,
        model: selectedProfile.defaultModel || null,
      };
      localStorage.setItem(`agent-deploy-preset:${soulAssetAddress}`, JSON.stringify(deployPreset));

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
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-ink">Attach Skill Packs</label>
              <span className="text-xs text-ink-muted">from `sendaifun/skills`</span>
            </div>
            <input
              type="text"
              value={skillsQuery}
              onChange={(e) => setSkillsQuery(e.target.value)}
              placeholder="Search skill packs..."
              className="w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none transition-colors"
            />
            <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-border-light bg-surface-raised p-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {filteredSkillPacks.map((skill) => {
                  const selected = extraSkills.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => handleToggleSkill(skill.id)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'border-ink bg-surface text-ink'
                          : 'border-border-light bg-surface-raised text-ink-secondary hover:border-border'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{skill.name}</span>
                        <span className="text-[10px] text-ink-muted">{selected ? 'Added' : 'Add'}</span>
                      </div>
                      <div className="mt-1 max-h-8 overflow-hidden text-[11px] text-ink-muted">
                        {skill.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              Selected skills: {selectedSkills.length}
            </p>
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
          <div className="pt-4 border-t border-border-light text-xs text-ink-muted">
            This mints your Soul NFT and creates agent state on-chain. Deploy settings for model and skills are prefilled on the
            agent page.
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
            {submitPhase === 'minting' ? 'Minting on-chain...' : 'Mint Soul NFT'}
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
    </div>
  );
}
