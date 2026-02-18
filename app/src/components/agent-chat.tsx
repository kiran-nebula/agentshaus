'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AgentChatProps {
  soulMint: string;
  isRunning: boolean;
}

export function AgentChat({ soulMint, isRunning }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setError(null);

    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch(`/api/agent/${soulMint}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: messages,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to get response');
        return;
      }

      setMessages([...newMessages, { role: 'assistant', content: data.response }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  if (!isRunning) {
    return (
      <div className="rounded-2xl border border-border bg-surface-raised p-6">
        <h3 className="text-base font-semibold text-ink mb-3">Chat</h3>
        <p className="text-sm text-ink-muted">
          Start the agent runtime to chat with your agent.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-raised flex flex-col" style={{ height: '500px' }}>
      <div className="px-6 py-4 border-b border-border-light">
        <h3 className="text-base font-semibold text-ink">Chat</h3>
        <p className="text-xs text-ink-muted mt-0.5">Talk to your agent via OpenClaw</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-sm text-ink-muted py-12">
            Send a message to start chatting with your agent.
          </div>
        )}

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

      {/* Input */}
      <div className="px-4 py-3 border-t border-border-light">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Message your agent..."
            disabled={loading}
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none transition-colors disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-surface hover:bg-ink/90 transition-colors disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
