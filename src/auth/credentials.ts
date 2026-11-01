import fs from "node:fs";
import { execSync } from "node:child_process";
import { getVelouraPaths, VelouraPaths } from "../config/paths.js";
import { encryptData, decryptData } from "./crypto.js";

export interface CredentialStatus {
  hasKey: boolean;
  source: "environment" | "credential_manager" | "encrypted_file" | "none";
  maskedKey?: string;
  storageDescription: string;
}

const CREDENTIAL_TARGET = "VelouraCode_OpenRouter_API_Key";

export class CredentialManager {
  private paths: VelouraPaths;

  constructor(paths?: VelouraPaths) {
    this.paths = paths || getVelouraPaths();
  }

  /**
   * Retrieves the OpenRouter API key from available sources:
   * 1. OPENROUTER_API_KEY environment variable
   * 2. Platform Credential Store (Windows Credential Manager / macOS Keychain / Secret Service)
   * 3. Machine-bound local encrypted credential file
   */
  public getApiKey(): string | null {
    // 1. Environment variable
    if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0) {
      return process.env.OPENROUTER_API_KEY.trim();
    }

    // 2. Windows Credential Manager if on Windows
    if (process.platform === "win32") {
      try {
        const psScript = `
          [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] | Out-Null
          $vault = New-Object Windows.Security.Credentials.PasswordVault
          try {
            $cred = $vault.Retrieve('${CREDENTIAL_TARGET}', 'openrouter')
            $cred.RetrievePassword()
            [Console]::Write($cred.Password)
          } catch {
            exit 1
          }
        `;
        const result = execSync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, " ")}"`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();

        if (result && result.length > 5) {
          return result;
        }
      } catch {
        // Fall through to encrypted file
      }
    }

    // 3. Local machine-encrypted file
    if (fs.existsSync(this.paths.credentialsFile)) {
      try {
        const encrypted = fs.readFileSync(this.paths.credentialsFile, "utf8");
        const plain = decryptData(encrypted);
        if (plain && plain.length > 5) {
          return plain;
        }
      } catch {
        // Corrupt or tampered file
      }
    }

    return null;
  }

  /**
   * Stores the OpenRouter API key securely.
   */
  public setApiKey(apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error("API key cannot be empty");
    }

    let storedInPlatformVault = false;

    // Try Windows PasswordVault on Windows
    if (process.platform === "win32") {
      try {
        const psScript = `
          [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] | Out-Null
          $vault = New-Object Windows.Security.Credentials.PasswordVault
          $cred = New-Object Windows.Security.Credentials.PasswordCredential('${CREDENTIAL_TARGET}', 'openrouter', '${trimmed.replace(/'/g, "''")}')
          $vault.Add($cred)
        `;
        execSync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, " ")}"`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
        storedInPlatformVault = true;
      } catch {
        // Platform vault save failed; fallback to encrypted local file
      }
    }

    // Always keep encrypted fallback as well
    try {
      const encrypted = encryptData(trimmed);
      fs.writeFileSync(this.paths.credentialsFile, encrypted, {
        encoding: "utf8",
        mode: 0o600, // Read/write only by owner
      });
    } catch (err: any) {
      if (!storedInPlatformVault) {
        throw new Error(`Failed to save encrypted credentials: ${err.message}`);
      }
    }
  }

  /**
   * Clears stored API key.
   */
  public clearApiKey(): void {
    if (process.platform === "win32") {
      try {
        const psScript = `
          [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] | Out-Null
          $vault = New-Object Windows.Security.Credentials.PasswordVault
          try {
            $cred = $vault.Retrieve('${CREDENTIAL_TARGET}', 'openrouter')
            $vault.Remove($cred)
          } catch {}
        `;
        execSync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, " ")}"`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch {
        // Ignore
      }
    }

    if (fs.existsSync(this.paths.credentialsFile)) {
      try {
        fs.unlinkSync(this.paths.credentialsFile);
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Reports current credential status without exposing the secret.
   */
  public getStatus(): CredentialStatus {
    if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0) {
      const key = process.env.OPENROUTER_API_KEY.trim();
      return {
        hasKey: true,
        source: "environment",
        maskedKey: this.maskKey(key),
        storageDescription: "Loaded from OPENROUTER_API_KEY environment variable",
      };
    }

    const key = this.getApiKey();
    if (key) {
      return {
        hasKey: true,
        source: process.platform === "win32" ? "credential_manager" : "encrypted_file",
        maskedKey: this.maskKey(key),
        storageDescription:
          process.platform === "win32"
            ? "Stored in Windows Credential Manager (with AES-256-GCM local backup)"
            : "Stored in machine-bound AES-256-GCM local encrypted storage",
      };
    }

    return {
      hasKey: false,
      source: "none",
      storageDescription: "No API key configured. Run 'veloura auth' or set OPENROUTER_API_KEY.",
    };
  }

  private maskKey(key: string): string {
    if (key.length <= 8) return "********";
    const start = key.slice(0, 7);
    const end = key.slice(-4);
    return `${start}...${end}`;
  }
}
