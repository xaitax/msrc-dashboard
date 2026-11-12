import { describe, expect, it } from "vitest";
import { attachFieldName, encryptForMsrc, keyParams } from "../src/core/attachCrypto";

async function msrcLikeKey(hash: "SHA-1" | "SHA-256") {
  const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash }, true, ["wrapKey", "unwrapKey"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "key-1", hash };
  return { jwk, privateKey: pair.privateKey };
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

describe("encryptForMsrc", () => {
  it("produces IV ‖ AES-CBC ciphertext and an RSA-wrapped key MSRC can open", async () => {
    const { jwk, privateKey } = await msrcLikeKey("SHA-1");
    const plain = new TextEncoder().encode("proof of concept bytes ".repeat(1000));
    const out = await encryptForMsrc(plain, jwk);
    expect(out.kid).toBe("key-1");
    const aes = await crypto.subtle.unwrapKey("raw", b64(out.wrappedKey), privateKey, { name: "RSA-OAEP" }, { name: "AES-CBC", length: 256 }, false, ["decrypt"]);
    const iv = out.body.slice(0, 16);
    const back = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, aes, out.body.slice(16)));
    expect(back).toEqual(plain);
  });

  it("works with an RSA-OAEP-256 key too", async () => {
    const { jwk, privateKey } = await msrcLikeKey("SHA-256");
    const out = await encryptForMsrc(new Uint8Array([1, 2, 3]), { ...jwk, alg: "RSA-OAEP-256" });
    const aes = await crypto.subtle.unwrapKey("raw", b64(out.wrappedKey), privateKey, { name: "RSA-OAEP" }, { name: "AES-CBC", length: 256 }, false, ["decrypt"]);
    expect(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: out.body.slice(0, 16) }, aes, out.body.slice(16)))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("uses a fresh key and IV per file", async () => {
    const { jwk } = await msrcLikeKey("SHA-1");
    const a = await encryptForMsrc(new Uint8Array(32), jwk);
    const b = await encryptForMsrc(new Uint8Array(32), jwk);
    expect(a.body.slice(0, 16)).not.toEqual(b.body.slice(0, 16));
    expect(a.wrappedKey).not.toBe(b.wrappedKey);
  });
});

describe("keyParams (portal rule)", () => {
  it("picks SHA-256 only for RSA-OAEP-256 or an explicit SHA-256 hash", () => {
    expect(keyParams({ alg: "RSA-OAEP", hash: "SHA-1" })).toEqual({ alg: "RSA-OAEP", name: "RSA-OAEP", hash: "SHA-1" });
    expect(keyParams({ alg: "RSA-OAEP-256" })).toEqual({ alg: "RSA-OAEP-256", name: "RSA-OAEP", hash: { name: "SHA-256" } });
    expect(keyParams({ alg: "RSA-OAEP", hash: "SHA-256" })).toEqual({ alg: "RSA-OAEP-256", name: "RSA-OAEP", hash: { name: "SHA-256" } });
    expect(keyParams({})).toEqual({ alg: "RSA-OAEP", name: "RSA-OAEP", hash: "SHA-1" });
  });
});

describe("attachFieldName", () => {
  it("strips characters outside Latin-1, like the portal", () => {
    expect(attachFieldName("résumé poc.zip")).toBe("résumé poc.zip");
    expect(attachFieldName("日本poc.zip")).toBe("poc.zip");
    expect(attachFieldName("日本")).toBe("attachment");
  });
});
