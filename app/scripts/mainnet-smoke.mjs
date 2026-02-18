import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  createSolanaRpc,
  getAddressDecoder,
  getAddressEncoder,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  createKeyPairFromBytes,
  generateKeyPair,
} from '@solana/kit';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const COMMITMENT = 'confirmed';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PROGRAM_ID = 'BWFsJXqoXKg53yu3VxYV9YgmvTc9BZxto4CGJqYn8aWM';
const ALPHA_HAUS_PROGRAM_ID = 'A1PhATY12DpvpHGfGosxuruc7gqkcUUt9eFihb996rNn';
const MPL_CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const AGENT_WALLET_SEED = new TextEncoder().encode('agent_wallet');
const AGENT_STATE_SEED = new TextEncoder().encode('agent_state');
const WAS_ALPHA_TIPPER_SEED = new TextEncoder().encode('was_alpha_tipper');
const WAS_TOP_BURNER_SEED = new TextEncoder().encode('was_top_burner');
const EPOCH_STATUS_DISCRIMINATOR = new Uint8Array([53, 208, 49, 235, 139, 1, 230, 180]);
const AGENT_STATE_DISCRIMINATOR = new Uint8Array([254, 187, 98, 119, 228, 48, 47, 49]);

class BorshWriter {
  constructor() {
    this.data = [];
  }

  bytes(value) {
    this.data.push(...value);
    return this;
  }

  u8(value) {
    this.data.push(value & 0xff);
    return this;
  }

  u32(value) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, value, true);
    this.data.push(...new Uint8Array(buf));
    return this;
  }

  u64(value) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, value, true);
    this.data.push(...new Uint8Array(buf));
    return this;
  }

  bool(value) {
    this.data.push(value ? 1 : 0);
    return this;
  }

  string(value) {
    const encoded = new TextEncoder().encode(value);
    this.u32(encoded.length);
    this.data.push(...encoded);
    return this;
  }

  option(value, writer) {
    if (value != null) {
      this.u8(1);
      writer(value);
    } else {
      this.u8(0);
    }
    return this;
  }

  toBuffer() {
    return new Uint8Array(this.data);
  }
}

async function getAgentWalletPda(soulMint) {
  const encoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [AGENT_WALLET_SEED, encoder.encode(soulMint)],
  });
}

async function getAgentStatePda(soulMint) {
  const encoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [AGENT_STATE_SEED, encoder.encode(soulMint)],
  });
}

function createCreateAgentInstruction(accounts, args) {
  const data = new BorshWriter()
    .bytes(new Uint8Array([143, 66, 198, 95, 110, 85, 83, 249]))
    .string(args.name)
    .string(args.uri)
    .string(args.personalityHash)
    .u8(args.strategy)
    .toBuffer();

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: accounts.owner, role: 3 }, // writable + signer
      { address: accounts.soulAsset, role: 3 }, // writable + signer
      { address: accounts.agentState, role: 1 }, // writable
      { address: accounts.agentWallet, role: 0 }, // readonly
      { address: accounts.executor, role: 0 }, // readonly
      { address: accounts.systemProgram, role: 0 }, // readonly
      { address: accounts.mplCoreProgram, role: 0 }, // readonly
    ],
    data,
  };
}

function createUpdateAgentConfigInstruction(accounts, args) {
  const writer = new BorshWriter().bytes(new Uint8Array([232, 239, 83, 133, 24, 49, 84, 76]));
  writer.option(args.strategy, (v) => writer.u8(v));
  writer.option(args.personalityHash, (v) => writer.string(v));
  writer.option(args.isActive, (v) => writer.bool(v));

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: accounts.owner, role: 2 }, // signer
      { address: accounts.soulAsset, role: 0 }, // readonly
      { address: accounts.agentState, role: 1 }, // writable
    ],
    data: writer.toBuffer(),
  };
}

function createWithdrawFromAgentInstruction(accounts, amount) {
  const data = new BorshWriter()
    .bytes(new Uint8Array([94, 101, 208, 182, 65, 136, 59, 171]))
    .u64(amount)
    .toBuffer();

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: accounts.owner, role: 3 }, // writable + signer
      { address: accounts.soulAsset, role: 0 }, // readonly
      { address: accounts.agentState, role: 1 }, // writable
      { address: accounts.agentWallet, role: 1 }, // writable
      { address: accounts.systemProgram, role: 0 }, // readonly
    ],
    data,
  };
}

function createClaimRewardsInstruction(accounts, epoch) {
  const data = new BorshWriter()
    .bytes(new Uint8Array([4, 144, 132, 71, 116, 23, 151, 80]))
    .u64(epoch)
    .toBuffer();

  return {
    programAddress: PROGRAM_ID,
    accounts: [
      { address: accounts.caller, role: 3 }, // writable + signer
      { address: accounts.soulAsset, role: 0 }, // readonly
      { address: accounts.agentState, role: 1 }, // writable
      { address: accounts.agentWallet, role: 1 }, // writable
      { address: accounts.epochStatus, role: 1 }, // writable
      { address: accounts.wasAlphaTipper, role: 1 }, // writable
      { address: accounts.wasTopBurner, role: 1 }, // writable
      { address: accounts.alphaHausProgram, role: 0 }, // readonly
      { address: accounts.systemProgram, role: 0 }, // readonly
    ],
    data,
  };
}

function decodeBase64AccountData(data) {
  if (typeof data === 'string') {
    return new Uint8Array(Buffer.from(data, 'base64'));
  }
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.from(data[0], 'base64'));
  }
  return data;
}

function decodeEpochStatus(data) {
  for (let i = 0; i < 8; i++) {
    if (data[i] !== EPOCH_STATUS_DISCRIMINATOR[i]) return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = getAddressDecoder();
  let offset = 8;

  const epoch = view.getBigUint64(offset, true);
  offset += 8;

  const hasAlpha = view.getUint8(offset) === 1;
  offset += 1;
  let topAlpha = null;
  if (hasAlpha) {
    topAlpha = decoder.decode(data.slice(offset, offset + 32));
  }
  offset += 32;

  const topAlphaAmount = view.getBigUint64(offset, true);
  offset += 8;

  const hasBurner = view.getUint8(offset) === 1;
  offset += 1;
  let topBurner = null;
  if (hasBurner) {
    topBurner = decoder.decode(data.slice(offset, offset + 32));
  }
  offset += 32;

  const topBurnAmount = view.getBigUint64(offset, true);
  return { epoch, topAlpha, topAlphaAmount, topBurner, topBurnAmount };
}

async function findCurrentEpochStatus(rpc) {
  const accounts = await rpc
    .getProgramAccounts(ALPHA_HAUS_PROGRAM_ID, {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: Buffer.from(EPOCH_STATUS_DISCRIMINATOR).toString('base64'),
            encoding: 'base64',
          },
        },
      ],
    })
    .send();

  if (!accounts?.length) return null;

  let latest = null;
  for (const entry of accounts) {
    const status = decodeEpochStatus(decodeBase64AccountData(entry.account.data));
    if (status && (!latest || status.epoch > latest.status.epoch)) {
      latest = { address: entry.pubkey, status };
    }
  }

  return latest;
}

async function fetchAgentState(rpc, agentStateAddress) {
  const response = await rpc
    .getAccountInfo(agentStateAddress, { encoding: 'base64' })
    .send();

  if (!response.value?.data) return null;
  const data = decodeBase64AccountData(response.value.data);

  for (let i = 0; i < 8; i++) {
    if (data[i] !== AGENT_STATE_DISCRIMINATOR[i]) return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = getAddressDecoder();
  let offset = 8;

  const readPubkey = () => {
    const addr = decoder.decode(data.slice(offset, offset + 32));
    offset += 32;
    return addr;
  };
  const readU8 = () => {
    const value = view.getUint8(offset);
    offset += 1;
    return value;
  };
  const readU16 = () => {
    const value = view.getUint16(offset, true);
    offset += 2;
    return value;
  };
  const readU64 = () => {
    const value = view.getBigUint64(offset, true);
    offset += 8;
    return value;
  };
  const readI64 = () => {
    const value = view.getBigInt64(offset, true);
    offset += 8;
    return value;
  };
  const readBool = () => readU8() !== 0;
  const readString = () => {
    const len = view.getUint32(offset, true);
    offset += 4;
    const value = new TextDecoder().decode(data.slice(offset, offset + len));
    offset += len;
    return value;
  };

  return {
    soulMint: readPubkey(),
    owner: readPubkey(),
    executor: readPubkey(),
    walletBump: readU8(),
    stateBump: readU8(),
    isActive: readBool(),
    strategy: readU8(),
    personalityHash: readString(),
    agentVersion: readU16(),
    totalTips: readU64(),
    totalBurns: readU64(),
    totalSolSpent: readU64(),
    totalTokensBurned: readU64(),
    totalRewards: readU64(),
    epochsWonAlpha: readU64(),
    epochsWonBurner: readU64(),
    lastActivity: readI64(),
    createdAt: readI64(),
  };
}

function assertEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function decodeBase58(value) {
  let num = 0n;
  for (const char of value) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid base58 string: ${value.slice(0, 6)}...`);
    }
    num = num * 58n + BigInt(idx);
  }

  const bytes = [];
  while (num > 0n) {
    bytes.push(Number(num % 256n));
    num /= 256n;
  }
  bytes.reverse();

  let leadingZeros = 0;
  for (const char of value) {
    if (char === '1') leadingZeros += 1;
    else break;
  }

  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

function parseSecretBytes(raw) {
  if (raw.startsWith('[')) {
    return new Uint8Array(JSON.parse(raw));
  }
  return decodeBase58(raw);
}

async function parseKeypairFromEnv(name) {
  const raw = assertEnv(name);
  const bytes = parseSecretBytes(raw);
  return createKeyPairFromBytes(bytes);
}

function toLeU64Bytes(value) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, value, true);
  return buf;
}

function stringifyError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const cause = err.cause ? ` | cause: ${stringifyError(err.cause)}` : '';
    return `${err.name}: ${err.message}${cause}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function sendTransaction({
  rpc,
  feePayer,
  signers,
  instructions,
}) {
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: COMMITMENT })
    .send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(feePayer, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(instructions, msg),
  );

  const compiled = compileTransaction(message);
  const signed = await signTransaction(signers, compiled);
  const encoded = getBase64EncodedWireTransaction(signed);
  const signature = await rpc
    .sendTransaction(encoded, {
      encoding: 'base64',
      preflightCommitment: COMMITMENT,
      skipPreflight: false,
    })
    .send();

  return typeof signature === 'string' ? signature : getSignatureFromTransaction(signed);
}

async function waitForConfirmation(rpc, signature, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const statuses = await rpc
      .getSignatureStatuses([signature], { searchTransactionHistory: true })
      .send();
    const status = statuses.value[0];
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      if (status.err) {
        throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(`Timed out waiting for confirmation: ${signature}`);
}

function buildMplCoreTransferInstruction({
  asset,
  payer,
  authority,
  newOwner,
}) {
  // mpl-core transfer_v1 discriminator=14, args: Option<CompressionProof>=None => 0
  const data = new Uint8Array([14, 0]);
  return {
    programAddress: MPL_CORE_PROGRAM_ID,
    accounts: [
      { address: asset, role: 1 }, // writable
      { address: MPL_CORE_PROGRAM_ID, role: 0 }, // collection (none sentinel)
      { address: payer, role: 3 }, // writable + signer
      { address: authority, role: 2 }, // signer
      { address: newOwner, role: 0 }, // readonly
      { address: SYSTEM_PROGRAM, role: 0 }, // readonly
      { address: MPL_CORE_PROGRAM_ID, role: 0 }, // log wrapper (none sentinel)
    ],
    data,
  };
}

async function fetchSoulAssetOwner(rpc, soulAssetAddress) {
  const account = await rpc.getAccountInfo(soulAssetAddress, { encoding: 'base64' }).send();
  if (!account.value?.data) {
    throw new Error(`Soul asset account not found: ${soulAssetAddress}`);
  }
  const raw = account.value.data;
  const data =
    typeof raw === 'string'
      ? new Uint8Array(Buffer.from(raw, 'base64'))
      : new Uint8Array(Buffer.from(raw[0], 'base64'));

  if (data.length < 33) {
    throw new Error(`Invalid soul asset account length: ${data.length}`);
  }
  if (data[0] !== 1) {
    throw new Error(`Soul asset key byte is ${data[0]}, expected AssetV1 (1)`);
  }
  const ownerBytes = data.slice(1, 33);
  return getAddressDecoder().decode(ownerBytes);
}

async function expectSuccess(label, fn) {
  try {
    const value = await fn();
    console.log(`PASS ${label}`);
    return { ok: true, value };
  } catch (err) {
    console.error(`FAIL ${label}`);
    console.error(`  ${stringifyError(err)}`);
    return { ok: false, error: err };
  }
}

async function expectFailure(label, fn, matcher = null) {
  try {
    await fn();
    console.error(`FAIL ${label}`);
    console.error('  Expected failure but transaction succeeded.');
    return { ok: false, error: new Error('Expected failure, got success') };
  } catch (err) {
    const msg = stringifyError(err);
    if (matcher && !matcher.test(msg)) {
      console.error(`FAIL ${label}`);
      console.error(`  Failed as expected but message mismatch: ${msg}`);
      return { ok: false, error: err };
    }
    console.log(`PASS ${label}`);
    return { ok: true, error: err };
  }
}

async function deriveAlphaHausClaimPdas(agentWallet, epoch) {
  const encoder = getAddressEncoder();
  const epochBytes = toLeU64Bytes(epoch);

  const [epochStatus] = await getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [new TextEncoder().encode('epoch_status'), epochBytes],
  });

  const [wasAlphaTipper] = await getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [WAS_ALPHA_TIPPER_SEED, encoder.encode(agentWallet), epochBytes],
  });

  const [wasTopBurner] = await getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [WAS_TOP_BURNER_SEED, encoder.encode(agentWallet), epochBytes],
  });

  return { epochStatus, wasAlphaTipper, wasTopBurner };
}

async function main() {
  const rpcUrl = process.env.SMOKE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const runExecutorCheck = (process.env.SMOKE_RUN_EXECUTOR_CHECK || 'true') === 'true';

  const ownerAKeypair = await parseKeypairFromEnv('SMOKE_OWNER_A_KEYPAIR');
  const ownerBKeypair = await parseKeypairFromEnv('SMOKE_OWNER_B_KEYPAIR');
  const executorKeypair = process.env.SMOKE_EXECUTOR_KEYPAIR
    ? await createKeyPairFromBytes(parseSecretBytes(assertEnv('SMOKE_EXECUTOR_KEYPAIR')))
    : ownerAKeypair;

  const ownerA = await getAddressFromPublicKey(ownerAKeypair.publicKey);
  const ownerB = await getAddressFromPublicKey(ownerBKeypair.publicKey);
  const executor = await getAddressFromPublicKey(executorKeypair.publicKey);

  const rpc = createSolanaRpc(rpcUrl);
  const soulAssetKeypair = await generateKeyPair();
  const soulAsset = await getAddressFromPublicKey(soulAssetKeypair.publicKey);
  const [agentState] = await getAgentStatePda(soulAsset);
  const [agentWallet] = await getAgentWalletPda(soulAsset);

  console.log('--- Smoke Start ---');
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Program: ${PROGRAM_ID}`);
  console.log(`Owner A: ${ownerA}`);
  console.log(`Owner B: ${ownerB}`);
  console.log(`Executor: ${executor}`);
  console.log(`Soul Asset: ${soulAsset}`);
  console.log(`Agent State PDA: ${agentState}`);
  console.log(`Agent Wallet PDA: ${agentWallet}`);

  const createIx = createCreateAgentInstruction(
    {
      owner: ownerA,
      soulAsset,
      agentState,
      agentWallet,
      executor,
      systemProgram: SYSTEM_PROGRAM,
      mplCoreProgram: MPL_CORE_PROGRAM_ID,
    },
    {
      name: process.env.SMOKE_AGENT_NAME || 'smoke-agent',
      uri: process.env.SMOKE_AGENT_URI || 'https://example.com/smoke.json',
      personalityHash: process.env.SMOKE_PERSONALITY_HASH || 'smoke-hash-v1',
      strategy: Number(process.env.SMOKE_STRATEGY || '0'),
    },
  );

  const createResult = await expectSuccess('create_agent (owner A)', async () => {
    const sig = await sendTransaction({
      rpc,
      feePayer: ownerA,
      signers: [ownerAKeypair, soulAssetKeypair],
      instructions: [createIx],
    });
    await waitForConfirmation(rpc, sig);
    console.log(`  signature: ${sig}`);
    return sig;
  });
  if (!createResult.ok) process.exit(1);

  const preTransferOwnerAUpdateIx = createUpdateAgentConfigInstruction(
    { owner: ownerA, soulAsset, agentState },
    { isActive: true },
  );
  const preTransferUpdate = await expectSuccess('update_agent_config by owner A before transfer', async () => {
    const sig = await sendTransaction({
      rpc,
      feePayer: ownerA,
      signers: [ownerAKeypair],
      instructions: [preTransferOwnerAUpdateIx],
    });
    await waitForConfirmation(rpc, sig);
    console.log(`  signature: ${sig}`);
    return sig;
  });
  if (!preTransferUpdate.ok) process.exit(1);

  const transferIx = buildMplCoreTransferInstruction({
    asset: soulAsset,
    payer: ownerA,
    authority: ownerA,
    newOwner: ownerB,
  });
  const transferResult = await expectSuccess('mpl-core transfer soul asset A -> B', async () => {
    const sig = await sendTransaction({
      rpc,
      feePayer: ownerA,
      signers: [ownerAKeypair],
      instructions: [transferIx],
    });
    await waitForConfirmation(rpc, sig);
    console.log(`  signature: ${sig}`);
    return sig;
  });
  if (!transferResult.ok) process.exit(1);

  const soulOwner = await fetchSoulAssetOwner(rpc, soulAsset);
  if (soulOwner !== ownerB) {
    console.error(`FAIL transferred soul owner mismatch. expected=${ownerB} actual=${soulOwner}`);
    process.exit(1);
  }
  console.log('PASS transferred soul owner matches owner B');

  await expectFailure(
    'owner A can no longer update config after transfer',
    async () => {
      const ix = createUpdateAgentConfigInstruction(
        { owner: ownerA, soulAsset, agentState },
        { isActive: false },
      );
      const sig = await sendTransaction({
        rpc,
        feePayer: ownerA,
        signers: [ownerAKeypair],
        instructions: [ix],
      });
      await waitForConfirmation(rpc, sig);
    },
    /(Unauthorized|6000|0x1770|custom program error)/i,
  );

  const ownerBUpdate = await expectSuccess('owner B can update config after transfer', async () => {
    const ix = createUpdateAgentConfigInstruction(
      { owner: ownerB, soulAsset, agentState },
      { isActive: true },
    );
    const sig = await sendTransaction({
      rpc,
      feePayer: ownerB,
      signers: [ownerBKeypair],
      instructions: [ix],
    });
    await waitForConfirmation(rpc, sig);
    console.log(`  signature: ${sig}`);
    return sig;
  });
  if (!ownerBUpdate.ok) process.exit(1);

  await expectFailure(
    'owner A can no longer withdraw after transfer',
    async () => {
      const ix = createWithdrawFromAgentInstruction(
        {
          owner: ownerA,
          soulAsset,
          agentState,
          agentWallet,
          systemProgram: SYSTEM_PROGRAM,
        },
        0n,
      );
      const sig = await sendTransaction({
        rpc,
        feePayer: ownerA,
        signers: [ownerAKeypair],
        instructions: [ix],
      });
      await waitForConfirmation(rpc, sig);
    },
    /(Unauthorized|6000|0x1770|custom program error)/i,
  );

  const ownerBWithdraw = await expectSuccess('owner B can withdraw (0 lamports) after transfer', async () => {
    const ix = createWithdrawFromAgentInstruction(
      {
        owner: ownerB,
        soulAsset,
        agentState,
        agentWallet,
        systemProgram: SYSTEM_PROGRAM,
      },
      0n,
    );
    const sig = await sendTransaction({
      rpc,
      feePayer: ownerB,
      signers: [ownerBKeypair],
      instructions: [ix],
    });
    await waitForConfirmation(rpc, sig);
    console.log(`  signature: ${sig}`);
    return sig;
  });
  if (!ownerBWithdraw.ok) process.exit(1);

  if (runExecutorCheck) {
    console.log('Running executor auth check via claim_rewards...');
    const currentEpoch = await findCurrentEpochStatus(rpc);
    if (!currentEpoch || currentEpoch.status.epoch < 2n) {
      console.log('SKIP executor check: no suitable previous epoch found');
    } else {
      const claimEpoch = currentEpoch.status.epoch - 1n;
      const { epochStatus, wasAlphaTipper, wasTopBurner } =
        await deriveAlphaHausClaimPdas(agentWallet, claimEpoch);

      const strangerKeypair = await generateKeyPair();
      const stranger = await getAddressFromPublicKey(strangerKeypair.publicKey);

      await expectFailure(
        'non-owner/non-executor caller is rejected by claim_rewards',
        async () => {
          const ix = createClaimRewardsInstruction(
            {
              caller: stranger,
              soulAsset,
              agentState,
              agentWallet,
              epochStatus,
              wasAlphaTipper,
              wasTopBurner,
              alphaHausProgram: ALPHA_HAUS_PROGRAM_ID,
              systemProgram: SYSTEM_PROGRAM,
            },
            claimEpoch,
          );
          const sig = await sendTransaction({
            rpc,
            feePayer: ownerA,
            signers: [ownerAKeypair, strangerKeypair],
            instructions: [ix],
          });
          await waitForConfirmation(rpc, sig);
        },
        /(Unauthorized|6000|0x1770|custom program error)/i,
      );

      const executorAttempt = await expectSuccess(
        'executor can pass auth gate on claim_rewards (downstream alpha errors are acceptable)',
        async () => {
          const ix = createClaimRewardsInstruction(
            {
              caller: executor,
              soulAsset,
              agentState,
              agentWallet,
              epochStatus,
              wasAlphaTipper,
              wasTopBurner,
              alphaHausProgram: ALPHA_HAUS_PROGRAM_ID,
              systemProgram: SYSTEM_PROGRAM,
            },
            claimEpoch,
          );
          const sig = await sendTransaction({
            rpc,
            feePayer: ownerA,
            signers: [ownerAKeypair, executorKeypair],
            instructions: [ix],
          });
          await waitForConfirmation(rpc, sig);
          console.log(`  signature: ${sig}`);
          return sig;
        },
      );

      if (!executorAttempt.ok) {
        const msg = stringifyError(executorAttempt.error);
        if (/(Unauthorized|6000|0x1770)/i.test(msg)) {
          console.error('FAIL executor check: hit program Unauthorized; auth gate did not pass');
          process.exit(1);
        }
        console.log('PASS executor auth likely passed (failure appears downstream in alpha.haus path)');
        console.log(`  downstream error: ${msg}`);
      }
    }
  }

  const state = await fetchAgentState(rpc, agentState);
  if (state) {
    console.log(`Final agent_state.owner (cached field): ${state.owner}`);
    console.log(`Final agent_state.executor: ${state.executor}`);
  }

  console.log('--- Smoke Completed ---');
}

main().catch((err) => {
  console.error('Smoke script failed with fatal error');
  console.error(stringifyError(err));
  process.exit(1);
});
