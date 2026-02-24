/**
 * Skill tool: get_x_data
 *
 * Fetches read-only data from X API v2.
 * Requires X_BEARER_TOKEN.
 */

const DEFAULT_X_API_BASE_URL = 'https://api.x.com/2';
const DEFAULT_MAX_RESULTS = 10;

type XDataMode = 'user' | 'timeline' | 'search';

interface GetXDataArgs {
  mode: XDataMode;
  username?: string;
  query?: string;
  maxResults?: number;
  excludeReplies?: boolean;
  excludeRetweets?: boolean;
}

interface GetXDataResult {
  ok: boolean;
  mode: XDataMode;
  data?: unknown;
  warning?: string;
  error?: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampMaxResults(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? Math.trunc(value)
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : DEFAULT_MAX_RESULTS;

  if (!Number.isFinite(parsed)) return DEFAULT_MAX_RESULTS;
  return Math.max(5, Math.min(100, parsed));
}

function buildHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function fetchXJson(
  url: string,
  token: string,
): Promise<{ ok: boolean; payload: any; status: number }> {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, payload, status: response.status };
}

function resolveXError(payload: any, status: number): string {
  if (payload?.detail && typeof payload.detail === 'string') return payload.detail;
  if (payload?.title && typeof payload.title === 'string') return payload.title;
  if (Array.isArray(payload?.errors) && payload.errors[0]?.message) {
    return String(payload.errors[0].message);
  }
  return `X API error (${status})`;
}

async function fetchUserByUsername(
  baseUrl: string,
  token: string,
  username: string,
): Promise<GetXDataResult> {
  const endpoint = `${baseUrl}/users/by/username/${encodeURIComponent(
    username,
  )}?user.fields=id,name,username,description,public_metrics,verified,created_at,profile_image_url`;

  const { ok, payload, status } = await fetchXJson(endpoint, token);
  if (!ok) {
    return { ok: false, mode: 'user', error: resolveXError(payload, status) };
  }
  return { ok: true, mode: 'user', data: payload };
}

async function fetchUserTimeline(
  baseUrl: string,
  token: string,
  username: string,
  maxResults: number,
  excludeReplies: boolean,
  excludeRetweets: boolean,
): Promise<GetXDataResult> {
  const userResult = await fetchUserByUsername(baseUrl, token, username);
  if (!userResult.ok) return userResult;

  const userId =
    userResult.data &&
    typeof userResult.data === 'object' &&
    typeof (userResult.data as { data?: { id?: unknown } }).data?.id === 'string'
      ? ((userResult.data as { data: { id: string } }).data.id as string)
      : '';
  if (!userId) {
    return { ok: false, mode: 'timeline', error: 'Failed to resolve user id' };
  }

  const excludeParts: string[] = [];
  if (excludeRetweets) excludeParts.push('retweets');
  if (excludeReplies) excludeParts.push('replies');

  const query = new URLSearchParams();
  query.set('max_results', String(maxResults));
  query.set(
    'tweet.fields',
    'id,text,author_id,created_at,public_metrics,lang,conversation_id',
  );
  if (excludeParts.length > 0) {
    query.set('exclude', excludeParts.join(','));
  }

  const endpoint = `${baseUrl}/users/${encodeURIComponent(
    userId,
  )}/tweets?${query.toString()}`;
  const { ok, payload, status } = await fetchXJson(endpoint, token);
  if (!ok) {
    return { ok: false, mode: 'timeline', error: resolveXError(payload, status) };
  }

  return {
    ok: true,
    mode: 'timeline',
    data: {
      user: userResult.data,
      timeline: payload,
    },
  };
}

async function fetchSearchResults(
  baseUrl: string,
  token: string,
  queryText: string,
  maxResults: number,
): Promise<GetXDataResult> {
  const query = new URLSearchParams();
  query.set('query', queryText);
  query.set('max_results', String(maxResults));
  query.set(
    'tweet.fields',
    'id,text,author_id,created_at,public_metrics,lang,conversation_id',
  );
  query.set('expansions', 'author_id');
  query.set('user.fields', 'id,name,username,description,public_metrics,verified');

  const endpoint = `${baseUrl}/tweets/search/recent?${query.toString()}`;
  const { ok, payload, status } = await fetchXJson(endpoint, token);
  if (!ok) {
    return { ok: false, mode: 'search', error: resolveXError(payload, status) };
  }
  return { ok: true, mode: 'search', data: payload };
}

export async function getXData(args: GetXDataArgs): Promise<GetXDataResult> {
  const mode = args?.mode;
  if (mode !== 'user' && mode !== 'timeline' && mode !== 'search') {
    return {
      ok: false,
      mode: 'search',
      error: 'mode must be one of: user, timeline, search',
    };
  }

  const token = (process.env.X_BEARER_TOKEN || '').trim();
  if (!token) {
    return {
      ok: false,
      mode,
      error: 'X_BEARER_TOKEN is not configured',
      warning: 'Configure X_BEARER_TOKEN to enable X data reads',
    };
  }

  const baseUrl = (process.env.X_API_BASE_URL || DEFAULT_X_API_BASE_URL).trim();
  const maxResults = clampMaxResults(args.maxResults);

  try {
    if (mode === 'user') {
      const username = normalizeText(args.username).replace(/^@/, '');
      if (!username) {
        return { ok: false, mode, error: 'username is required for mode=user' };
      }
      return await fetchUserByUsername(baseUrl, token, username);
    }

    if (mode === 'timeline') {
      const username = normalizeText(args.username).replace(/^@/, '');
      if (!username) {
        return { ok: false, mode, error: 'username is required for mode=timeline' };
      }
      return await fetchUserTimeline(
        baseUrl,
        token,
        username,
        maxResults,
        Boolean(args.excludeReplies),
        Boolean(args.excludeRetweets),
      );
    }

    const query = normalizeText(args.query);
    if (!query) {
      return { ok: false, mode, error: 'query is required for mode=search' };
    }
    return await fetchSearchResults(baseUrl, token, query, maxResults);
  } catch (err) {
    return {
      ok: false,
      mode,
      error: err instanceof Error ? err.message : 'Failed to fetch X data',
    };
  }
}
