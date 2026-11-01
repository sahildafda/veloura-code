export interface SecretFinding {
  type: string;
  matched: string;
  masked: string;
  startIndex: number;
  endIndex: number;
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: "OpenRouter API Key",
    regex: /\bsk-or-v1-[a-f0-9]{64}\b/gi,
  },
  {
    name: "OpenAI API Key",
    regex: /\bsk-[A-Za-z0-9-_]{20,64}\b/g,
  },
  {
    name: "Anthropic API Key",
    regex: /\bsk-ant-[A-Za-z0-9-_]{20,80}\b/g,
  },
  {
    name: "AWS Access Key ID",
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: "AWS Secret Access Key",
    regex: /(?:aws_secret_access_key|aws_sec_key|aws_secret)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
  },
  {
    name: "GitHub Token",
    regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g,
  },
  {
    name: "GitHub Fine-Grained PAT",
    regex: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
  },
  {
    name: "Private RSA / EC Key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: "JSON Web Token (JWT)",
    regex: /\beyJ[A-Za-z0-9-_]{10,}\.eyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b/g,
  },
  {
    name: "Slack Token",
    regex: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*\b/g,
  },
  {
    name: "Database Connection URI with Password",
    regex: /\b(?:postgres|postgresql|mongodb|mysql|redis):\/\/[^:\s]+:([^@\s]+)@[^\s]+/gi,
  },
  {
    name: "Generic Secret Assignment",
    regex: /(?:password|passwd|api_key|apikey|secret_key|secret|auth_token|access_token|private_token)\s*[:=]\s*["']([^"'\r\n\t]{8,128})["']/gi,
  },
];

export class SecretDetector {
  /**
   * Scans text and returns all detected secret findings.
   */
  public static scan(text: string): SecretFinding[] {
    if (!text || typeof text !== "string") return [];
    const findings: SecretFinding[] = [];

    for (const pattern of SECRET_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const fullMatch = match[0];
        // If there is a capture group for the actual secret value, use it; otherwise full match
        const secretVal = match[1] || fullMatch;
        const startIndex = match.index;
        const endIndex = startIndex + fullMatch.length;

        findings.push({
          type: pattern.name,
          matched: secretVal,
          masked: this.mask(secretVal),
          startIndex,
          endIndex,
        });
      }
    }

    return findings;
  }

  /**
   * Replaces any detected secrets with a safe masked placeholder: [REDACTED:<type>]
   */
  public static redact(text: string): { sanitized: string; count: number; findings: SecretFinding[] } {
    if (!text || typeof text !== "string") {
      return { sanitized: text, count: 0, findings: [] };
    }

    const findings = this.scan(text);
    if (findings.length === 0) {
      return { sanitized: text, count: 0, findings: [] };
    }

    // Sort by descending start index so replacements do not shift offsets
    const sorted = [...findings].sort((a, b) => b.startIndex - a.startIndex);
    let result = text;

    for (const finding of sorted) {
      const before = result.slice(0, finding.startIndex);
      const after = result.slice(finding.endIndex);
      const replacement = `[REDACTED: ${finding.type}]`;
      result = before + replacement + after;
    }

    return {
      sanitized: result,
      count: findings.length,
      findings,
    };
  }

  /**
   * Checks whether the filename or path itself indicates a sensitive secret file.
   */
  public static isSecretFile(filePath: string): boolean {
    const lower = filePath.toLowerCase().replace(/\\/g, "/");
    const base = lower.split("/").pop() || "";

    const secretBasenames = [
      ".env",
      ".env.local",
      ".env.production",
      ".env.development",
      ".env.staging",
      ".env.test",
      "id_rsa",
      "id_ed25519",
      "id_dsa",
      "id_ecdsa",
      ".netrc",
      ".npmrc",
      ".pypirc",
      ".htpasswd",
      "credentials.json",
      "service-account.json",
      "service_account.json",
    ];

    if (secretBasenames.includes(base)) return true;
    if (base.startsWith(".env.") && !base.endsWith(".example") && !base.endsWith(".sample")) {
      return true;
    }

    if (
      base.endsWith(".pem") ||
      base.endsWith(".key") ||
      base.endsWith(".pfx") ||
      base.endsWith(".p12") ||
      base.endsWith(".pkcs12") ||
      base.endsWith(".kdbx")
    ) {
      return true;
    }

    return false;
  }

  public static mask(val: string): string {
    if (val.length <= 6) return "******";
    return `${val.slice(0, 3)}...${val.slice(-3)}`;
  }
}
