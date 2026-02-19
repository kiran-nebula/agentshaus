/**
 * Skill tool: post_to_x
 *
 * Posts text to X if X_BEARER_TOKEN is configured.
 * Falls back to dry-run output when credentials are missing.
 */

const DEFAULT_X_API_BASE_URL = 'https://api.x.com/2';
const X_CHAR_LIMIT = 280;

interface PostToXArgs {
  text: string;
  replyToId?: string;
  dryRun?: boolean;
}

interface PostToXResult {
  ok: boolean;
  dryRun: boolean;
  text?: string;
  tweetId?: string;
  url?: string;
  warning?: string;
  error?: string;
}

function normalizeText(text: unknown): string {
  return typeof text === 'string' ? text.trim() : '';
}

export async function postToX(args: PostToXArgs): Promise<PostToXResult> {
  const text = normalizeText(args.text);
  if (!text) {
    return { ok: false, dryRun: true, error: 'text is required' };
  }

  if (text.length > X_CHAR_LIMIT) {
    return {
      ok: false,
      dryRun: true,
      error: `post exceeds ${X_CHAR_LIMIT} characters (${text.length})`,
    };
  }

  const token = (process.env.X_BEARER_TOKEN || '').trim();
  const baseUrl = (process.env.X_API_BASE_URL || DEFAULT_X_API_BASE_URL).trim();
  const shouldDryRun = Boolean(args.dryRun) || !token;

  if (shouldDryRun) {
    return {
      ok: true,
      dryRun: true,
      text,
      warning: token ? undefined : 'X_BEARER_TOKEN is not configured; returned dry-run only',
    };
  }

  const payload: {
    text: string;
    reply?: { in_reply_to_tweet_id: string };
  } = { text };

  const replyToId = normalizeText(args.replyToId);
  if (replyToId) {
    payload.reply = { in_reply_to_tweet_id: replyToId };
  }

  try {
    const response = await fetch(`${baseUrl}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => null) as
      | { data?: { id?: string } }
      | { detail?: string; title?: string; errors?: Array<{ message?: string }> }
      | null;

    if (!response.ok) {
      const detail =
        (body && 'detail' in body && body.detail) ||
        (body && 'title' in body && body.title) ||
        (body &&
          'errors' in body &&
          Array.isArray(body.errors) &&
          body.errors[0] &&
          body.errors[0].message) ||
        `X API error (${response.status})`;

      return {
        ok: false,
        dryRun: false,
        error: detail,
      };
    }

    const tweetId = body && 'data' in body ? body.data?.id : undefined;
    return {
      ok: true,
      dryRun: false,
      text,
      tweetId,
      url: tweetId ? `https://x.com/i/web/status/${tweetId}` : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      dryRun: false,
      error: err instanceof Error ? err.message : 'Failed to call X API',
    };
  }
}
