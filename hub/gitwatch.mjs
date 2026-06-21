// Watches each project's git repo for new commits and reports them to the hub's
// ingest pipeline. Watching .git/logs/HEAD (appended on every commit/checkout)
// is the reliable signal on macOS FSEvents — core fs.watch is enough.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { listProjectRows } from "../lib/db.ts";

const US = "\x1f"; // unit separator between %H and %s

function gitInfo(repo) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repo, "log", "-1", `--format=%H${US}%s`],
      { timeout: 4000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const [sha, subject] = String(stdout).trim().split(US);
        execFile(
          "git",
          ["-C", repo, "status", "--porcelain"],
          { timeout: 4000 },
          (e2, out2) => {
            const uncommitted = e2
              ? 0
              : String(out2).split("\n").filter((l) => l.trim()).length;
            resolve({ sha, subject: subject ?? "", uncommitted });
          },
        );
      },
    );
  });
}

export function startGitWatch(ingest) {
  const watchers = new Map(); // projectPath -> { watcher, timer }
  let lastSha = new Map(); // projectPath -> sha (dedupe)

  function watchRepo(repoPath) {
    const headLog = path.join(repoPath, ".git", "logs", "HEAD");
    if (watchers.has(repoPath) || !fs.existsSync(headLog)) return;
    try {
      const entry = { watcher: null, timer: null };
      entry.watcher = fs.watch(headLog, () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(async () => {
          const info = await gitInfo(repoPath);
          if (!info || !info.sha) return;
          if (lastSha.get(repoPath) === info.sha && info.uncommitted === undefined) return;
          lastSha.set(repoPath, info.sha);
          ingest({
            path: repoPath,
            type: "commit",
            payload: { sha: info.sha, subject: info.subject, uncommitted: info.uncommitted },
          });
        }, 500); // debounce — fs.watch can fire several times per write
      });
      watchers.set(repoPath, entry);
    } catch {
      /* unwatchable path — ignore */
    }
  }

  function rescan() {
    let rows = [];
    try {
      rows = listProjectRows();
    } catch {
      return;
    }
    const wanted = new Set(
      rows.filter((p) => p.path && !p.archived).map((p) => p.path),
    );
    // add new
    for (const p of wanted) watchRepo(p);
    // drop removed
    for (const [p, entry] of watchers) {
      if (!wanted.has(p)) {
        try {
          entry.watcher?.close();
        } catch {
          /* noop */
        }
        clearTimeout(entry.timer);
        watchers.delete(p);
      }
    }
  }

  rescan();
  setInterval(rescan, 60_000);
  return { watchers };
}
