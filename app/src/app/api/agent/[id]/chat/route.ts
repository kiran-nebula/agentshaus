import { NextRequest, NextResponse } from 'next/server';
import { getFlyClient } from '@/lib/fly-machines';

/**
 * POST /api/agent/[id]/chat
 * Proxy chat messages to the agent's OpenClaw gateway running on Fly.
 *
 * Body: { message: string, history?: { role: string; content: string }[] }
 *
 * The OpenClaw gateway runs on port 3001 inside the Fly machine.
 * The machine has a services config that exposes 3001 via the app's .fly.dev domain.
 * We use the `fly-force-instance-id` header to route to the specific machine.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: soulMint } = await params;
    const body = await request.json();
    const { message, history, model } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Find the machine for this agent
    const fly = getFlyClient();
    const machine = await fly.findMachineForAgent(soulMint);

    if (!machine) {
      return NextResponse.json({ error: 'Agent runtime not deployed' }, { status: 404 });
    }

    if (machine.state !== 'started') {
      return NextResponse.json(
        { error: `Agent runtime is ${machine.state}, not running` },
        { status: 503 },
      );
    }

    // Build messages array for OpenClaw chat completions endpoint
    const messages = [...(history || []), { role: 'user', content: message }];

    // Route to the specific machine via Fly's Anycast proxy + fly-force-instance-id header.
    // The machine's services config exposes internal_port 3001 on external port 443.
    const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
    const chatUrl = `https://${appName}.fly.dev/v1/chat/completions`;

    const chatResponse = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'fly-force-instance-id': machine.id,
      },
      body: JSON.stringify({
        messages,
        model: model || 'default',
        stream: false,
      }),
    });

    if (!chatResponse.ok) {
      const errText = await chatResponse.text();
      console.error('OpenClaw chat error:', chatResponse.status, errText);
      return NextResponse.json(
        { error: 'Failed to reach agent runtime', details: errText },
        { status: 502 },
      );
    }

    const data = await chatResponse.json();
    const assistantMessage =
      data.choices?.[0]?.message?.content || data.response || 'No response';

    return NextResponse.json({ response: assistantMessage });
  } catch (err) {
    console.error('Chat proxy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Chat failed' },
      { status: 500 },
    );
  }
}
