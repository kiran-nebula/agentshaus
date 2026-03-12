const YUTORI_BASE_URL = 'https://api.yutori.com';

function getApiKey(): string {
  const key = process.env.YUTORI_API_KEY;
  if (!key) throw new Error('YUTORI_API_KEY is not set');
  return key;
}

function headers(): Record<string, string> {
  return {
    'X-API-Key': getApiKey(),
    'Content-Type': 'application/json',
  };
}

// --- Types matching Yutori API responses ---

export interface YutoriScout {
  id: string;
  query: string;
  display_name: string;
  status: 'active' | 'paused' | 'done';
  created_at: string;
  next_output_timestamp: string | null;
  next_run_timestamp: string | null;
  output_interval: number;
  rejection_reason: string | null;
  last_update_timestamp?: string | null;
  update_count?: number;
  is_public?: boolean;
  view_url?: string | null;
  completed_at?: string | null;
  paused_at?: string | null;
  user_timezone?: string;
}

export interface YutoriListResponse {
  scouts: YutoriScout[];
  total: number;
  filtered_total: number;
  summary: { active: number; paused: number; done: number };
  has_more: boolean;
  next_cursor: string | null;
  prev_cursor: string | null;
}

export interface YutoriCitation {
  id: string;
  url: string;
  preview_data?: Record<string, unknown>;
}

export interface YutoriUpdate {
  id: string;
  timestamp: number;
  content: string;
  citations: YutoriCitation[];
  stats: {
    num_tool_calls: number;
    num_mcp_tool_calls: number;
    num_webpages_read: number;
    num_navigator_steps: number;
    num_websites_visited: number;
    sec_saved: number;
  } | null;
  structured_result?: unknown;
  header_image_url: string | null;
}

export interface YutoriUpdatesResponse {
  updates: YutoriUpdate[];
  prev_cursor: string | null;
  next_cursor: string | null;
}

// --- API Functions ---

export async function listScouts(opts?: {
  status?: 'active' | 'paused' | 'done';
  pageSize?: number;
  cursor?: string;
  includeAllSources?: boolean;
}): Promise<YutoriListResponse> {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.pageSize) params.set('page_size', String(opts.pageSize));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.includeAllSources) params.set('include_all_sources', 'true');

  const qs = params.toString();
  const url = `${YUTORI_BASE_URL}/v1/scouting/tasks${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Yutori listScouts failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getScout(scoutId: string): Promise<YutoriScout> {
  const url = `${YUTORI_BASE_URL}/v1/scouting/tasks/${encodeURIComponent(scoutId)}`;
  const res = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Yutori getScout failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getScoutUpdates(
  scoutId: string,
  opts?: { pageSize?: number; cursor?: string },
): Promise<YutoriUpdatesResponse> {
  const params = new URLSearchParams();
  if (opts?.pageSize) params.set('page_size', String(opts.pageSize));
  if (opts?.cursor) params.set('cursor', opts.cursor);

  const qs = params.toString();
  const url = `${YUTORI_BASE_URL}/v1/scouting/tasks/${encodeURIComponent(scoutId)}/updates${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Yutori getScoutUpdates failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function createScout(opts: {
  query: string;
  outputInterval?: number;
  isPublic?: boolean;
  userTimezone?: string;
  webhookUrl?: string;
}): Promise<YutoriScout> {
  const body: Record<string, unknown> = { query: opts.query };
  if (opts.outputInterval !== undefined) body.output_interval = opts.outputInterval;
  if (opts.isPublic !== undefined) body.is_public = opts.isPublic;
  if (opts.userTimezone) body.user_timezone = opts.userTimezone;
  if (opts.webhookUrl) body.webhook_url = opts.webhookUrl;

  const res = await fetch(`${YUTORI_BASE_URL}/v1/scouting/tasks`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Yutori createScout failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deleteScout(scoutId: string): Promise<void> {
  const url = `${YUTORI_BASE_URL}/v1/scouting/tasks/${encodeURIComponent(scoutId)}`;
  const res = await fetch(url, { method: 'DELETE', headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Yutori deleteScout failed (${res.status}): ${text}`);
  }
}
