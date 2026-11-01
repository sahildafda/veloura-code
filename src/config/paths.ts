import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface VelouraPaths {
  dataDir: string;
  configDir: string;
  configFile: string;
  dbFile: string;
  credentialsFile: string;
  logsDir: string;
  checkpointsDir: string;
}

export function getVelouraPaths(customDataDir?: string, customConfigDir?: string): VelouraPaths {
  const platform = process.platform;
  const homeDir = os.homedir();

  let dataDir: string;
  let configDir: string;

  if (customDataDir) {
    dataDir = customDataDir;
  } else if (process.env.VELOURA_DATA_DIR) {
    dataDir = process.env.VELOURA_DATA_DIR;
  } else if (platform === "win32") {
    dataDir = path.join(process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "veloura-code");
  } else if (platform === "darwin") {
    dataDir = path.join(homeDir, "Library", "Application Support", "veloura-code");
  } else {
    dataDir = path.join(process.env.XDG_DATA_HOME || path.join(homeDir, ".local", "share"), "veloura-code");
  }

  if (customConfigDir) {
    configDir = customConfigDir;
  } else if (process.env.VELOURA_CONFIG_DIR) {
    configDir = process.env.VELOURA_CONFIG_DIR;
  } else if (platform === "win32") {
    configDir = path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "veloura-code");
  } else {
    configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "veloura-code");
  }

  const paths: VelouraPaths = {
    dataDir,
    configDir,
    configFile: path.join(configDir, "config.json"),
    dbFile: path.join(dataDir, "veloura.sqlite"),
    credentialsFile: path.join(dataDir, "credentials.enc"),
    logsDir: path.join(dataDir, "logs"),
    checkpointsDir: path.join(dataDir, "checkpoints"),
  };

  // Ensure directories exist
  try {
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.mkdirSync(paths.configDir, { recursive: true });
    fs.mkdirSync(paths.logsDir, { recursive: true });
    fs.mkdirSync(paths.checkpointsDir, { recursive: true });
  } catch {
    // Handled in callers or silently allowed if already exists
  }

  return paths;
}
