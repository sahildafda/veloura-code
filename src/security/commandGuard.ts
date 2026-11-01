export interface CommandAnalysis {
  isBlocked: boolean;
  requiresApproval: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  reason?: string;
  matchedPattern?: string;
}

export class CommandGuard {
  private allowedCommands: Set<string>;
  private deniedCommands: Set<string>;

  constructor(allowedCommands: string[] = [], deniedCommands: string[] = []) {
    this.allowedCommands = new Set(allowedCommands.map((c) => c.toLowerCase().trim()));
    this.deniedCommands = new Set(deniedCommands.map((c) => c.toLowerCase().trim()));
  }

  public analyze(command: string): CommandAnalysis {
    const trimmed = command.trim();
    const lower = trimmed.toLowerCase();

    // Check user explicit blocklist first
    for (const denied of this.deniedCommands) {
      if (lower.startsWith(denied) || lower === denied) {
        return {
          isBlocked: true,
          requiresApproval: false,
          riskLevel: "critical",
          reason: `Command matches user-configured deny rule: '${denied}'`,
        };
      }
    }

    // Check user explicit allowlist
    for (const allowed of this.allowedCommands) {
      if (lower.startsWith(allowed) || lower === allowed) {
        return {
          isBlocked: false,
          requiresApproval: false,
          riskLevel: "low",
        };
      }
    }

    // 1. Critical / Blocked (Severe system hazard)
    const criticalPatterns = [
      { pattern: /\bformat\s+[a-z]:/i, reason: "Disk formatting command" },
      { pattern: /\bdiskpart\b/i, reason: "Disk partitioning tool" },
      { pattern: /\bmkfs\b/i, reason: "Filesystem formatting" },
      { pattern: /\bdd\s+if=/i, reason: "Raw disk overwrite (dd)" },
      { pattern: /\b(curl|wget)\s+.*\|\s*(ba)?sh\b/i, reason: "Executing downloaded code directly into shell" },
      { pattern: /Invoke-Expression\s*\(?.*(WebClient|DownloadString)/i, reason: "PowerShell download and execute" },
    ];

    for (const { pattern, reason } of criticalPatterns) {
      if (pattern.test(trimmed)) {
        return {
          isBlocked: true,
          requiresApproval: false,
          riskLevel: "critical",
          reason,
          matchedPattern: pattern.source,
        };
      }
    }

    // 2. High Risk - Requires Explicit Approval
    const highRiskPatterns = [
      { pattern: /\brm\s+-(?:r|f|rf|fr)\b/i, reason: "Recursive force file deletion (rm -rf)" },
      { pattern: /\b(del|erase)\s+\/[sqf]\b/i, reason: "Recursive / force file deletion in Windows" },
      { pattern: /\bRemove-Item\s+.*-Recurse\b/i, reason: "Recursive deletion in PowerShell" },
      { pattern: /\brmdir\s+\/s\b/i, reason: "Recursive directory deletion in Windows" },
      { pattern: /\bgit\s+push\b/i, reason: "Pushing to remote Git repository" },
      { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "Destructive Git hard reset" },
      { pattern: /\bgit\s+clean\s+-[a-z]*f\b/i, reason: "Git force clean untracked files" },
      { pattern: /\b(sudo|doas|runas)\b/i, reason: "Elevated administrator/root privileges" },
      { pattern: /\b(chmod|chown)\s+-R\b/i, reason: "Recursive permission / ownership modification" },
      { pattern: /\b(npm|yarn|pnpm)\s+(install|add|i)\s+(-g|--global)\b/i, reason: "Installing global packages" },
      { pattern: /\bpip\s+install\s+--user\b/i, reason: "Global Python package installation" },
      { pattern: /\b(reg\s+add|reg\s+delete|setx)\b/i, reason: "Modifying Windows registry or global env" },
    ];

    for (const { pattern, reason } of highRiskPatterns) {
      if (pattern.test(trimmed)) {
        return {
          isBlocked: false,
          requiresApproval: true,
          riskLevel: "high",
          reason,
          matchedPattern: pattern.source,
        };
      }
    }

    // 3. Medium Risk - General mutation or package installation
    const mediumRiskPatterns = [
      { pattern: /\b(npm|yarn|pnpm)\s+(install|add|i|update)\b/i, reason: "Package installation / dependency update" },
      { pattern: /\bpip\s+install\b/i, reason: "Python package installation" },
      { pattern: /\bcargo\s+add\b/i, reason: "Rust crate dependency addition" },
      { pattern: /\bgit\s+checkout\b/i, reason: "Branch switching or file checkout" },
      { pattern: /\bgit\s+rebase\b/i, reason: "Git rebase" },
    ];

    for (const { pattern, reason } of mediumRiskPatterns) {
      if (pattern.test(trimmed)) {
        return {
          isBlocked: false,
          requiresApproval: false,
          riskLevel: "medium",
          reason,
          matchedPattern: pattern.source,
        };
      }
    }

    // 4. Low Risk (Standard read-only or build/test commands)
    return {
      isBlocked: false,
      requiresApproval: false,
      riskLevel: "low",
    };
  }
}
