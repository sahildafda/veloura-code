import * as diff from "diff";

export interface PatchResult {
  success: boolean;
  newContent?: string;
  diffText: string;
  error?: string;
  linesAdded: number;
  linesRemoved: number;
}

export class Patcher {
  /**
   * Generates a unified diff between oldContent and newContent.
   */
  public static createUnifiedDiff(
    filePath: string,
    oldContent: string,
    newContent: string
  ): string {
    return diff.createPatch(filePath, oldContent, newContent, "original", "modified");
  }

  /**
   * Applies targeted replacement: finds `target` block in `original` and replaces with `replacement`.
   * Normalizes line endings (\r\n vs \n) to prevent matching failures across OSes.
   */
  public static applyTargetReplacement(
    filePath: string,
    original: string,
    target: string,
    replacement: string
  ): PatchResult {
    // Normalize line endings for comparison
    const normOriginal = original.replace(/\r\n/g, "\n");
    const normTarget = target.replace(/\r\n/g, "\n");
    const normReplacement = replacement.replace(/\r\n/g, "\n");

    if (!normOriginal.includes(normTarget)) {
      // Try trimmed line matching as fallback
      const originalLines = normOriginal.split("\n");
      const targetLines = normTarget.split("\n");

      const matchIndex = this.findMatchingLineBlock(originalLines, targetLines);
      if (matchIndex === -1) {
        return {
          success: false,
          diffText: "",
          error: `Target string was not found in '${filePath}'. Make sure target matches exact file content.`,
          linesAdded: 0,
          linesRemoved: 0,
        };
      }

      // Replace using line indices
      const before = originalLines.slice(0, matchIndex).join("\n");
      const after = originalLines.slice(matchIndex + targetLines.length).join("\n");
      const newNorm = [before, normReplacement, after].filter((s) => s.length > 0).join("\n");
      
      const patchDiff = diff.createPatch(filePath, normOriginal, newNorm);
      const stats = this.countDiffLines(patchDiff);

      return {
        success: true,
        newContent: this.restoreLineEndings(newNorm, original),
        diffText: patchDiff,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
      };
    }

    const replaced = normOriginal.replace(normTarget, normReplacement);
    const patchDiff = diff.createPatch(filePath, normOriginal, replaced);
    const stats = this.countDiffLines(patchDiff);

    return {
      success: true,
      newContent: this.restoreLineEndings(replaced, original),
      diffText: patchDiff,
      linesAdded: stats.added,
      linesRemoved: stats.removed,
    };
  }

  /**
   * Applies a raw unified diff patch to original content.
   */
  public static applyPatch(filePath: string, original: string, patchString: string): PatchResult {
    const normOriginal = original.replace(/\r\n/g, "\n");
    try {
      const patched = diff.applyPatch(normOriginal, patchString);
      if (patched === false) {
        return {
          success: false,
          diffText: "",
          error: `Failed to cleanly apply unified diff to '${filePath}'. The patch hunks do not match file content.`,
          linesAdded: 0,
          linesRemoved: 0,
        };
      }

      const stats = this.countDiffLines(patchString);
      return {
        success: true,
        newContent: this.restoreLineEndings(patched, original),
        diffText: patchString,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
      };
    } catch (err: any) {
      return {
        success: false,
        diffText: "",
        error: `Patch syntax error: ${err.message}`,
        linesAdded: 0,
        linesRemoved: 0,
      };
    }
  }

  private static findMatchingLineBlock(haystack: string[], needle: string[]): number {
    if (needle.length === 0) return -1;
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      let matches = true;
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j].trim() !== needle[j].trim()) {
          matches = false;
          break;
        }
      }
      if (matches) return i;
    }
    return -1;
  }

  private static restoreLineEndings(text: string, originalSample: string): string {
    const isCRLF = originalSample.includes("\r\n");
    if (isCRLF) {
      return text.replace(/\r?\n/g, "\r\n");
    }
    return text.replace(/\r\n/g, "\n");
  }

  private static countDiffLines(diffText: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    const lines = diffText.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
    return { added, removed };
  }
}
