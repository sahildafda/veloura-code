import fs from "node:fs";
import { z } from "zod";
import { getVelouraPaths, VelouraPaths } from "./paths.js";

export const ConfigSchema = z.object({
  provider: z.enum(["openrouter", "ollama", "custom"]).default("openrouter"),
  baseUrl: z.string().optional(),
  defaultModel: z.string().default("openrouter/free"),
  privacyMode: z.enum(["standard", "strict"]).default("standard"),
  requireCodeApproval: z.boolean().default(false),
  maxIterations: z.number().int().positive().default(50),
  maxRequests: z.number().int().positive().default(100),
  maxExecutionTime: z.number().int().positive().default(3600000), // 1 hour in ms
  maxContextTokens: z.number().int().positive().default(32000),
  autoFallback: z.boolean().default(true),
  autoCheckpoint: z.boolean().default(true),
  autoVerify: z.boolean().default(true),
  maxRetries: z.number().int().min(1).max(10).default(3),
  timeoutMs: z.number().int().positive().default(60000),
  allowedCommands: z.array(z.string()).default([]),
  deniedCommands: z.array(z.string()).default([]),
});

export type VelouraConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: VelouraConfig = ConfigSchema.parse({});

export class ConfigManager {
  private paths: VelouraPaths;
  private config: VelouraConfig;

  constructor(paths?: VelouraPaths) {
    this.paths = paths || getVelouraPaths();
    this.config = this.load();
  }

  public getPaths(): VelouraPaths {
    return this.paths;
  }

  public get(): VelouraConfig {
    return { ...this.config };
  }

  public load(): VelouraConfig {
    try {
      if (fs.existsSync(this.paths.configFile)) {
        const raw = fs.readFileSync(this.paths.configFile, "utf-8");
        const parsed = JSON.parse(raw);
        const validated = ConfigSchema.parse(parsed);
        this.config = validated;
        return validated;
      }
    } catch (err) {
      // Return defaults if reading fails or corrupt
    }
    this.config = { ...DEFAULT_CONFIG };
    this.save(this.config);
    return this.config;
  }

  public save(newConfig: Partial<VelouraConfig>): VelouraConfig {
    const merged = { ...this.config, ...newConfig };
    const validated = ConfigSchema.parse(merged);
    this.config = validated;
    fs.writeFileSync(this.paths.configFile, JSON.stringify(this.config, null, 2), "utf-8");
    return this.config;
  }

  public reset(): VelouraConfig {
    this.config = { ...DEFAULT_CONFIG };
    fs.writeFileSync(this.paths.configFile, JSON.stringify(this.config, null, 2), "utf-8");
    return this.config;
  }

  public setPrivacyMode(mode: "standard" | "strict"): VelouraConfig {
    return this.save({
      privacyMode: mode,
      requireCodeApproval: mode === "strict",
    });
  }

  public setDefaultModel(modelId: string): VelouraConfig {
    return this.save({ defaultModel: modelId });
  }
}
