import { NextRequest, NextResponse } from 'next/server';
import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';
import { createSolanaRpc } from '@solana/kit';
import {
  getAgentStatePda,
  getAgentWalletPda,
  fetchAgentState,
  fetchAgentWalletBalance,
} from '@agents-haus/sdk';
import { lamportsToSol, STRATEGY_LABELS, type Strategy } from '@agents-haus/common';

let rpc: Rpc<SolanaRpcApi> | null = null;
function getRpc(): Rpc<SolanaRpcApi> {
  if (!rpc) {
    rpc = createSolanaRpc(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!);
  }
  return rpc;
}

function sanitizeMetadataImage(rawImage: string | null): string | null {
  if (!rawImage) return null;
  const candidate = rawImage.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ipfs:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const soulMint = id as Address;
    const connection = getRpc();

    const [agentStateAddr] = await getAgentStatePda(soulMint);
    const [agentWallet] = await getAgentWalletPda(soulMint);

    const agentState = await fetchAgentState(connection, agentStateAddr);
    if (!agentState) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 },
      );
    }

    const balance = await fetchAgentWalletBalance(connection, agentWallet);
    const strategyLabel =
      STRATEGY_LABELS[agentState.strategy as Strategy] ||
      `Unknown(${agentState.strategy})`;
    const imageUrl = sanitizeMetadataImage(
      new URL(request.url).searchParams.get('image'),
    );

    return NextResponse.json({
      name: `Agent ${id.slice(0, 8)}`,
      symbol: 'SOUL',
      description: 'Autonomous AI agent Soul NFT from agents.haus.',
      image: imageUrl,
      external_url: `https://agents.haus/agent/${id}`,
      attributes: [
        { trait_type: 'Soul Mint', value: id },
        { trait_type: 'Strategy', value: strategyLabel },
        { trait_type: 'Active', value: agentState.isActive ? 'true' : 'false' },
      ],
      properties: {
        category: 'image',
        files: imageUrl
          ? [{ uri: imageUrl, type: 'image' }]
          : [],
      },
      soulMint: id,
      owner: agentState.owner,
      executor: agentState.executor,
      isActive: agentState.isActive,
      strategy: agentState.strategy,
      strategyLabel,
      personalityHash: agentState.personalityHash,
      agentVersion: agentState.agentVersion,
      walletAddress: agentWallet,
      walletBalance: lamportsToSol(balance).toFixed(4),
      stats: {
        totalTips: agentState.totalTips.toString(),
        totalBurns: agentState.totalBurns.toString(),
        totalSolSpent: lamportsToSol(agentState.totalSolSpent).toFixed(4),
        totalTokensBurned: (Number(agentState.totalTokensBurned) / 1_000_000).toString(),
        totalRewards: lamportsToSol(agentState.totalRewards).toFixed(4),
        epochsWonAlpha: agentState.epochsWonAlpha.toString(),
        epochsWonBurner: agentState.epochsWonBurner.toString(),
      },
      lastActivity: Number(agentState.lastActivity),
      createdAt: Number(agentState.createdAt),
    });
  } catch (err) {
    console.error('Failed to fetch agent:', err);
    return NextResponse.json(
      { error: 'Failed to fetch agent data' },
      { status: 500 },
    );
  }
}
