import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DataAdapter } from "obsidian";
import { GitService } from "../src/git-service";

describe("GitService", () => {
  it("requires a saved token when GitHub HTTPS authentication is selected", async () => {
    const settings = {
      seedFolder: "Knowledge Forests/Seeds",
      forestFolder: "Knowledge Forests/Forests",
      templateFolder: "Templates",
      h1Weight: 1,
      h2Weight: 0.5,
      thresholds: { sprout: 0.5, seedling: 5, youngTree: 15, matureTree: 40 },
      gitRemoteUrl: "https://github.com/example/private-notes.git",
      gitAuthMode: "github-token" as const,
      gitAuthorName: "Knowledge Forester",
      gitAuthorEmail: "forester@example.com",
      commitMessageTemplate: "forest sync: {{datetime}}",
      heatmapDays: 90
    };
    const service = new GitService("/tmp/does-not-matter", {} as DataAdapter, settings, () => null);
    await expect(service.sync()).rejects.toThrow("personal access token");
  });

  it("initializes, commits, pushes, and counts GitHub-style contributions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-forests-git-"));
    const vault = path.join(root, "vault");
    const remote = path.join(root, "remote.git");
    await mkdir(vault);
    execFileSync("git", ["init", "--bare", remote]);
    await writeFile(path.join(vault, "Note.md"), "# Note\n");

    const adapter = {
      exists: async (relative: string) => {
        try { await readFile(path.join(vault, relative)); return true; } catch { return false; }
      },
      read: async (relative: string) => readFile(path.join(vault, relative), "utf8"),
      write: async (relative: string, data: string) => { await writeFile(path.join(vault, relative), data); }
    } as unknown as DataAdapter;
    const settings = {
      seedFolder: "Knowledge Forests/Seeds",
      forestFolder: "Knowledge Forests/Forests",
      templateFolder: "Templates",
      h1Weight: 1,
      h2Weight: 0.5,
      thresholds: { sprout: 0.5, seedling: 5, youngTree: 15, matureTree: 40 },
      gitRemoteUrl: remote,
      gitAuthMode: "system" as const,
      gitAuthorName: "Knowledge Forester",
      gitAuthorEmail: "forester@example.com",
      commitMessageTemplate: "forest sync: {{datetime}}",
      heatmapDays: 90
    };
    const service = new GitService(vault, adapter, settings);

    const first = await service.sync();
    expect(first.committed).toBe(true);
    expect((await service.status()).dirty).toBe(false);
    expect(execFileSync("git", ["--git-dir", remote, "rev-list", "--count", "main"], { encoding: "utf8" }).trim()).toBe("1");

    const contributions = await service.contributions(7);
    expect(contributions.reduce((sum, day) => sum + day.count, 0)).toBe(1);

    const second = await service.sync();
    expect(second.committed).toBe(false);

    const secondDevice = path.join(root, "second-device");
    execFileSync("git", ["clone", "-b", "main", remote, secondDevice]);
    execFileSync("git", ["config", "user.name", "Other Device"], { cwd: secondDevice });
    execFileSync("git", ["config", "user.email", "gardener@example.com"], { cwd: secondDevice });
    await writeFile(path.join(secondDevice, "Note.md"), "# Changed on device B\n");
    execFileSync("git", ["add", "Note.md"], { cwd: secondDevice });
    execFileSync("git", ["commit", "-m", "device B change"], { cwd: secondDevice });
    execFileSync("git", ["push", "origin", "main"], { cwd: secondDevice });
    expect(await service.remoteHasUpdates()).toBe(true);

    await writeFile(path.join(vault, "Note.md"), "# Changed on device A\n");
    const divergent = await service.sync();
    expect(divergent.status).toBe("conflict");
    expect(divergent.conflicts).toHaveLength(1);
    expect(divergent.conflicts[0].localContent).toContain("device A");
    expect(divergent.conflicts[0].remoteContent).toContain("device B");

    await service.resolveConflict(divergent.conflicts[0], "local");
    expect(await service.getConflicts()).toHaveLength(0);
    await service.completeConflictResolution();
    const uploaded = execFileSync("git", ["--git-dir", remote, "show", "main:Note.md"], { encoding: "utf8" });
    expect(uploaded).toContain("device A");
    expect(await service.remoteHasUpdates()).toBe(false);
  }, 20_000);
});
