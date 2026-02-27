import { NextRequest, NextResponse } from 'next/server';
import { createKeyPairFromBytes, getAddressFromPublicKey } from '@solana/kit';
import {
  getBearerTokenFromAuthorizationHeader,
  verifyPrivyAccessToken,
} from '@/lib/privy-auth';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value: string): Uint8Array {
  let num = BigInt(0);
  for (const char of value) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('executor keypair contains invalid base58 characters');
    }
    num = num * BigInt(58) + BigInt(idx);
  }

  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.push(Number(num % BigInt(256)));
    num /= BigInt(256);
  }
  bytes.reverse();

  let leadingZeros = 0;
  for (const char of value) {
    if (char === '1') {
      leadingZeros += 1;
    } else {
      break;
    }
  }

  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

function getSharedExecutorKeypair(): string {
  const raw = (
    process.env.RUNTIME_EXECUTOR_KEYPAIR ||
    process.env.EXECUTOR_KEYPAIR ||
    ''
  ).trim();

  if (!raw) {
    throw new Error('RUNTIME_EXECUTOR_KEYPAIR is not configured');
  }

  return raw;
}

async function deriveExecutorAddress(executorKeypair: string): Promise<string> {
  const trimmed = executorKeypair.trim();
  const bytes = trimmed.startsWith('[')
    ? new Uint8Array(JSON.parse(trimmed))
    : decodeBase58(trimmed);
  const keypair = await createKeyPairFromBytes(bytes);
  const address = await getAddressFromPublicKey(keypair.publicKey);
  return address as string;
}

/**
 * GET /api/runtime/executor
 * Returns the server-managed shared runtime executor public key.
 */
export async function GET(request: NextRequest) {
  try {
    const bearer = getBearerTokenFromAuthorizationHeader(
      request.headers.get('authorization'),
    );
    if (!bearer) {
      return NextResponse.json(
        { error: 'Unauthorized', authHint: 'missing-bearer-token' },
        { status: 401 },
      );
    }
    try {
      await verifyPrivyAccessToken(bearer);
    } catch {
      return NextResponse.json(
        { error: 'Unauthorized', authHint: 'invalid-bearer-token' },
        { status: 401 },
      );
    }

    const keypair = getSharedExecutorKeypair();
    const runtimeExecutor = await deriveExecutorAddress(keypair);
    return NextResponse.json({ runtimeExecutor });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load runtime executor' },
      { status: 500 },
    );
  }
}
