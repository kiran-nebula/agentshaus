const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const TELEGRAM_MESSAGE_LIMIT = 3900;

type TelegramChat = {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
};

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

type GatewayChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type GatewayCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

export interface TelegramBridgeConfig {
  enabled: boolean;
  botToken: string;
  gatewayPort: number;
  model: string | null;
  allowedChatIds: string[];
  pollTimeoutSeconds: number;
  retryDelayMs: number;
  maxHistoryMessages: number;
  maxChats: number;
  dropPendingOnStart: boolean;
}

export interface TelegramBridgeSnapshot {
  enabled: boolean;
  configured: boolean;
  active: boolean;
  model: string | null;
  allowedChatIds: string[];
  lastPollAt: string | null;
  lastMessageAt: string | null;
  lastUpdateId: number | null;
  lastError: string | null;
  messagesHandled: number;
  chatsTracked: number;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(key);
  }
  return deduped;
}

function normalizeChatId(chatId: number | string): string {
  return String(chatId).trim();
}

function truncate(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function splitTelegramMessage(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return ['(empty response)'];
  if (normalized.length <= TELEGRAM_MESSAGE_LIMIT) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    let splitAt = remaining.lastIndexOf('\n', TELEGRAM_MESSAGE_LIMIT);
    if (splitAt < TELEGRAM_MESSAGE_LIMIT * 0.5) {
      splitAt = remaining.lastIndexOf(' ', TELEGRAM_MESSAGE_LIMIT);
    }
    if (splitAt < TELEGRAM_MESSAGE_LIMIT * 0.5) {
      splitAt = TELEGRAM_MESSAGE_LIMIT;
    }
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.length > 0 ? chunks : ['(empty response)'];
}

export function loadTelegramBridgeConfigFromEnv(): TelegramBridgeConfig {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const enabled = parseBoolean(process.env.TELEGRAM_ENABLED) ?? Boolean(botToken);
  const allowedChatIds = dedupe([
    ...parseCsv(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    ...parseCsv(process.env.TELEGRAM_CHAT_ID),
  ]);
  const model = (process.env.TELEGRAM_MODEL || '').trim() || null;
  const gatewayPort = clampInteger(parseInteger(process.env.PORT) ?? 3001, 1, 65535);
  const pollTimeoutSeconds = clampInteger(
    parseInteger(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS) ?? 25,
    1,
    50,
  );
  const retryDelayMs = clampInteger(
    parseInteger(process.env.TELEGRAM_RETRY_DELAY_MS) ?? 1500,
    250,
    30000,
  );
  const maxHistoryMessages = clampInteger(
    parseInteger(process.env.TELEGRAM_MAX_HISTORY_MESSAGES) ?? 24,
    4,
    80,
  );
  const maxChats = clampInteger(
    parseInteger(process.env.TELEGRAM_MAX_CHATS) ?? 40,
    1,
    200,
  );
  const dropPendingOnStart =
    parseBoolean(process.env.TELEGRAM_DROP_PENDING_ON_START) ?? true;

  return {
    enabled,
    botToken,
    gatewayPort,
    model,
    allowedChatIds,
    pollTimeoutSeconds,
    retryDelayMs,
    maxHistoryMessages,
    maxChats,
    dropPendingOnStart,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramBridge {
  private stopped = false;
  private active = false;
  private loopPromise: Promise<void> | null = null;
  private pollAbortController: AbortController | null = null;
  private nextOffset: number | null = null;
  private readonly historyByChat = new Map<string, GatewayChatMessage[]>();
  private readonly snapshotState: TelegramBridgeSnapshot;

  constructor(private readonly config: TelegramBridgeConfig) {
    this.snapshotState = {
      enabled: config.enabled,
      configured: Boolean(config.botToken),
      active: false,
      model: config.model,
      allowedChatIds: [...config.allowedChatIds],
      lastPollAt: null,
      lastMessageAt: null,
      lastUpdateId: null,
      lastError: null,
      messagesHandled: 0,
      chatsTracked: 0,
    };
  }

  private get apiBaseUrl(): string {
    return `https://api.telegram.org/bot${this.config.botToken}`;
  }

  private get gatewayUrl(): string {
    return `http://127.0.0.1:${this.config.gatewayPort}/v1/chat/completions`;
  }

  start(): void {
    if (!this.config.enabled) {
      console.log('[telegram] disabled by config');
      this.snapshotState.active = false;
      return;
    }

    if (!this.config.botToken) {
      console.log('[telegram] disabled: TELEGRAM_BOT_TOKEN is not configured');
      this.snapshotState.active = false;
      return;
    }

    if (this.active) return;
    this.active = true;
    this.stopped = false;
    this.snapshotState.active = true;
    this.snapshotState.lastError = null;

    console.log(
      `[telegram] enabled chats=${this.config.allowedChatIds.length || 'all'} model=${
        this.config.model || '(runtime default)'
      }`,
    );

    this.loopPromise = this.runLoop();
  }

  stop(): void {
    this.stopped = true;
    this.active = false;
    this.snapshotState.active = false;
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  getSnapshot(): TelegramBridgeSnapshot {
    return {
      ...this.snapshotState,
      chatsTracked: this.historyByChat.size,
    };
  }

  private isChatAllowed(chatId: string): boolean {
    if (this.config.allowedChatIds.length === 0) return true;
    return this.config.allowedChatIds.includes(chatId);
  }

  private recordHistory(chatId: string, messages: GatewayChatMessage[]): void {
    const bounded = messages.slice(-this.config.maxHistoryMessages);

    if (this.historyByChat.has(chatId)) {
      this.historyByChat.delete(chatId);
    } else if (this.historyByChat.size >= this.config.maxChats) {
      const oldestKey = this.historyByChat.keys().next().value;
      if (typeof oldestKey === 'string') {
        this.historyByChat.delete(oldestKey);
      }
    }

    this.historyByChat.set(chatId, bounded);
    this.snapshotState.chatsTracked = this.historyByChat.size;
  }

  private clearHistory(chatId: string): void {
    this.historyByChat.delete(chatId);
    this.snapshotState.chatsTracked = this.historyByChat.size;
  }

  private parseStartHelpCommand(text: string): boolean {
    return /^\/(?:start|help)(?:@\w+)?\b/i.test(text.trim());
  }

  private parseStatusCommand(text: string): boolean {
    return /^\/status(?:@\w+)?\b/i.test(text.trim());
  }

  private parseResetCommand(text: string): boolean {
    return /^\/reset(?:@\w+)?\b/i.test(text.trim());
  }

  private formatHelpText(): string {
    const chatScope =
      this.config.allowedChatIds.length > 0
        ? `Restricted chat IDs: ${this.config.allowedChatIds.join(', ')}`
        : 'Chat restrictions: none (all chats allowed)';
    return [
      'agents.haus Telegram bridge is online.',
      '',
      'Send any message to chat with this agent.',
      '',
      'Commands:',
      '/help - show this message',
      '/status - show bridge status',
      '/reset - clear chat memory for this Telegram chat',
      '',
      chatScope,
    ].join('\n');
  }

  private formatStatusText(): string {
    return [
      'Telegram bridge status:',
      `- Active: ${this.snapshotState.active ? 'yes' : 'no'}`,
      `- Last poll: ${this.snapshotState.lastPollAt || 'never'}`,
      `- Last update id: ${
        this.snapshotState.lastUpdateId !== null
          ? String(this.snapshotState.lastUpdateId)
          : 'none'
      }`,
      `- Messages handled: ${this.snapshotState.messagesHandled}`,
      `- Tracked chats: ${this.historyByChat.size}`,
      `- Model: ${this.config.model || '(runtime default)'}`,
      `- Last error: ${this.snapshotState.lastError || 'none'}`,
    ].join('\n');
  }

  private async parseEnvelope<T>(
    response: Response,
    context: string,
  ): Promise<TelegramApiEnvelope<T>> {
    const raw = await response.text();
    let payload: TelegramApiEnvelope<T> | null = null;
    try {
      payload = JSON.parse(raw) as TelegramApiEnvelope<T>;
    } catch {
      throw new Error(`${context}: invalid JSON response (${truncate(raw, 220)})`);
    }

    if (!response.ok || !payload.ok) {
      const description =
        (payload.description || '').trim() ||
        `HTTP ${response.status}`;
      throw new Error(`${context}: ${description}`);
    }

    return payload;
  }

  private async getUpdates(
    offset: number | null,
    timeoutSeconds: number,
    limit = 100,
  ): Promise<TelegramUpdate[]> {
    const query = new URLSearchParams();
    if (offset !== null) {
      query.set('offset', String(offset));
    }
    query.set('timeout', String(timeoutSeconds));
    query.set('limit', String(clampInteger(limit, 1, 100)));
    query.set('allowed_updates', JSON.stringify(['message']));

    const controller = new AbortController();
    this.pollAbortController = controller;
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/getUpdates?${query.toString()}`,
        {
          method: 'GET',
          signal: controller.signal,
        },
      );
      const payload = await this.parseEnvelope<TelegramUpdate[]>(
        response,
        'getUpdates',
      );
      return Array.isArray(payload.result) ? payload.result : [];
    } finally {
      if (this.pollAbortController === controller) {
        this.pollAbortController = null;
      }
    }
  }

  private async sendMessage(
    chatId: string,
    text: string,
    replyToMessageId?: number,
  ): Promise<void> {
    const chunks = splitTelegramMessage(text);
    for (let index = 0; index < chunks.length; index += 1) {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: chunks[index],
        disable_web_page_preview: true,
      };
      if (index === 0 && typeof replyToMessageId === 'number') {
        body.reply_to_message_id = replyToMessageId;
      }

      const response = await fetch(`${this.apiBaseUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      await this.parseEnvelope<Record<string, unknown>>(
        response,
        'sendMessage',
      );
    }
  }

  private async sendToRuntime(chatId: string, userText: string): Promise<string> {
    const existing = this.historyByChat.get(chatId) || [];
    const history = existing.slice(-this.config.maxHistoryMessages);
    const nextMessages: GatewayChatMessage[] = [
      ...history,
      { role: 'user', content: userText },
    ];

    const payload: Record<string, unknown> = {
      messages: nextMessages,
    };
    if (this.config.model) {
      payload.model = this.config.model;
    }

    const response = await fetch(this.gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`runtime chat ${response.status}: ${truncate(errText, 220)}`);
    }

    const parsed = (await response.json()) as GatewayCompletionResponse;
    const assistantReply =
      parsed.choices?.[0]?.message?.content?.trim() || 'No response.';
    this.recordHistory(chatId, [
      ...nextMessages,
      { role: 'assistant', content: assistantReply },
    ]);
    return assistantReply;
  }

  private async discardPendingUpdates(): Promise<void> {
    if (!this.config.dropPendingOnStart) return;

    let drained = 0;
    for (let iteration = 0; iteration < 20 && !this.stopped; iteration += 1) {
      const updates = await this.getUpdates(this.nextOffset, 0, 100);
      if (updates.length === 0) break;
      drained += updates.length;
      const lastUpdate = updates[updates.length - 1];
      this.nextOffset = lastUpdate.update_id + 1;
      this.snapshotState.lastUpdateId = lastUpdate.update_id;
      if (updates.length < 100) break;
    }

    if (drained > 0) {
      console.log(`[telegram] dropped ${drained} pending update(s) on startup`);
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message || typeof message.text !== 'string') return;
    if (message.from?.is_bot) return;

    const chatId = normalizeChatId(message.chat.id);
    const text = message.text.trim();
    if (!text) return;

    if (!this.isChatAllowed(chatId)) {
      await this.sendMessage(
        chatId,
        'This bot is not enabled for this chat. Ask the agent owner to allow this chat ID.',
      );
      return;
    }

    if (this.parseStartHelpCommand(text)) {
      await this.sendMessage(chatId, this.formatHelpText(), message.message_id);
      return;
    }

    if (this.parseStatusCommand(text)) {
      await this.sendMessage(chatId, this.formatStatusText(), message.message_id);
      return;
    }

    if (this.parseResetCommand(text)) {
      this.clearHistory(chatId);
      await this.sendMessage(
        chatId,
        'Conversation memory cleared for this chat.',
        message.message_id,
      );
      return;
    }

    const reply = await this.sendToRuntime(chatId, text);
    await this.sendMessage(chatId, reply, message.message_id);
    this.snapshotState.messagesHandled += 1;
    this.snapshotState.lastMessageAt = new Date().toISOString();
  }

  private async runLoop(): Promise<void> {
    try {
      await this.discardPendingUpdates();

      while (!this.stopped) {
        try {
          const updates = await this.getUpdates(
            this.nextOffset,
            this.config.pollTimeoutSeconds,
          );
          this.snapshotState.lastPollAt = new Date().toISOString();
          this.snapshotState.lastError = null;

          for (const update of updates) {
            if (this.stopped) break;
            this.nextOffset = update.update_id + 1;
            this.snapshotState.lastUpdateId = update.update_id;
            await this.handleUpdate(update);
          }
        } catch (err) {
          if (this.stopped) break;
          this.snapshotState.lastError =
            err instanceof Error ? err.message : String(err);
          console.error('[telegram] polling error:', err);
          await sleep(this.config.retryDelayMs);
        }
      }
    } finally {
      this.active = false;
      this.snapshotState.active = false;
    }
  }
}
