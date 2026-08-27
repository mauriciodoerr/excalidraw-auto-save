const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3001;
const SAVE_PATH = process.env.SAVE_PATH || path.join(__dirname, "../data/drawing.excalidraw");
const SAVE_DIR = path.dirname(SAVE_PATH);
// Requests arrive via Nginx proxy (same-origin from browser's perspective),
// so we allow any origin here. Restrict via firewall/network instead.
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Ensure the data directory exists
fs.mkdirSync(SAVE_DIR, { recursive: true });

// Keep .config.json out of the data git repo
function ensureDataGitignore() {
  const gitignorePath = path.join(SAVE_DIR, ".gitignore");
  try {
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, "utf8")
      : "";
    if (!existing.includes(".config.json")) {
      fs.appendFileSync(gitignorePath, ".config.json\n");
    }
  } catch (err) {
    console.warn("[auto-save] could not write data .gitignore:", err.message);
  }
}

ensureDataGitignore();

// Migrate legacy drawing.excalidraw → default.excalidraw on first run
const legacyPath = SAVE_PATH;
const defaultPath = path.join(SAVE_DIR, "default.excalidraw");
if (fs.existsSync(legacyPath) && !fs.existsSync(defaultPath)) {
  fs.renameSync(legacyPath, defaultPath);
  console.log("[auto-save] migrated drawing.excalidraw → default.excalidraw");
}

// Resolve a canvas ID to a safe file path (no directory traversal)
function canvasFilePath(canvasId) {
  const safe = path.basename(canvasId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(SAVE_DIR, `${safe}.excalidraw`);
}


// POST /api/save — write a canvas JSON to its own file
app.post("/api/save", async (req, res) => {
  const { json, canvasId = "default" } = req.body;
  if (!json || typeof json !== "string") {
    return res.status(400).json({ ok: false, error: "Missing or invalid json field" });
  }
  try {
    await fs.promises.writeFile(canvasFilePath(canvasId), json, "utf8");
    res.json({ ok: true });
  } catch (err) {
    console.error("[auto-save] write error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/canvas/:id — read a canvas file
app.get("/api/canvas/:id", async (req, res) => {
  const filePath = canvasFilePath(req.params.id);
  try {
    const data = await fs.promises.readFile(filePath, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch {
    res.status(404).json({ ok: false, error: "Canvas not found" });
  }
});

// DELETE /api/canvas/:id — delete a canvas file
app.delete("/api/canvas/:id", async (req, res) => {
  const filePath = canvasFilePath(req.params.id);
  try {
    await fs.promises.unlink(filePath);
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // Already gone — not an error
  }
});

// GET /api/canvases — list all canvas files in the data dir
app.get("/api/canvases", async (_req, res) => {
  try {
    const files = await fs.promises.readdir(SAVE_DIR);
    const canvases = files
      .filter((f) => f.endsWith(".excalidraw"))
      .map((f) => ({ id: f.replace(/\.excalidraw$/, "") }));
    res.json({ ok: true, canvases });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Persistent config stored in the data volume alongside the canvas files.
const CONFIG_PATH = path.join(SAVE_DIR, ".config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(data) {
  const current = readConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...data }, null, 2));
}

// Build a fresh SSH config at commit time so key changes take effect immediately
// without restarting the container.
const PATCHED_SSH_CONFIG = "/tmp/ssh_config_patched";

function buildSshCommand() {
  const { sshKeyName = "id_ed25519" } = readConfig();
  const keyPath = `/root/.ssh/${path.basename(sshKeyName)}`;
  if (!fs.existsSync(keyPath)) {
    console.warn("[auto-save] SSH key not found:", keyPath, "— git push will likely fail");
    return "ssh";
  }
  const config = [
    "Host *",
    `  IdentityFile ${keyPath}`,
    "  IdentitiesOnly yes",
    "  StrictHostKeyChecking accept-new",
  ].join("\n") + "\n";
  fs.writeFileSync(PATCHED_SSH_CONFIG, config, { mode: 0o600 });
  return `ssh -F ${PATCHED_SSH_CONFIG}`;
}

// GET /api/config — return current server config
app.get("/api/config", (_req, res) => {
  res.json({ ok: true, config: readConfig() });
});

// POST /api/config — update one or more config fields
app.post("/api/config", (req, res) => {
  const { sshKeyName } = req.body;
  if (sshKeyName !== undefined) {
    writeConfig({ sshKeyName });
  }
  res.json({ ok: true });
});

// POST /api/git/commit — git add + commit + push
app.post("/api/git/commit", async (req, res) => {
  const { message, email, name } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ ok: false, error: "Missing or invalid message field" });
  }
  if (!email || !name) {
    return res.status(400).json({ ok: false, error: "Missing git identity (email/name)" });
  }

  const cwd = path.dirname(SAVE_PATH);
  const output = [];

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_SSH_COMMAND: buildSshCommand(),
  };

  try {
    const add = await execFileAsync("git", ["add", "."], { cwd });
    output.push(add.stdout, add.stderr);

    let commit;
    try {
      commit = await execFileAsync("git", ["commit", "-m", message], { cwd, env: gitEnv });
    } catch (commitErr) {
      if ((commitErr.stdout || "").includes("nothing to commit")) {
        return res.json({ ok: true, output: "Nothing to commit — drawing is already up to date." });
      }
      throw commitErr;
    }
    output.push(commit.stdout, commit.stderr);

    let push;
    try {
      push = await execFileAsync("git", ["push"], { cwd, env: gitEnv });
    } catch (pushErr) {
      if ((pushErr.stderr || "").includes("no upstream branch")) {
        const branch = (
          await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, env: gitEnv })
        ).stdout.trim();
        push = await execFileAsync(
          "git", ["push", "--set-upstream", "origin", branch], { cwd, env: gitEnv },
        );
      } else {
        throw pushErr;
      }
    }
    output.push(push.stdout, push.stderr);

    res.json({ ok: true, output: output.filter(Boolean).join("\n") });
  } catch (err) {
    const detail = err.stderr || err.stdout || err.message;
    console.error("[auto-save] git error:", detail);
    res.status(500).json({ ok: false, error: detail });
  }
});

// POST /api/git/pull — git pull from remote
app.post("/api/git/pull", async (_req, res) => {
  const cwd = path.dirname(SAVE_PATH);
  try {
    const { stdout, stderr } = await execFileAsync(
      "git", ["pull"],
      { cwd, env: { ...process.env, GIT_SSH_COMMAND: buildSshCommand() } },
    );
    res.json({ ok: true, output: [stdout, stderr].filter(Boolean).join("\n") || "Already up to date." });
  } catch (err) {
    const detail = err.stderr || err.stdout || err.message;
    console.error("[auto-save] git pull error:", detail);
    res.status(500).json({ ok: false, error: detail });
  }
});

// GET /api/git/status — check if the data dir is a git repo with a remote
app.get("/api/git/status", async (_req, res) => {
  const cwd = path.dirname(SAVE_PATH);
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd });
    res.json({ ok: true, initialized: true, remote: stdout.trim() });
  } catch {
    res.json({ ok: true, initialized: false, remote: null });
  }
});

// POST /api/git/init — git init + git remote add origin <url>
app.post("/api/git/init", async (req, res) => {
  const { remoteUrl, freshStart = false } = req.body;
  if (!remoteUrl || typeof remoteUrl !== "string") {
    return res.status(400).json({ ok: false, error: "Missing remoteUrl" });
  }

  const cwd = path.dirname(SAVE_PATH);
  const output = [];

  try {
    if (freshStart) {
      // Wipe git history; canvas files are untouched
      const gitDir = path.join(cwd, ".git");
      if (fs.existsSync(gitDir)) {
        fs.rmSync(gitDir, { recursive: true, force: true });
        output.push("Removed existing git history.");
      }
    }

    // Init only if not already a repo
    const isRepo = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd })
      .then(() => true)
      .catch(() => false);

    if (!isRepo) {
      const init = await execFileAsync("git", ["init"], { cwd });
      output.push(init.stdout, init.stderr);
    }

    ensureDataGitignore();

    // Remove existing remote if present, then re-add
    await execFileAsync("git", ["remote", "remove", "origin"], { cwd }).catch(() => {});
    const remote = await execFileAsync("git", ["remote", "add", "origin", remoteUrl.trim()], { cwd });
    output.push(remote.stdout, remote.stderr);

    res.json({ ok: true, output: output.filter(Boolean).join("\n") });
  } catch (err) {
    const detail = err.stderr || err.stdout || err.message;
    console.error("[auto-save] git init error:", detail);
    res.status(500).json({ ok: false, error: detail });
  }
});

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[auto-save] server listening on port ${PORT}`);
  console.log(`[auto-save] save path: ${SAVE_PATH}`);
});
