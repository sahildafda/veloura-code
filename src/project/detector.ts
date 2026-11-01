import fs from "node:fs";
import path from "node:path";

export interface ProjectMetadata {
  projectType: string;
  languages: string[];
  frameworks: string[];
  packageManager: string;
  buildScript?: string;
  testScript?: string;
  lintScript?: string;
  devScript?: string;
  entryPoints: string[];
  configFiles: string[];
  dependencies: Record<string, string>;
  instructions?: string;
}

export class ProjectDetector {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public detect(): ProjectMetadata {
    const metadata: ProjectMetadata = {
      projectType: "Unknown",
      languages: [],
      frameworks: [],
      packageManager: "unknown",
      entryPoints: [],
      configFiles: [],
      dependencies: {},
    };

    // 1. Check Node.js / JavaScript / TypeScript
    const pkgPath = path.join(this.projectRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      metadata.projectType = "Node.js";
      metadata.configFiles.push("package.json");

      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
        metadata.dependencies = allDeps;

        // Languages
        if (allDeps["typescript"] || fs.existsSync(path.join(this.projectRoot, "tsconfig.json"))) {
          metadata.languages.push("TypeScript");
          metadata.configFiles.push("tsconfig.json");
        }
        metadata.languages.push("JavaScript");

        // Frameworks
        if (allDeps["react"]) metadata.frameworks.push("React");
        if (allDeps["next"]) metadata.frameworks.push("Next.js");
        if (allDeps["vue"]) metadata.frameworks.push("Vue");
        if (allDeps["@angular/core"]) metadata.frameworks.push("Angular");
        if (allDeps["express"]) metadata.frameworks.push("Express");
        if (allDeps["fastify"]) metadata.frameworks.push("Fastify");
        if (allDeps["nestjs"] || allDeps["@nestjs/core"]) metadata.frameworks.push("NestJS");
        if (allDeps["tailwindcss"]) metadata.frameworks.push("TailwindCSS");

        // Scripts
        if (pkg.scripts) {
          if (pkg.scripts.build) metadata.buildScript = "npm run build";
          if (pkg.scripts.test) metadata.testScript = "npm test";
          if (pkg.scripts.lint) metadata.lintScript = "npm run lint";
          if (pkg.scripts.dev) metadata.devScript = "npm run dev";
          else if (pkg.scripts.start) metadata.devScript = "npm start";
        }

        // Package manager detection
        if (fs.existsSync(path.join(this.projectRoot, "pnpm-lock.yaml"))) {
          metadata.packageManager = "pnpm";
        } else if (fs.existsSync(path.join(this.projectRoot, "yarn.lock"))) {
          metadata.packageManager = "yarn";
        } else if (fs.existsSync(path.join(this.projectRoot, "bun.lockb"))) {
          metadata.packageManager = "bun";
        } else {
          metadata.packageManager = "npm";
        }
      } catch {
        // Ignored
      }
    }

    // 2. Check Python
    const pyprojectPath = path.join(this.projectRoot, "pyproject.toml");
    const reqPath = path.join(this.projectRoot, "requirements.txt");
    const setupPyPath = path.join(this.projectRoot, "setup.py");

    if (fs.existsSync(pyprojectPath) || fs.existsSync(reqPath) || fs.existsSync(setupPyPath)) {
      if (!metadata.languages.includes("Python")) metadata.languages.push("Python");
      if (metadata.projectType === "Unknown") metadata.projectType = "Python";

      if (fs.existsSync(pyprojectPath)) metadata.configFiles.push("pyproject.toml");
      if (fs.existsSync(reqPath)) metadata.configFiles.push("requirements.txt");

      if (fs.existsSync(path.join(this.projectRoot, "poetry.lock"))) {
        metadata.packageManager = "poetry";
        metadata.testScript = "poetry run pytest";
      } else if (fs.existsSync(path.join(this.projectRoot, "Pipfile"))) {
        metadata.packageManager = "pipenv";
      } else {
        if (metadata.packageManager === "unknown") metadata.packageManager = "pip";
        metadata.testScript = "pytest";
      }
    }

    // 3. Check Rust
    const cargoPath = path.join(this.projectRoot, "Cargo.toml");
    if (fs.existsSync(cargoPath)) {
      metadata.languages.push("Rust");
      metadata.projectType = "Rust";
      metadata.packageManager = "cargo";
      metadata.configFiles.push("Cargo.toml");
      metadata.buildScript = "cargo build";
      metadata.testScript = "cargo test";
    }

    // 4. Check Java / Kotlin
    if (fs.existsSync(path.join(this.projectRoot, "pom.xml"))) {
      metadata.languages.push("Java");
      metadata.projectType = "Java";
      metadata.packageManager = "maven";
      metadata.configFiles.push("pom.xml");
      metadata.buildScript = "mvn clean install";
      metadata.testScript = "mvn test";
    } else if (
      fs.existsSync(path.join(this.projectRoot, "build.gradle")) ||
      fs.existsSync(path.join(this.projectRoot, "build.gradle.kts"))
    ) {
      metadata.languages.push("Java / Kotlin");
      metadata.projectType = "Gradle";
      metadata.packageManager = "gradle";
      metadata.buildScript = "./gradlew build";
      metadata.testScript = "./gradlew test";
    }

    // 5. Look for entry points
    const candidateEntryPoints = [
      "src/index.ts",
      "src/index.js",
      "src/main.ts",
      "src/main.js",
      "src/App.tsx",
      "src/App.jsx",
      "index.ts",
      "index.js",
      "main.py",
      "app.py",
      "src/main.rs",
    ];

    for (const candidate of candidateEntryPoints) {
      if (fs.existsSync(path.join(this.projectRoot, candidate))) {
        metadata.entryPoints.push(candidate);
      }
    }

    // 6. Look for instructions file (README.md, AGENT.md, etc.)
    const instructionCandidates = [
      ".veloura/instructions.md",
      "AGENT.md",
      "CLAUDE.md",
      "README.md",
    ];

    for (const file of instructionCandidates) {
      const full = path.join(this.projectRoot, file);
      if (fs.existsSync(full)) {
        try {
          const content = fs.readFileSync(full, "utf8");
          metadata.instructions = content.slice(0, 4000); // Truncate to 4000 chars
          break;
        } catch {}
      }
    }

    return metadata;
  }
}
