import { execFile } from "node:child_process";
import { chmod, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DataAdapter } from "obsidian";
import type {
  ContributionCommit,
  ContributionDay,
  GitConflict,
  GitStatus,
  KnowledgeForestsSettings,
  SyncProgress,
  SyncResult
} from "./types";

const execFileAsync = promisify(execFile);
const MAIN_BRANCH = "main";

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class GitService {
  constructor(
    private readonly vaultPath: string,
    private readonly adapter: DataAdapter,
    private readonly settings: KnowledgeForestsSettings,
    private readonly getGitHubToken: () => string | null = () => null
  ) {}

  async status(): Promise<GitStatus> {
    if (!(await this.isRepository())) {
      return { repository: false, dirty: false, ahead: 0, behind: 0, conflicts: 0, message: "Git is not initialized" };
    }
    const dirty = (await this.git(["status", "--porcelain"])).stdout.trim().length > 0;
    let ahead = 0;
    let behind = 0;
    const remoteRef = `origin/${MAIN_BRANCH}`;
    const refExists = await this.git(["show-ref", "--verify", "--quiet", `refs/remotes/${remoteRef}`], [0, 1]);
    if (refExists.code === 0) {
      const counts = (await this.git(["rev-list", "--left-right", "--count", `${remoteRef}...HEAD`])).stdout.trim().split(/\s+/);
      behind = Number(counts[0] ?? 0);
      ahead = Number(counts[1] ?? 0);
    }
    const conflicts = await this.conflictPaths();
    return { repository: true, dirty, ahead, behind, conflicts: conflicts.length };
  }

  async sync(
    onProgress?: (progress: SyncProgress) => void,
    options: { allowUnrelatedHistories?: boolean } = {}
  ): Promise<SyncResult> {
    this.validateSettings();
    const authentication = await this.createAuthentication();
    try {
      if (!(await this.isRepository())) await this.initialize();
      await this.configureIdentity();
      await this.ensureRemote();

      const existingConflicts = await this.getConflicts();
      if (existingConflicts.length > 0) {
        onProgress?.({ phase: "conflict", message: `${existingConflicts.length} conflict${existingConflicts.length === 1 ? "" : "s"} need attention`, progress: 0.55 });
        return { status: "conflict", committed: false, message: "Resolve the existing sync conflict", conflicts: existingConflicts };
      }

      onProgress?.({ phase: "merging", message: "Checking the remote main branch…", progress: 0.1 });
      await this.git(["ls-remote", "--exit-code", "origin"], [0, 2], authentication.environment);

      onProgress?.({ phase: "saving", message: "Saving local changes…", progress: 0.25 });
      await this.git(["add", "-A"]);
      const diff = await this.git(["diff", "--cached", "--quiet"], [0, 1]);
      let committed = false;
      if (diff.code === 1) {
        const datetime = new Date().toISOString().replace("T", " ").slice(0, 16);
        const message = this.settings.commitMessageTemplate.replaceAll("{{datetime}}", datetime);
        await this.git(["commit", "-m", message]);
        committed = true;
      }

      onProgress?.({ phase: "merging", message: "Merging remote updates…", progress: 0.5 });
      await this.git(["fetch", "origin"], [0], authentication.environment);
      const remoteBranch = await this.git(
        ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${MAIN_BRANCH}`],
        [0, 1]
      );
      if (remoteBranch.code === 0) {
        const remoteRef = `origin/${MAIN_BRANCH}`;
        const mergeBase = await this.git(["merge-base", "HEAD", remoteRef], [0, 1]);
        const historiesAreUnrelated = mergeBase.code === 1;
        if (historiesAreUnrelated && !options.allowUnrelatedHistories) {
          onProgress?.({
            phase: "conflict",
            message: "Local and remote histories started separately — confirmation required",
            progress: 0.5
          });
          return {
            status: "unrelated",
            committed,
            message: "The current vault and remote repository have separate Git histories.",
            conflicts: []
          };
        }

        // Override a user-level merge.ff=only setting: synchronization must be
        // able to create a merge commit when both devices have new commits.
        const mergeArgs = ["merge", "--no-edit", "--ff"];
        if (historiesAreUnrelated) mergeArgs.push("--allow-unrelated-histories");
        mergeArgs.push(remoteRef);
        const merge = await this.git(mergeArgs, [0, 1, 128]);
        if (merge.code !== 0) {
          const conflicts = await this.getConflicts();
          if (conflicts.length > 0) {
            onProgress?.({ phase: "conflict", message: `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} need attention`, progress: 0.55 });
            return { status: "conflict", committed, message: "Remote and local changes overlap", conflicts };
          }
          throw new Error(`Unable to merge remote changes: ${merge.stderr.trim() || merge.stdout.trim()}`);
        }
      }

      onProgress?.({ phase: "uploading", message: "Uploading the merged result…", progress: 0.82 });
      await this.git(["push", "-u", "origin", MAIN_BRANCH], [0], authentication.environment);
      onProgress?.({ phase: "complete", message: "Synced", progress: 1 });
      return {
        status: "complete",
        committed,
        message: committed ? "Saved, merged, and uploaded" : "Remote updates checked; everything is synced",
        conflicts: []
      };
    } finally {
      await authentication.cleanup();
    }
  }

  async getConflicts(): Promise<GitConflict[]> {
    if (!(await this.isRepository())) return [];
    const paths = await this.conflictPaths();
    return Promise.all(paths.map(async (conflictPath) => {
      const localContent = await this.stageContent(2, conflictPath);
      const remoteContent = await this.stageContent(3, conflictPath);
      let workingContent: string | null = null;
      try {
        if (await this.adapter.exists(conflictPath)) workingContent = await this.adapter.read(conflictPath);
      } catch {
        workingContent = null;
      }
      return {
        path: conflictPath,
        localContent,
        remoteContent,
        workingContent,
        binary: isBinaryConflict(conflictPath, localContent, remoteContent)
      };
    }));
  }

  async resolveConflict(conflict: GitConflict, resolution: "local" | "remote" | "manual", manualContent?: string): Promise<void> {
    const currentPaths = await this.conflictPaths();
    if (!currentPaths.includes(conflict.path)) throw new Error(`${conflict.path} is no longer conflicted.`);
    if (resolution === "manual") {
      if (conflict.binary) throw new Error("Binary conflicts cannot be merged as text.");
      await this.adapter.write(conflict.path, manualContent ?? "");
      await this.git(["add", "--", conflict.path]);
      return;
    }
    const selectedContent = resolution === "local" ? conflict.localContent : conflict.remoteContent;
    if (selectedContent === null) {
      await this.git(["rm", "-f", "--", conflict.path]);
      return;
    }
    await this.git(["checkout", resolution === "local" ? "--ours" : "--theirs", "--", conflict.path]);
    await this.git(["add", "--", conflict.path]);
  }

  async completeConflictResolution(onProgress?: (progress: SyncProgress) => void): Promise<void> {
    const conflicts = await this.getConflicts();
    if (conflicts.length > 0) throw new Error(`Resolve ${conflicts.length} remaining conflict${conflicts.length === 1 ? "" : "s"}.`);
    const mergeHead = await this.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], [0, 1, 128]);
    if (mergeHead.code === 0) {
      onProgress?.({ phase: "saving", message: "Saving the conflict resolution…", progress: 0.65 });
      await this.git(["commit", "-m", "forest sync: resolve remote changes"]);
    }
    const authentication = await this.createAuthentication();
    try {
      onProgress?.({ phase: "uploading", message: "Uploading the resolved version…", progress: 0.85 });
      await this.git(["push", "-u", "origin", MAIN_BRANCH], [0], authentication.environment);
      onProgress?.({ phase: "complete", message: "Synced", progress: 1 });
    } finally {
      await authentication.cleanup();
    }
  }

  async abortConflictResolution(): Promise<void> {
    await this.git(["merge", "--abort"]);
  }

  async remoteHasUpdates(): Promise<boolean> {
    if (!(await this.isRepository()) || !this.settings.gitRemoteUrl) return false;
    this.validateSettings();
    const authentication = await this.createAuthentication();
    try {
      const remote = await this.git(
        ["ls-remote", "--heads", "origin", MAIN_BRANCH],
        [0],
        authentication.environment
      );
      const remoteHash = remote.stdout.trim().split(/\s+/)[0];
      if (!remoteHash) return false;
      const known = await this.git(["rev-parse", `refs/remotes/origin/${MAIN_BRANCH}`], [0, 128]);
      return known.code !== 0 || known.stdout.trim() !== remoteHash;
    } finally {
      await authentication.cleanup();
    }
  }

  async contributions(days: number): Promise<ContributionDay[]> {
    const dates = dateRange(days);
    const empty = dates.map((date) => ({ date, count: 0, commits: [] as ContributionCommit[] }));
    if (!(await this.isRepository()) || !this.settings.gitAuthorEmail) return empty;
    const branchRef = await this.git(["rev-parse", "--verify", MAIN_BRANCH], [0, 128]);
    if (branchRef.code !== 0) return empty;
    const output = await this.git([
      "log",
      MAIN_BRANCH,
      "--format=%H%x09%aI%x09%ae%x09%s",
      `--since=${dates[0]}T00:00:00`
    ]);
    const byDate = new Map(empty.map((day) => [day.date, day]));
    for (const line of output.stdout.split("\n")) {
      if (!line.trim()) continue;
      const [hash, timestamp, email, ...subjectParts] = line.split("\t");
      if (!hash || !timestamp || !email || email.toLowerCase() !== this.settings.gitAuthorEmail.toLowerCase()) continue;
      const date = timestamp.slice(0, 10);
      const day = byDate.get(date);
      if (!day) continue;
      day.commits.push({ hash, date: timestamp, email, subject: subjectParts.join("\t") });
      day.count += 1;
    }
    return empty;
  }

  private async initialize(): Promise<void> {
    await this.git(["init", "-b", MAIN_BRANCH]);
    await this.ensureGitignore();
  }

  private async isRepository(): Promise<boolean> {
    const result = await this.git(["rev-parse", "--is-inside-work-tree"], [0, 128]);
    return result.code === 0 && result.stdout.trim() === "true";
  }

  private async configureIdentity(): Promise<void> {
    await this.git(["config", "user.name", this.settings.gitAuthorName]);
    await this.git(["config", "user.email", this.settings.gitAuthorEmail]);
  }

  private async ensureRemote(): Promise<void> {
    const existing = await this.git(["remote", "get-url", "origin"], [0, 2, 128]);
    if (existing.code !== 0) {
      await this.git(["remote", "add", "origin", this.settings.gitRemoteUrl]);
    } else if (existing.stdout.trim() !== this.settings.gitRemoteUrl) {
      await this.git(["remote", "set-url", "origin", this.settings.gitRemoteUrl]);
    }
  }

  private async ensureGitignore(): Promise<void> {
    const marker = "# Knowledge Forests local state";
    const entries = `${marker}\nnode_modules/\n.trash/\n.obsidian/workspace.json\n.obsidian/workspace-mobile.json\n.obsidian/cache/\n`;
    const path = ".gitignore";
    if (!(await this.adapter.exists(path))) {
      await this.adapter.write(path, entries);
      return;
    }
    const current = await this.adapter.read(path);
    if (!current.includes(marker)) {
      await this.adapter.write(path, `${current.trimEnd()}\n\n${entries}`);
    }
  }

  private async conflictPaths(): Promise<string[]> {
    const result = await this.git(["diff", "--name-only", "--diff-filter=U", "-z"], [0, 128]);
    if (result.code !== 0 || !result.stdout) return [];
    return result.stdout.split("\0").filter(Boolean);
  }

  private async stageContent(stage: 2 | 3, conflictPath: string): Promise<string | null> {
    const result = await this.git(["show", `:${stage}:${conflictPath}`], [0, 128]);
    return result.code === 0 ? result.stdout : null;
  }

  private validateSettings(): void {
    if (!this.settings.gitRemoteUrl) throw new Error("Set the Git remote URL in Knowledge Forests settings.");
    if (!this.settings.gitAuthorName) throw new Error("Set the Git author name in Knowledge Forests settings.");
    if (!this.settings.gitAuthorEmail) throw new Error("Set the Git author email in Knowledge Forests settings.");
    if (this.settings.gitAuthMode === "github-token") {
      if (!this.settings.gitRemoteUrl.startsWith("https://github.com/")) {
        throw new Error("GitHub token authentication requires an https://github.com/ remote URL.");
      }
      if (!this.getGitHubToken()) throw new Error("Add a GitHub personal access token in Knowledge Forests settings.");
    }
  }

  private async createAuthentication(): Promise<{ environment?: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
    if (this.settings.gitAuthMode !== "github-token") return { cleanup: async () => undefined };
    const token = this.getGitHubToken();
    if (!token) throw new Error("Add a GitHub personal access token in Knowledge Forests settings.");
    const suffix = process.platform === "win32" ? ".cmd" : ".sh";
    const askpassPath = path.join(os.tmpdir(), `knowledge-forests-askpass-${process.pid}-${Date.now()}${suffix}`);
    const script = process.platform === "win32"
      ? "@echo off\necho %* | findstr /I \"Username\" >nul && (echo x-access-token) || (echo %KNOWLEDGE_FORESTS_GITHUB_TOKEN%)\n"
      : "#!/bin/sh\ncase \"$1\" in *Username*) printf '%s\\n' 'x-access-token' ;; *) printf '%s\\n' \"$KNOWLEDGE_FORESTS_GITHUB_TOKEN\" ;; esac\n";
    await writeFile(askpassPath, script, { mode: 0o700 });
    if (process.platform !== "win32") await chmod(askpassPath, 0o700);
    return {
      environment: {
        GIT_ASKPASS: askpassPath,
        GIT_ASKPASS_REQUIRE: "force",
        GIT_TERMINAL_PROMPT: "0",
        KNOWLEDGE_FORESTS_GITHUB_TOKEN: token
      },
      cleanup: async () => { await rm(askpassPath, { force: true }); }
    };
  }

  private async git(args: string[], allowedCodes: number[] = [0], environment?: NodeJS.ProcessEnv): Promise<GitResult> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd: this.vaultPath,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
        env: { ...process.env, ...environment }
      });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      const code = typeof failure.code === "number" ? failure.code : 128;
      const result = { stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message, code };
      if (allowedCodes.includes(code)) return result;
      throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }
}

function dateRange(days: number): string[] {
  const result: string[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    result.push(`${year}-${month}-${day}`);
  }
  return result;
}

function isBinaryConflict(pathname: string, local: string | null, remote: string | null): boolean {
  const binaryExtensions = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "avif", "pdf", "zip", "7z", "mp3", "wav", "mp4", "mov", "woff", "woff2"
  ]);
  const extension = pathname.split(".").pop()?.toLowerCase() ?? "";
  if (binaryExtensions.has(extension)) return true;
  return (local?.includes("\0") ?? false) || (remote?.includes("\0") ?? false);
}
