/**
 * Export a CryptoKeyPair to the 64-byte Solana keypair format.
 *
 * @solana/kit's `generateKeyPair()` creates non-extractable CryptoKey objects.
 * When we need to serialize the private key (e.g. to pass as an env var to a
 * Fly machine), we must generate the keypair with `extractable: true` using
 * `crypto.subtle.generateKey()` directly, then export the bytes here.
 *
 * The returned Uint8Array is 64 bytes: [32-byte private key | 32-byte public key]
 * which matches the format expected by `createKeyPairFromBytes()` and `solana-keygen`.
 */
export async function exportKeypairBytes(keypair: CryptoKeyPair): Promise<Uint8Array> {
  const [jwk, publicKeyBuffer] = await Promise.all([
    crypto.subtle.exportKey('jwk', keypair.privateKey),
    crypto.subtle.exportKey('raw', keypair.publicKey),
  ]);

  // JWK 'd' field is the 32-byte Ed25519 private key in base64url encoding
  const d = jwk.d;
  if (!d) throw new Error('Failed to export private key: missing JWK "d" field');
  const privateKeyBytes = Uint8Array.from(
    atob(d.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );

  const fullKeypair = new Uint8Array(64);
  fullKeypair.set(privateKeyBytes, 0);
  fullKeypair.set(new Uint8Array(publicKeyBuffer), 32);
  return fullKeypair;
}
