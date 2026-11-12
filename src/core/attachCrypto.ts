// MSRC's attachment encryption, reproduced from the portal bundle (SubmitButton
// chunk, 2026-11-11) and live-verified: every file gets a fresh AES-256-CBC key
// and IV; the upload body is IV ‖ ciphertext; the AES key is wrapped with MSRC's
// public RSA key from GET /portal/v2.0/key and sent in the x-wrapped-key header.

export interface MsrcJwk extends JsonWebKey {
  kid?: string;
  hash?: string;
}

export interface EncryptedUpload {
  body: Uint8Array<ArrayBuffer>;
  wrappedKey: string; // base64
  kid: string;
}

/** Portal rule: SHA-256 only for RSA-OAEP-256 (or RSA-* with hash SHA-256); else RSA-OAEP with the key's hash or SHA-1. */
export function keyParams(jwk: { alg?: string; hash?: string }): { alg: string; name: string; hash: string | { name: string } } {
  if (jwk.alg === "RSA-OAEP-256" || (jwk.alg?.startsWith("RSA-") && jwk.hash === "SHA-256")) return { alg: "RSA-OAEP-256", name: "RSA-OAEP", hash: { name: "SHA-256" } };
  return { alg: jwk.alg || "RSA-OAEP", name: jwk.alg || "RSA-OAEP", hash: jwk.hash || "SHA-1" };
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function encryptForMsrc(plain: Uint8Array<ArrayBuffer> | ArrayBuffer, jwk: MsrcJwk): Promise<EncryptedUpload> {
  const subtle = globalThis.crypto.subtle;
  const p = keyParams(jwk);
  const rsa = await subtle.importKey("jwk", { ...jwk, alg: p.alg }, { name: p.name, hash: p.hash } as RsaHashedImportParams, false, ["wrapKey"]);
  const aes = await subtle.generateKey({ name: "AES-CBC", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cipher = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, aes, plain));
  const body = new Uint8Array(iv.length + cipher.length);
  body.set(iv, 0);
  body.set(cipher, iv.length);
  const wrapped = new Uint8Array(await subtle.wrapKey("raw", aes, rsa, { name: (rsa.algorithm as { name: string }).name }));
  return { body, wrappedKey: base64(wrapped), kid: String(jwk.kid ?? "") };
}

/** The multipart field name is the file name with non-Latin-1 characters removed (portal `Cr`). */
export function attachFieldName(name: string): string {
  const kept = name.replace(/[^\x00-\xFF]/g, "");
  return kept.replace(/^\.+$/, "").trim() ? kept : "attachment";
}
