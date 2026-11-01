import { describe, it, expect } from "vitest";
import { SecretDetector } from "../src/security/secrets.js";

describe("Secret Detection and Privacy Filtering", () => {
  it("should identify OpenRouter API keys", () => {
    const raw = ["sk", "or", "v1", "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"].join("-");
    const findings = SecretDetector.scan(`Here is my key: ${raw}`);
    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe("OpenRouter API Key");
  });

  it("should identify AWS Access Keys", () => {
    const findings = SecretDetector.scan("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe("AWS Access Key ID");
  });

  it("should identify GitHub personal access tokens", () => {
    const findings = SecretDetector.scan("ghp_1234567890abcdefghijklmnopqrstuvwxyzAB");
    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe("GitHub Token");
  });

  it("should detect and redact private RSA keys", () => {
    const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+abcdef...dummy...
-----END RSA PRIVATE KEY-----`;
    const { sanitized, count } = SecretDetector.redact(privateKey);
    expect(count).toBe(1);
    expect(sanitized).toContain("[REDACTED: Private RSA / EC Key]");
    expect(sanitized).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("should recognize sensitive secret filenames", () => {
    expect(SecretDetector.isSecretFile(".env")).toBe(true);
    expect(SecretDetector.isSecretFile(".env.local")).toBe(true);
    expect(SecretDetector.isSecretFile("config/production.key")).toBe(true);
    expect(SecretDetector.isSecretFile("id_rsa")).toBe(true);

    // Safe files
    expect(SecretDetector.isSecretFile(".env.example")).toBe(false);
    expect(SecretDetector.isSecretFile("src/index.ts")).toBe(false);
  });
});
