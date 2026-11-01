import path from "node:path";
import fs from "node:fs";

export class PathGuard {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Resolves a relative or absolute path against projectRoot,
   * verifying that the target does NOT escape projectRoot.
   */
  public resolveSafe(inputPath: string): { safePath: string; relativePath: string } {
    if (!inputPath || typeof inputPath !== "string") {
      throw new Error("Invalid file path provided");
    }

    // Check for null bytes
    if (inputPath.indexOf("\0") !== -1) {
      throw new Error("Path traversal attempt detected (null byte in path)");
    }

    // Resolve absolute path
    const resolved = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(this.projectRoot, inputPath);

    // Verify containment
    const normalizedRoot = path.normalize(this.projectRoot).toLowerCase();
    const normalizedTarget = path.normalize(resolved).toLowerCase();

    const isInside =
      normalizedTarget === normalizedRoot ||
      normalizedTarget.startsWith(normalizedRoot + path.sep.toLowerCase()) ||
      normalizedTarget.startsWith(normalizedRoot + "/");

    if (!isInside) {
      throw new Error(
        `Path traversal denied: Target path '${inputPath}' resolves outside project root '${this.projectRoot}'`
      );
    }

    // Check symlink target if path exists
    try {
      if (fs.existsSync(resolved)) {
        const realTarget = fs.realpathSync(resolved);
        const normalizedReal = path.normalize(realTarget).toLowerCase();
        const isRealInside =
          normalizedReal === normalizedRoot ||
          normalizedReal.startsWith(normalizedRoot + path.sep.toLowerCase()) ||
          normalizedReal.startsWith(normalizedRoot + "/");

        if (!isRealInside) {
          throw new Error(
            `Symlink traversal denied: '${inputPath}' points outside project root to '${realTarget}'`
          );
        }
      }
    } catch (err: any) {
      if (err.message.includes("traversal denied")) {
        throw err;
      }
      // If file doesn't exist yet, we still allow safe creation inside projectRoot
    }

    const relative = path.relative(this.projectRoot, resolved);
    return {
      safePath: resolved,
      relativePath: relative || ".",
    };
  }

  public isInsideProject(targetPath: string): boolean {
    try {
      this.resolveSafe(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
