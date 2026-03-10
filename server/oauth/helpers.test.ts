import { describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  b64url,
  pkceVerifier,
  pkceChallengeS256,
  sanitizeOAuthRedirect,
  appendOAuthQuery,
  BUILTIN_GITHUB_CLIENT_ID,
  BUILTIN_GOOGLE_CLIENT_ID,
  BUILTIN_GOOGLE_CLIENT_SECRET,
} from "./helpers.ts";
import { randomBytes } from "node:crypto";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a simple string", () => {
    const plaintext = "my-super-secret-token";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("throws on empty string (empty ciphertext segment)", () => {
    // AES-256-GCM with empty plaintext produces empty ciphertext,
    // which fails the format validation in decryptSecret
    const encrypted = encryptSecret("");
    expect(() => decryptSecret(encrypted)).toThrow("invalid_encrypted_payload");
  });

  it("round-trips unicode content", () => {
    const plaintext = "토큰-비밀-🔐-日本語";
    const encrypted = encryptSecret(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("round-trips a long string", () => {
    const plaintext = "a".repeat(10_000);
    const encrypted = encryptSecret(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const plaintext = "same-input";
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it("throws on invalid format (missing v1 prefix)", () => {
    expect(() => decryptSecret("v2:abc:def:ghi")).toThrow("invalid_encrypted_payload");
  });

  it("throws on invalid format (missing segments)", () => {
    expect(() => decryptSecret("v1:abc")).toThrow("invalid_encrypted_payload");
    expect(() => decryptSecret("v1:abc:def")).toThrow("invalid_encrypted_payload");
    expect(() => decryptSecret("")).toThrow("invalid_encrypted_payload");
  });

  it("throws on tampered ciphertext (GCM auth tag mismatch)", () => {
    const encrypted = encryptSecret("secret");
    const parts = encrypted.split(":");
    // Tamper with the ciphertext portion
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("throws on tampered auth tag", () => {
    const encrypted = encryptSecret("secret");
    const parts = encrypted.split(":");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});

describe("PKCE helpers", () => {
  it("pkceVerifier returns a base64url string", () => {
    const verifier = pkceVerifier();
    expect(verifier.length).toBeGreaterThan(0);
    // base64url: no +, /, or =
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("pkceChallengeS256 is deterministic for same verifier", async () => {
    const verifier = pkceVerifier();
    const a = await pkceChallengeS256(verifier);
    const b = await pkceChallengeS256(verifier);
    expect(a).toBe(b);
  });

  it("pkceChallengeS256 differs for different verifiers", async () => {
    const a = await pkceChallengeS256("verifier-a");
    const b = await pkceChallengeS256("verifier-b");
    expect(a).not.toBe(b);
  });

  it("b64url encodes correctly", () => {
    const buf = Buffer.from([0xff, 0xfe, 0xfd]);
    const result = b64url(buf);
    expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(result, "base64url")).toEqual(buf);
  });
});

describe("sanitizeOAuthRedirect", () => {
  it("returns / for undefined or empty input", () => {
    expect(sanitizeOAuthRedirect(undefined)).toBe("/");
    expect(sanitizeOAuthRedirect("")).toBe("/");
  });

  it("allows localhost URLs", () => {
    expect(sanitizeOAuthRedirect("http://localhost:8800/callback")).toBe("http://localhost:8800/callback");
    expect(sanitizeOAuthRedirect("http://127.0.0.1:8790/done")).toBe("http://127.0.0.1:8790/done");
  });

  it("allows .ts.net URLs", () => {
    expect(sanitizeOAuthRedirect("https://mybox.ts.net/callback")).toBe("https://mybox.ts.net/callback");
  });

  it("rejects external URLs", () => {
    expect(sanitizeOAuthRedirect("https://evil.com/steal")).toBe("/");
  });

  it("allows relative paths starting with /", () => {
    expect(sanitizeOAuthRedirect("/settings")).toBe("/settings");
  });

  it("rejects relative paths not starting with /", () => {
    expect(sanitizeOAuthRedirect("settings")).toBe("/");
  });
});

describe("appendOAuthQuery", () => {
  it("appends a query parameter", () => {
    const result = appendOAuthQuery("http://example.com/path", "code", "abc123");
    expect(result).toContain("code=abc123");
  });

  it("overwrites existing parameter", () => {
    const result = appendOAuthQuery("http://example.com/path?code=old", "code", "new");
    expect(result).toContain("code=new");
    expect(result).not.toContain("code=old");
  });
});

describe("OAuth client credentials are not hardcoded", () => {
  it("returns empty strings when env vars not set", () => {
    // In test environment, env vars are not set for OAuth
    // so these should be empty (no hardcoded fallback)
    if (!process.env.OAUTH_GITHUB_CLIENT_ID) {
      expect(BUILTIN_GITHUB_CLIENT_ID).toBe("");
    }
    if (!process.env.OAUTH_GOOGLE_CLIENT_ID) {
      expect(BUILTIN_GOOGLE_CLIENT_ID).toBe("");
    }
    if (!process.env.OAUTH_GOOGLE_CLIENT_SECRET) {
      expect(BUILTIN_GOOGLE_CLIENT_SECRET).toBe("");
    }
  });
});
