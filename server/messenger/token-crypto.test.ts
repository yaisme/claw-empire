import { describe, expect, it } from "vitest";
import {
  encryptMessengerChannelsForStorage,
  decryptMessengerChannelsForClient,
  decryptMessengerChannelsForRuntime,
  decryptMessengerTokenForRuntime,
} from "./token-crypto.ts";

describe("encryptMessengerChannelsForStorage → decryptMessengerChannelsForClient round-trip", () => {
  it("encrypts and decrypts a simple channel token", () => {
    const input = {
      telegram: { token: "bot123456:ABC-DEF" },
    };
    const encrypted = encryptMessengerChannelsForStorage(input) as any;
    expect(encrypted.telegram.token).not.toBe("bot123456:ABC-DEF");
    expect(encrypted.telegram.token).toContain("__ce_enc_v1__:");

    const decrypted = decryptMessengerChannelsForClient(encrypted) as any;
    expect(decrypted.telegram.token).toBe("bot123456:ABC-DEF");
  });

  it("encrypts and decrypts session tokens in arrays", () => {
    const input = {
      discord: {
        sessions: [
          { token: "discord-token-1", name: "server1" },
          { token: "discord-token-2", name: "server2" },
        ],
      },
    };
    const encrypted = encryptMessengerChannelsForStorage(input) as any;
    expect(encrypted.discord.sessions[0].token).toContain("__ce_enc_v1__:");
    expect(encrypted.discord.sessions[1].token).toContain("__ce_enc_v1__:");
    expect(encrypted.discord.sessions[0].name).toBe("server1");

    const decrypted = decryptMessengerChannelsForClient(encrypted) as any;
    expect(decrypted.discord.sessions[0].token).toBe("discord-token-1");
    expect(decrypted.discord.sessions[1].token).toBe("discord-token-2");
  });

  it("handles multiple channels simultaneously", () => {
    const input = {
      telegram: { token: "tg-token" },
      slack: { token: "slack-token" },
      discord: {
        token: "discord-main",
        sessions: [{ token: "discord-session" }],
      },
    };
    const encrypted = encryptMessengerChannelsForStorage(input) as any;
    const decrypted = decryptMessengerChannelsForClient(encrypted) as any;
    expect(decrypted.telegram.token).toBe("tg-token");
    expect(decrypted.slack.token).toBe("slack-token");
    expect(decrypted.discord.token).toBe("discord-main");
    expect(decrypted.discord.sessions[0].token).toBe("discord-session");
  });
});

describe("decryptMessengerChannelsForRuntime", () => {
  it("returns empty string on decryption failure instead of raw", () => {
    const input = {
      telegram: { token: "__ce_enc_v1__:invalid-encrypted-data" },
    };
    const result = decryptMessengerChannelsForRuntime(input) as any;
    expect(result.telegram.token).toBe("");
  });
});

describe("decryptMessengerTokenForRuntime", () => {
  it("decrypts a valid encrypted token", () => {
    const encrypted = encryptMessengerChannelsForStorage({
      telegram: { token: "my-bot-token" },
    }) as any;
    const result = decryptMessengerTokenForRuntime("telegram", encrypted.telegram.token);
    expect(result).toBe("my-bot-token");
  });

  it("returns empty string for invalid encrypted token", () => {
    expect(decryptMessengerTokenForRuntime("telegram", "__ce_enc_v1__:broken")).toBe("");
  });

  it("returns plain token if not encrypted (passthrough)", () => {
    expect(decryptMessengerTokenForRuntime("telegram", "plain-token")).toBe("plain-token");
  });

  it("returns empty string for empty/null input", () => {
    expect(decryptMessengerTokenForRuntime("telegram", "")).toBe("");
    expect(decryptMessengerTokenForRuntime("telegram", null)).toBe("");
    expect(decryptMessengerTokenForRuntime("telegram", undefined)).toBe("");
  });
});

describe("edge cases", () => {
  it("idempotent: encrypting already-encrypted token does not double-encrypt", () => {
    const input = { telegram: { token: "original" } };
    const encrypted1 = encryptMessengerChannelsForStorage(input) as any;
    const encrypted2 = encryptMessengerChannelsForStorage(encrypted1) as any;
    // Should still decrypt to original
    const decrypted = decryptMessengerChannelsForClient(encrypted2) as any;
    expect(decrypted.telegram.token).toBe("original");
  });

  it("passes through non-object input unchanged", () => {
    expect(encryptMessengerChannelsForStorage(null)).toBe(null);
    expect(encryptMessengerChannelsForStorage(undefined)).toBe(undefined);
    expect(encryptMessengerChannelsForStorage("string")).toBe("string");
    expect(encryptMessengerChannelsForStorage(42)).toBe(42);
  });

  it("preserves non-messenger channel keys", () => {
    const input = {
      telegram: { token: "tg" },
      customField: { value: "untouched" },
    };
    const encrypted = encryptMessengerChannelsForStorage(input) as any;
    expect(encrypted.customField).toEqual({ value: "untouched" });
  });

  it("handles channel config without token key", () => {
    const input = {
      telegram: { webhookUrl: "https://example.com/hook" },
    };
    const encrypted = encryptMessengerChannelsForStorage(input) as any;
    expect(encrypted.telegram.webhookUrl).toBe("https://example.com/hook");
  });

  it("handles sessions without token key", () => {
    const input = {
      discord: {
        sessions: [{ name: "no-token-session" }],
      },
    };
    const encrypted = encryptMessengerChannelsForStorage(input) as any;
    expect(encrypted.discord.sessions[0].name).toBe("no-token-session");
  });
});
