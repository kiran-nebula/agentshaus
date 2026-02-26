import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PROMPT_LENGTH = 600;
const MAX_MODEL_ID_LENGTH = 200;
const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_IMAGE_MODEL =
  'google/gemini-2.5-flash-image';
const OPENROUTER_IMAGE_MODEL_FALLBACKS = [
  'google/gemini-2.5-flash-image',
  'google/gemini-3.1-flash-image-preview',
  'google/gemini-3-pro-image-preview',
  'openai/gpt-5-image-mini',
];
const SUPPORTED_ASPECT_RATIOS = new Set([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);

export const runtime = 'nodejs';

type OpenRouterImage = {
  image_url?: { url?: unknown };
  imageUrl?: { url?: unknown };
};

function normalizeMimeType(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().split(';')[0].trim();
  return SUPPORTED_MIME_TYPES.has(normalized) ? normalized : null;
}

function getOpenRouterImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const message = (choice as { message?: unknown }).message;
    if (!message || typeof message !== 'object') continue;
    const images = (message as { images?: unknown }).images;
    if (!Array.isArray(images)) continue;

    for (const image of images) {
      if (!image || typeof image !== 'object') continue;
      const normalized = image as OpenRouterImage;
      const rawUrl = normalized.image_url?.url ?? normalized.imageUrl?.url;
      if (typeof rawUrl === 'string' && rawUrl.trim()) {
        return rawUrl.trim();
      }
    }
  }

  return null;
}

async function uploadSoulImageToBlob(
  image: Blob,
  contentTypeHint?: string,
): Promise<string> {
  const contentType = normalizeMimeType(contentTypeHint || image.type);
  if (!contentType) {
    throw new Error('Unsupported image format. Use PNG, JPG, GIF, or WebP');
  }
  if (image.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('Image must be 5MB or smaller');
  }

  const extension = MIME_EXTENSION[contentType] || 'bin';
  const filePath = `soul-images/${Date.now()}-${randomUUID()}.${extension}`;
  const blob = await put(filePath, image, {
    access: 'public',
    addRandomSuffix: false,
    contentType,
  });

  return blob.url;
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_IMAGE_PROMPT_LENGTH);
}

function normalizeModel(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_MODEL_ID_LENGTH);
}

function normalizeAspectRatio(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return SUPPORTED_ASPECT_RATIOS.has(trimmed) ? trimmed : null;
}

function dedupeModels(models: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const normalized = normalizeModel(model);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function getOpenRouterErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function isUnavailableModelError(message: string | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('no endpoints found') ||
    normalized.includes('model not found') ||
    normalized.includes('not available') ||
    normalized.includes('unknown model')
  );
}

type OpenRouterModelAttempt = {
  ok: boolean;
  status: number;
  payload: unknown;
  model: string;
};

async function requestOpenRouterImageCompletion(args: {
  model: string;
  prompt: string;
  aspectRatio: string;
  httpReferer: string;
  apiKey: string;
}): Promise<OpenRouterModelAttempt> {
  const sendOpenRouterRequest = async (modalities: string[]) =>
    fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': args.httpReferer,
        'X-Title': 'agents.haus',
      },
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: 'user', content: args.prompt }],
        modalities,
        image_config: { aspect_ratio: args.aspectRatio },
        stream: false,
      }),
    });

  let response = await sendOpenRouterRequest(['image', 'text']);
  let payload = await response.json().catch(() => null);
  if (!response.ok) {
    const fallbackResponse = await sendOpenRouterRequest(['image']);
    const fallbackPayload = await fallbackResponse.json().catch(() => null);
    if (fallbackResponse.ok) {
      response = fallbackResponse;
      payload = fallbackPayload;
    } else {
      const firstError = getOpenRouterErrorMessage(payload);
      const fallbackError = getOpenRouterErrorMessage(fallbackPayload);
      if (isUnavailableModelError(firstError) || isUnavailableModelError(fallbackError)) {
        response = fallbackResponse;
        payload = fallbackPayload;
      }
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    model: args.model,
  };
}

async function handleImageUpload(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Image file is required' },
      { status: 400 },
    );
  }

  if (!normalizeMimeType(file.type)) {
    return NextResponse.json(
      { error: 'Unsupported image format. Use PNG, JPG, GIF, or WebP' },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: 'Image must be 5MB or smaller' },
      { status: 400 },
    );
  }

  const url = await uploadSoulImageToBlob(file, file.type);
  return NextResponse.json({ url, source: 'upload' });
}

async function handleImageGeneration(request: NextRequest): Promise<NextResponse> {
  const openRouterApiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!openRouterApiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY is not configured' },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const prompt = normalizePrompt(body?.prompt);
  if (!prompt) {
    return NextResponse.json(
      { error: 'prompt is required' },
      { status: 400 },
    );
  }

  const selectedModel =
    normalizeModel(body?.model) ||
    normalizeModel(process.env.OPENROUTER_IMAGE_MODEL) ||
    DEFAULT_OPENROUTER_IMAGE_MODEL;
  const aspectRatio = normalizeAspectRatio(body?.aspectRatio) || '1:1';
  const httpReferer =
    (request.headers.get('origin') || '').trim() || 'https://agents.haus';
  const candidateModels = dedupeModels([
    selectedModel,
    ...OPENROUTER_IMAGE_MODEL_FALLBACKS,
  ]);

  let selectedPayload: unknown = null;
  let selectedModelUsed = selectedModel;
  let selectedStatus = 502;
  let selectedErrorMessage: string | null = null;

  for (const model of candidateModels) {
    const attempt = await requestOpenRouterImageCompletion({
      model,
      prompt,
      aspectRatio,
      httpReferer,
      apiKey: openRouterApiKey,
    });

    if (attempt.ok) {
      const generatedImageUrl = getOpenRouterImageUrl(attempt.payload);
      if (generatedImageUrl) {
        const imageResponse = await fetch(generatedImageUrl);
        if (!imageResponse.ok) {
          return NextResponse.json(
            { error: 'Failed to download generated image from OpenRouter response' },
            { status: 502 },
          );
        }

        const generatedImage = await imageResponse.blob();
        const contentTypeHint =
          imageResponse.headers.get('content-type') || generatedImage.type;
        const url = await uploadSoulImageToBlob(generatedImage, contentTypeHint);

        return NextResponse.json({
          url,
          source: 'openrouter',
          model,
        });
      }

      selectedPayload = attempt.payload;
      selectedStatus = attempt.status;
      selectedModelUsed = model;
      selectedErrorMessage = 'OpenRouter did not return an image';
      continue;
    }

    const errorMessage = getOpenRouterErrorMessage(attempt.payload);
    selectedPayload = attempt.payload;
    selectedStatus = attempt.status;
    selectedModelUsed = model;
    selectedErrorMessage = errorMessage || 'OpenRouter image generation failed';

    if (isUnavailableModelError(errorMessage)) {
      continue;
    }

    return NextResponse.json(
      { error: selectedErrorMessage },
      { status: attempt.status >= 500 ? 502 : 400 },
    );
  }

  const generatedImageUrl = getOpenRouterImageUrl(selectedPayload);
  if (!generatedImageUrl) {
    return NextResponse.json(
      {
        error:
          selectedErrorMessage || `No endpoints found for ${selectedModelUsed}.`,
      },
      { status: selectedStatus >= 500 ? 502 : 400 },
    );
  }
  return NextResponse.json(
    { error: 'Failed to process OpenRouter image response' },
    { status: 502 },
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: 'BLOB_READ_WRITE_TOKEN is not configured' },
        { status: 500 },
      );
    }

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await handleImageGeneration(request);
    }

    return await handleImageUpload(request);
  } catch (err) {
    console.error('Failed to process Soul NFT image:', err);
    return NextResponse.json(
      { error: 'Failed to process Soul NFT image' },
      { status: 500 },
    );
  }
}
