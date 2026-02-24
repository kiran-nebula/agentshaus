import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_MEMO_LENGTH } from '@agents-haus/common';

const SOUL_FILE_PATH = path.join(process.cwd(), 'workspace', 'SOUL.md');
const PERSONALITY_PLACEHOLDER = '{PERSONALITY_PLACEHOLDER}';
const AUTO_RECLAIM_MEMO_FALLBACK = '[auto-reclaim] Reclaiming TOP ALPHA position';
const MAX_SOUL_TEXT_LENGTH = 4_000;
const MAX_STYLE_SNIPPET_LENGTH = 220;
const MEMO_CACHE_TTL_MS = 60_000;

let memoCache: { value: string; expiresAt: number } | null = null;

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeSoulText(input: string | null | undefined): string {
  if (!input) return '';
  return normalizeWhitespace(input).slice(0, MAX_SOUL_TEXT_LENGTH);
}

function trimMemo(input: string): string {
  const normalized = normalizeWhitespace(input)
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '');
  if (!normalized) return AUTO_RECLAIM_MEMO_FALLBACK;
  if (normalized.length <= MAX_MEMO_LENGTH) return normalized;
  return normalized.slice(0, MAX_MEMO_LENGTH).trim();
}

function extractPersonalitySection(soulDocument: string): string {
  const normalized = soulDocument.replace(/\r/g, '');
  const heading = normalized.match(/^##\s*Personality\s*$/im);
  if (!heading || heading.index === undefined) return '';

  const afterHeading = normalized.slice(heading.index + heading[0].length);
  const nextHeadingIndex = afterHeading.search(/^\s*##\s+\S.*$/m);
  const section =
    nextHeadingIndex >= 0 ? afterHeading.slice(0, nextHeadingIndex) : afterHeading;
  return sanitizeSoulText(section.replace(PERSONALITY_PLACEHOLDER, ''));
}

function extractCustomReclaimMemo(personality: string): string | null {
  const lines = personality
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(
      /^(?:auto[\s-]?reclaim|reclaim)\s*(?:memo|message)\s*[:=-]\s*(.+)$/i,
    );
    if (match && match[1]) {
      return trimMemo(match[1]);
    }
  }

  return null;
}

function extractStyleSnippet(personality: string): string | null {
  const flattened = personality
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter((line) => line.length > 0);
  if (flattened.length === 0) return null;

  const candidate = flattened[0]
    .replace(/^(you are|identity|personality|voice)\s*[:\-]\s*/i, '')
    .trim();
  if (!candidate) return null;

  const firstSentence = candidate.split(/[.!?]/)[0]?.trim() || candidate;
  if (!firstSentence) return null;
  return firstSentence.slice(0, MAX_STYLE_SNIPPET_LENGTH);
}

function getSoulTextFromEnv(): string {
  return sanitizeSoulText(process.env.AGENT_SOUL_TEXT);
}

async function readSoulDocument(): Promise<string> {
  try {
    return await readFile(SOUL_FILE_PATH, 'utf8');
  } catch {
    return '';
  }
}

export async function hydrateSoulTemplateFromEnv(): Promise<void> {
  const soulText = getSoulTextFromEnv();
  if (!soulText) return;

  const soulDocument = await readSoulDocument();
  if (!soulDocument) return;
  if (!soulDocument.includes(PERSONALITY_PLACEHOLDER)) return;

  const hydrated = soulDocument.replace(PERSONALITY_PLACEHOLDER, soulText);
  if (hydrated === soulDocument) return;

  try {
    await writeFile(SOUL_FILE_PATH, hydrated, 'utf8');
  } catch {
    // Ignore write failures and continue; runtime can still fall back to env text.
  }
}

export async function getAutoReclaimMemoFromSoul(): Promise<string> {
  if (memoCache && memoCache.expiresAt > Date.now()) {
    return memoCache.value;
  }

  const soulDocument = await readSoulDocument();
  const personalityFromDocument = extractPersonalitySection(soulDocument);
  const personality = personalityFromDocument || getSoulTextFromEnv();

  const customMemo = extractCustomReclaimMemo(personality);
  if (customMemo) {
    memoCache = { value: customMemo, expiresAt: Date.now() + MEMO_CACHE_TTL_MS };
    return customMemo;
  }

  const styleSnippet = extractStyleSnippet(personality);
  const generatedMemo = styleSnippet
    ? trimMemo(`[auto-reclaim] Reclaiming TOP ALPHA. ${styleSnippet}`)
    : AUTO_RECLAIM_MEMO_FALLBACK;

  memoCache = { value: generatedMemo, expiresAt: Date.now() + MEMO_CACHE_TTL_MS };
  return generatedMemo;
}
