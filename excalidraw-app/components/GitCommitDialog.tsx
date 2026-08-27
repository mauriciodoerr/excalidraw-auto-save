import React, { useEffect, useRef, useState } from "react";

import "./GitCommitDialog.scss";

const LS_EMAIL = "excalidraw-git-email";
const LS_NAME = "excalidraw-git-name";

type Step = "checking" | "repo" | "identity" | "commit";
type Status = "idle" | "loading" | "success" | "error";

function loadIdentity() {
  return {
    email: localStorage.getItem(LS_EMAIL) ?? "",
    name: localStorage.getItem(LS_NAME) ?? "",
  };
}

function saveIdentity(email: string, name: string) {
  localStorage.setItem(LS_EMAIL, email);
  localStorage.setItem(LS_NAME, name);
}

export const GitCommitDialog: React.FC<{ onClose: () => void }> = ({
  onClose,
}) => {
  const identity = loadIdentity();

  const [step, setStep] = useState<Step>("checking");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [currentRemote, setCurrentRemote] = useState<string | null>(null);
  const [email, setEmail] = useState(identity.email);
  const [name, setName] = useState(identity.name);

  const defaultMessage = () => {
    const now = new Date();
    return `Update drawing – ${now.toISOString().replace("T", " ").slice(0, 16)}`;
  };
  const [message, setMessage] = useState(defaultMessage);
  const [status, setStatus] = useState<Status>("idle");
  const [output, setOutput] = useState("");

  const firstInputRef = useRef<HTMLInputElement>(null);

  // On open: check if the repo is already initialised
  useEffect(() => {
    fetch("/api/git/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.initialized) {
          setStep("repo");
        } else {
          setCurrentRemote(data.remote);
          const needsIdentity = !identity.email.trim() || !identity.name.trim();
          setStep(needsIdentity ? "identity" : "commit");
        }
      })
      .catch(() => {
        // Server unreachable — let user attempt anyway
        setStep("repo");
      });
  }, []);

  useEffect(() => {
    firstInputRef.current?.focus();
    if (step === "commit") firstInputRef.current?.select();
  }, [step]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  // Step 1: init repo
  const handleRepoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remoteUrl.trim()) return;
    setStatus("loading");
    setOutput("");
    try {
      const res = await fetch("/api/git/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteUrl: remoteUrl.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setCurrentRemote(remoteUrl.trim());
        setStatus("idle");
        const needsIdentity = !identity.email.trim() || !identity.name.trim();
        setStep(needsIdentity ? "identity" : "commit");
      } else {
        setStatus("error");
        setOutput(data.error || "Unknown error");
      }
    } catch (err: any) {
      setStatus("error");
      setOutput(err.message || "Network error");
    }
  };

  // Step 2: save identity
  const handleIdentitySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim()) return;
    saveIdentity(email.trim(), name.trim());
    setStep("commit");
  };

  // Step 3: commit & push
  const handleCommit = async () => {
    if (!message.trim() || status === "loading") return;
    setStatus("loading");
    setOutput("");
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          email: email.trim(),
          name: name.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("success");
        setOutput(data.output || "");
      } else {
        setStatus("error");
        setOutput(data.error || "Unknown error");
      }
    } catch (err: any) {
      setStatus("error");
      setOutput(err.message || "Network error — is the auto-save server running?");
    }
  };

  return (
    <div className="git-commit-dialog__overlay" onClick={onClose}>
      <div
        className="git-commit-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 className="git-commit-dialog__title">Commit &amp; Push to Git</h3>

        {step === "checking" && (
          <p className="git-commit-dialog__hint">Checking repository…</p>
        )}

        {step === "repo" && (
          <form onSubmit={handleRepoSubmit} className="git-commit-dialog__form">
            <p className="git-commit-dialog__hint">
              No git repository found. Enter the remote URL to initialise one.
            </p>
            <label className="git-commit-dialog__label">
              Remote URL
              <input
                ref={firstInputRef}
                className="git-commit-dialog__input"
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="git@github.com:you/your-repo.git"
                required
              />
            </label>
            {output && (
              <pre className={`git-commit-dialog__output git-commit-dialog__output--${status}`}>
                {output}
              </pre>
            )}
            <div className="git-commit-dialog__actions">
              <button
                type="button"
                className="git-commit-dialog__btn git-commit-dialog__btn--cancel"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="git-commit-dialog__btn git-commit-dialog__btn--submit"
                disabled={!remoteUrl.trim() || status === "loading"}
              >
                {status === "loading" ? "Initialising…" : "Initialise Repo"}
              </button>
            </div>
          </form>
        )}

        {step === "identity" && (
          <form onSubmit={handleIdentitySubmit} className="git-commit-dialog__form">
            <p className="git-commit-dialog__hint">
              Set your git identity once — saved in your browser only.
            </p>
            <label className="git-commit-dialog__label">
              Name
              <input
                ref={firstInputRef}
                className="git-commit-dialog__input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name"
                required
              />
            </label>
            <label className="git-commit-dialog__label">
              Email
              <input
                className="git-commit-dialog__input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <div className="git-commit-dialog__actions">
              <button
                type="button"
                className="git-commit-dialog__btn git-commit-dialog__btn--cancel"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="git-commit-dialog__btn git-commit-dialog__btn--submit"
                disabled={!name.trim() || !email.trim()}
              >
                Next
              </button>
            </div>
          </form>
        )}

        {step === "commit" && (
          <>
            {currentRemote && (
              <div className="git-commit-dialog__remote">
                <span>{currentRemote}</span>
                <button
                  className="git-commit-dialog__edit-identity"
                  onClick={() => {
                    setStatus("idle");
                    setOutput("");
                    setStep("repo");
                  }}
                >
                  Change
                </button>
              </div>
            )}

            <div className="git-commit-dialog__identity">
              <span>
                Committing as <strong>{name}</strong> &lt;{email}&gt;
              </span>
              <button
                className="git-commit-dialog__edit-identity"
                onClick={() => {
                  setStatus("idle");
                  setOutput("");
                  setStep("identity");
                }}
              >
                Edit
              </button>
            </div>

            <label className="git-commit-dialog__label">
              Commit message
              <input
                ref={firstInputRef}
                className="git-commit-dialog__input"
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={status === "loading"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCommit();
                }}
              />
            </label>

            {output && (
              <pre
                className={`git-commit-dialog__output git-commit-dialog__output--${status}`}
              >
                {output}
              </pre>
            )}

            <div className="git-commit-dialog__actions">
              <button
                className="git-commit-dialog__btn git-commit-dialog__btn--cancel"
                onClick={onClose}
              >
                {status === "success" ? "Close" : "Cancel"}
              </button>
              {status !== "success" && (
                <button
                  className="git-commit-dialog__btn git-commit-dialog__btn--submit"
                  onClick={handleCommit}
                  disabled={!message.trim() || status === "loading"}
                >
                  {status === "loading" ? "Pushing…" : "Commit & Push"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
