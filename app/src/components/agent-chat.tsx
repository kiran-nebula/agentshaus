'use client';

import { useState, useRef, useEffect } from 'react';
import { DEFAULT_LLM_MODELS } from '@agents-haus/common';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AgentChatProps {
  soulMint: string;
  isRunning: boolean;
}

const MAX_CHAT_MESSAGES = 120;

function clampChatMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_CHAT_MESSAGES) return messages;
  return messages.slice(-MAX_CHAT_MESSAGES);
}

export function AgentChat({ soulMint, isRunning }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_LLM_MODELS[0].id);
  const [modelOpen, setModelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close model dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const currentModel = DEFAULT_LLM_MODELS.find((m) => m.id === selectedModel) || DEFAULT_LLM_MODELS[0];

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    const history = clampChatMessages(messages);
    setInput('');
    setError(null);

    const newMessages: Message[] = clampChatMessages([
      ...history,
      { role: 'user', content: userMessage },
    ]);
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch(`/api/agent/${soulMint}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history,
          model: selectedModel,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to get response');
        return;
      }

      setMessages(
        clampChatMessages([
          ...newMessages,
          { role: 'assistant', content: data.response },
        ]),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  if (!isRunning) {
    return (
      <div className="rounded-2xl border border-border bg-surface-raised p-5">
        <h3 className="text-sm font-semibold text-ink mb-2">Chat</h3>
        <p className="text-xs text-ink-muted">
          Start the agent runtime to chat with your agent.
        </p>
      </div>
    );
  }

  // No messages yet — show Mogra-style centered prompt
  if (messages.length === 0 && !loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface-raised flex flex-col items-center justify-center px-6" style={{ minHeight: '520px' }}>
        <h2 className="text-lg font-semibold text-ink mb-8">
          What should your agent do?
        </h2>

        {/* Mogra-style input */}
        <div className="w-full max-w-lg">
          <div className="rounded-2xl border border-border bg-surface-raised shadow-sm">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask anything..."
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
            />

            {/* Bottom bar: model selector + actions */}
            <div className="flex items-center justify-between px-3 pb-3">
              {/* Model selector */}
              <div className="relative" ref={modelRef}>
                <button
                  type="button"
                  onClick={() => setModelOpen(!modelOpen)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border-light px-3 py-1 text-xs text-ink-secondary hover:bg-surface-overlay transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  {currentModel.name}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-ink-muted">
                    <path d="M2.5 4L5 6.5L7.5 4" />
                  </svg>
                </button>

                {modelOpen && (
                  <div className="absolute bottom-full left-0 mb-1 w-56 rounded-xl border border-border bg-surface-raised shadow-lg py-1 z-50">
                    {DEFAULT_LLM_MODELS.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          setSelectedModel(model.id);
                          setModelOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-xs transition-colors ${
                          model.id === selectedModel
                            ? 'bg-surface-overlay text-ink font-medium'
                            : 'text-ink-secondary hover:bg-surface-overlay/50'
                        }`}
                      >
                        <span>{model.name}</span>
                        <span className="text-[10px] text-ink-muted">{model.provider}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Send button */}
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim()}
                className="rounded-full p-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors disabled:opacity-30"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 text-xs text-danger bg-danger/5 rounded-xl px-3 py-2">
            {error}
          </div>
        )}
      </div>
    );
  }

  // Conversation view — messages + input at bottom
  return (
    <div className="rounded-2xl border border-border bg-surface-raised flex flex-col" style={{ height: '520px' }}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-ink text-surface rounded-br-md'
                  : 'bg-surface-inset text-ink rounded-bl-md'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-inset rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-ink-muted">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="text-center text-xs text-danger bg-danger/5 rounded-xl px-3 py-2">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-border-light px-3 py-3">
        <div className="rounded-xl border border-border bg-surface">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Message your agent..."
            disabled={loading}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-50"
          />

          <div className="flex items-center justify-between px-3 pb-2">
            {/* Model selector */}
            <div className="relative" ref={modelRef}>
              <button
                type="button"
                onClick={() => setModelOpen(!modelOpen)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-light px-2.5 py-0.5 text-[11px] text-ink-secondary hover:bg-surface-overlay transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                {currentModel.name}
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-ink-muted">
                  <path d="M2.5 4L5 6.5L7.5 4" />
                </svg>
              </button>

              {modelOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-52 rounded-xl border border-border bg-surface-raised shadow-lg py-1 z-50">
                  {DEFAULT_LLM_MODELS.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        setSelectedModel(model.id);
                        setModelOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-[11px] transition-colors ${
                        model.id === selectedModel
                          ? 'bg-surface-overlay text-ink font-medium'
                          : 'text-ink-secondary hover:bg-surface-overlay/50'
                      }`}
                    >
                      <span>{model.name}</span>
                      <span className="text-[10px] text-ink-muted">{model.provider}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Send */}
            <button
              type="button"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="rounded-full p-1 text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors disabled:opacity-30"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
