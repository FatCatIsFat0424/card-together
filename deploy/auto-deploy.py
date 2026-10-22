#!/usr/bin/env python3
"""Poll trusted main commits and install only their successful push CI revisions."""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


SHA = re.compile(r"[0-9a-f]{40}")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
WORKFLOW = re.compile(r"[A-Za-z0-9_-]+\.ya?ml")
RELAY_PATH = re.compile(r"/notifications/[a-z0-9][a-z0-9-]{0,63}")
LOOPBACK = {"127.0.0.1", "::1", "localhost"}
LISTED_COMMITS = 10
THREAD_KEY = re.compile(r"[A-Za-z0-9._-]{1,100}")
PENDING_NOTIFICATIONS = "notifications.json"
# Undelivered updates are resent each cycle until the relay accepts them or they go stale.
PENDING_TTL_SECONDS = 3600


@dataclass(frozen=True)
class Notification:
    url: str
    key_file: Path


@dataclass(frozen=True)
class Config:
    repository: str
    source: Path
    checkout: Path
    state_dir: Path
    music_dir: Path
    emoji_dir: Path
    frontend_env: Path | None
    workflows: tuple[str, ...]
    notification: Notification | None = None


def load_notification(raw: object) -> Notification | None:
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) != {"url", "key_file"}:
        raise ValueError("notification must be null or contain url and key_file.")
    url = raw["url"]
    parts = urlsplit(url) if isinstance(url, str) else None
    if (not parts or not RELAY_PATH.fullmatch(parts.path) or parts.query or parts.fragment
            or parts.username or parts.password
            or not (parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOOPBACK))):
        raise ValueError("notification.url must be a relay route URL; plain HTTP is allowed only on loopback.")
    key_file = raw["key_file"]
    if not isinstance(key_file, str) or not Path(key_file).is_absolute() or Path(key_file).resolve() != Path(key_file):
        raise ValueError("notification.key_file must be a canonical absolute path.")
    return Notification(url, Path(key_file))


def load_config(path: Path) -> Config:
    raw = json.loads(path.read_text())
    required = {"repository", "source", "checkout", "state_dir", "music_dir",
                "emoji_dir", "frontend_env", "workflows"}
    if not isinstance(raw, dict) or not required <= set(raw) <= required | {"notification"}:
        raise ValueError("Configuration must contain exactly the documented keys.")
    if not isinstance(raw["repository"], str) or not REPOSITORY.fullmatch(raw["repository"]):
        raise ValueError("repository must be a GitHub owner/repository name.")
    paths = {}
    for key in ("source", "checkout", "state_dir", "music_dir", "emoji_dir", "frontend_env"):
        value = raw[key]
        if key == "frontend_env" and value is None:
            paths[key] = None
            continue
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise ValueError(f"{key} must be an absolute path.")
        candidate = Path(value)
        if candidate.resolve() != candidate:
            raise ValueError(f"{key} must be a canonical path without symlinks.")
        paths[key] = candidate
    source, checkout = paths["source"], paths["checkout"]
    if source == checkout or source in checkout.parents or checkout in source.parents:
        raise ValueError("Development and deployment checkouts must be separate directories.")
    for key in ("state_dir", "music_dir", "emoji_dir"):
        candidate = paths[key]
        if candidate == checkout or checkout in candidate.parents:
            raise ValueError(f"{key} must be outside the deployment checkout.")
    workflows = raw["workflows"]
    if (not isinstance(workflows, list) or not workflows
            or any(not isinstance(value, str) or not WORKFLOW.fullmatch(value) for value in workflows)
            or len(set(workflows)) != len(workflows)):
        raise ValueError("workflows must be a nonempty list of unique workflow filenames.")
    return Config(repository=raw["repository"], workflows=tuple(workflows),
                  notification=load_notification(raw.get("notification")), **paths)


def output(args: list[str], *, cwd: Path | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=120)
    if result.returncode:
        # Tool output can include credential-bearing URLs; keep errors free of it.
        raise RuntimeError(f"{Path(args[0]).name} failed (exit {result.returncode}). Check authentication and logs.")
    return result.stdout.strip()


def git(directory: Path, *args: str) -> str:
    return output(["git", "-C", str(directory), *args])


def target_sha(config: Config) -> str:
    remote = git(config.source, "remote", "get-url", "origin")
    allowed = {f"git@github.com:{config.repository}.git", f"git@github.com:{config.repository}",
               f"https://github.com/{config.repository}.git", f"https://github.com/{config.repository}"}
    if remote not in allowed:
        raise ValueError("origin must match the configured GitHub repository without embedded credentials.")
    git(config.source, "fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main")
    sha = git(config.source, "rev-parse", "refs/remotes/origin/main^{commit}")
    if not SHA.fullmatch(sha):
        raise ValueError("Remote main did not resolve to a commit SHA.")
    return sha


def ci_success(config: Config, sha: str) -> bool:
    query = urlencode({"branch": "main", "event": "push", "head_sha": sha, "per_page": 100})
    endpoint = f"repos/{config.repository}/actions/runs?{query}"
    pages = json.loads(output(["gh", "api", "--paginate", "--slurp", endpoint]))
    if not isinstance(pages, list) or not pages:
        raise ValueError("Invalid GitHub workflow response.")
    workflows = {f".github/workflows/{name}": [] for name in config.workflows}
    count = 0
    for page in pages:
        if (not isinstance(page, dict) or not isinstance(page.get("workflow_runs"), list)
                or type(page.get("total_count")) is not int or page["total_count"] > 1000):
            raise ValueError("Invalid GitHub workflow response.")
        for run in page["workflow_runs"]:
            if (not isinstance(run, dict)
                    or run.get("head_sha") != sha or run.get("head_branch") != "main"
                    or run.get("event") != "push" or not isinstance(run.get("path"), str)
                    or not re.fullmatch(r"\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml", run["path"])
                    or any(type(run.get(key)) is not int or run[key] < 1
                           for key in ("id", "run_number", "run_attempt"))):
                raise ValueError("GitHub returned an unexpected workflow revision.")
            workflows.setdefault(run["path"], []).append(run)
            count += 1
    if count != pages[0]["total_count"]:
        raise ValueError("Incomplete GitHub workflow response; wait for a consistent query.")
    for workflow, runs in workflows.items():
        if not runs:
            print(f"Waiting for {workflow}: no push CI for {sha}.", flush=True)
            return False
        latest = max(runs, key=lambda run: (run["run_number"], run["id"], run["run_attempt"]))
        if latest.get("status") != "completed" or latest.get("conclusion") != "success":
            print(f"Waiting for {workflow}: latest run is not successful for {sha}.", flush=True)
            return False
    return True


def read_key(notification: Notification) -> str:
    key = notification.key_file.read_text().strip()
    if len(key) < 32 or any(character.isspace() for character in key):
        raise ValueError("Notification key must be one token of at least 32 characters.")
    return key


def relay_request(notification: Notification, key: str, body: dict) -> None:
    request = Request(f"{notification.url}/{key}", data=json.dumps(body).encode(), method="PUT", headers={
        "Authorization": f"Bearer {read_key(notification)}",
        "Content-Type": "application/json",
    })
    with urlopen(request, timeout=10):
        pass


def deliver(notification: Notification, key: str, body: dict) -> bool:
    try:
        relay_request(notification, key, body)
        return True
    except (OSError, ValueError) as error:
        # Errors never contain the key; keep only the error class and status.
        detail = f" (HTTP {error.code})" if isinstance(error, HTTPError) else ""
        print(f"Deployment notification failed: {type(error).__name__}{detail}.", file=sys.stderr, flush=True)
        return False


def read_pending(state_dir: Path) -> dict[str, dict]:
    """Latest undelivered body per notification thread; a damaged file only loses retries."""
    path = state_dir / PENDING_NOTIFICATIONS
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        print("Ignoring unreadable pending notifications.", file=sys.stderr, flush=True)
        return {}
    if not isinstance(raw, dict):
        return {}
    return {key: entry for key, entry in raw.items()
            if isinstance(key, str) and THREAD_KEY.fullmatch(key) and isinstance(entry, dict)
            and set(entry) == {"body", "since"} and isinstance(entry["body"], dict)
            and isinstance(entry["since"], (int, float))}


def write_pending(state_dir: Path, pending: dict[str, dict]) -> None:
    if pending:
        write_json(state_dir, PENDING_NOTIFICATIONS, pending)
    else:
        (state_dir / PENDING_NOTIFICATIONS).unlink(missing_ok=True)


def flush_pending(config: Config) -> None:
    """Resend updates the relay missed, such as while konata restarted mid-deployment."""
    if not config.notification:
        return
    pending = read_pending(config.state_dir)
    if not pending:
        return
    now = time.time()
    for key, entry in sorted(pending.items(), key=lambda item: item[1]["since"]):
        if now - entry["since"] > PENDING_TTL_SECONDS:
            print(f"Dropped stale deployment notification {key}.", file=sys.stderr, flush=True)
            del pending[key]
        elif deliver(config.notification, key, entry["body"]):
            print(f"Resent deployment notification {key}.", flush=True)
            del pending[key]
    try:
        write_pending(config.state_dir, pending)
    except OSError as error:
        print(f"Pending notifications not saved: {type(error).__name__}.", file=sys.stderr, flush=True)


STAGES = (("build", "建置與發布檢查"), ("verify", "重新確認 CI"), ("install", "安裝與健康檢查"))
FAILURES = {
    "build": "建置失敗，此版本已封鎖。修正後執行 `--retry-build`，或等待新的 commit。",
    "verify": "無法確認 CI 結果，下一輪會重新檢查。",
    "install": "安裝失敗，自動部署已暫停。依部署文件復原後執行 `--resume`。",
}


@dataclass
class DeployReport:
    """One relay notification per deployment attempt, updated as stages progress."""
    notification: Notification | None
    repository: str
    sha: str
    commits: list[str]
    key: str = ""
    started: float = field(default_factory=time.monotonic)
    started_at: str = field(default_factory=lambda: datetime.now().strftime("%H:%M"))
    stage: str = "build"
    status: str = "running"
    outcome: str | None = None
    pending_dir: Path | None = None

    def __post_init__(self) -> None:
        self.key = self.key or f"{self.sha[:12]}-{int(time.time())}"

    def payload(self) -> dict:
        current = [key for key, _ in STAGES].index(self.stage)
        stages = [{"label": "CI 通過", "state": "done"}]
        for index, (_, label) in enumerate(STAGES):
            if index < current or (index == current and self.status == "succeeded"):
                state = "done"
            elif index == current:
                state = {"running": "running", "cancelled": "skipped"}.get(self.status, "failed")
            else:
                state = "pending"
            stages.append({"label": label, "state": state})
        body = {
            "title": f"Card Together 自動部署 {self.sha[:7]}",
            "url": f"https://github.com/{self.repository}/commit/{self.sha}",
            "stages": stages,
            "status": self.status,
            "summary": self.outcome or f"{self.started_at} 開始",
            # Resends keep this time so the relay can mark late deliveries.
            "occurredAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }
        if self.commits:
            body["description"] = "\n".join(f"- {subject}" for subject in self.commits)[:3000]
        return body

    def advance(self, stage: str) -> None:
        self.stage = stage
        self.publish()

    def finish(self, status: str, outcome: str) -> None:
        self.status, self.outcome = status, outcome
        self.publish()

    def succeed(self) -> None:
        minutes, seconds = divmod(round(time.monotonic() - self.started), 60)
        self.finish("succeeded", f"部署成功，耗時 {minutes} 分 {seconds} 秒。")

    def fail(self) -> None:
        self.finish("failed", FAILURES[self.stage])

    def publish(self) -> None:
        """Best effort: a notification problem must never change deployment results."""
        if not self.notification:
            return
        body = self.payload()
        delivered = deliver(self.notification, self.key, body)
        if not self.pending_dir:
            return
        try:
            pending = read_pending(self.pending_dir)
            if delivered:
                if pending.pop(self.key, None) is None:
                    return
            else:
                since = pending.get(self.key, {}).get("since", time.time())
                pending[self.key] = {"body": body, "since": since}
            write_pending(self.pending_dir, pending)
        except OSError as error:
            print(f"Pending notifications not saved: {type(error).__name__}.", file=sys.stderr, flush=True)


def pending_commits(config: Config, state: dict, sha: str) -> list[str]:
    try:
        if state.get("last_success_sha"):
            subjects = git(config.source, "log", "--format=%s", f"-{LISTED_COMMITS + 1}",
                           f"{state['last_success_sha']}..{sha}").splitlines()
        else:
            subjects = [git(config.source, "log", "--format=%s", "-1", sha)]
    except (RuntimeError, subprocess.SubprocessError):
        return []
    if len(subjects) > LISTED_COMMITS:
        subjects = [*subjects[:LISTED_COMMITS], "…以及更早的 commit"]
    return subjects


def read_state(config: Config) -> dict:
    path = config.state_dir / "state.json"
    state = json.loads(path.read_text()) if path.exists() else {}
    keys = {"last_success_sha", "failed_build_sha", "installing_sha"}
    if (not isinstance(state, dict) or not set(state).issubset(keys)
            or any(not isinstance(value, str) or not SHA.fullmatch(value) for value in state.values())):
        raise ValueError("Invalid deployment state; inspect it before recovery.")
    return state


def save_state(config: Config, state: dict) -> None:
    write_json(config.state_dir, "state.json", state)


def write_json(directory: Path, name: str, value: dict) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".state-", dir=directory)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / name)
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def cycle_lock(config: Config):
    with (config.state_dir / "cycle.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        yield True


def validate_worktree(config: Config) -> None:
    if git(config.checkout, "rev-parse", "--show-toplevel") != str(config.checkout):
        raise ValueError("Deployment path is not a worktree root.")
    if (git(config.source, "rev-parse", "--path-format=absolute", "--git-common-dir")
            != git(config.checkout, "rev-parse", "--path-format=absolute", "--git-common-dir")):
        raise ValueError("Deployment worktree is not linked to the configured source repository.")
    if git(config.checkout, "rev-parse", "--abbrev-ref", "HEAD") != "HEAD":
        raise ValueError("Deployment worktree must have a detached HEAD.")
    if git(config.checkout, "status", "--porcelain", "--untracked-files=normal"):
        raise ValueError("Deployment worktree has local changes; inspect rather than overwrite them.")


def validate_inputs(config: Config) -> None:
    for source in (config.music_dir, config.emoji_dir):
        if not source.is_dir() or source.is_symlink():
            raise ValueError("Both owner input directories must exist, even when intentionally empty.")
        for path in source.rglob("*"):
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise ValueError("Owner inputs must contain only regular files and directories.")
    if config.frontend_env and (config.frontend_env.is_symlink() or not config.frontend_env.is_file()):
        raise ValueError("Configured frontend environment must be a regular file.")


def prepare_checkout(config: Config, sha: str) -> None:
    validate_inputs(config)
    if not config.checkout.exists():
        git(config.source, "worktree", "add", "--detach", str(config.checkout), sha)
    validate_worktree(config)
    git(config.checkout, "checkout", "--detach", sha)
    for source, name in ((config.music_dir, "local-music"), (config.emoji_dir, "local-emoji")):
        destination = config.checkout / name
        if git(config.checkout, "ls-files", "--", name):
            raise ValueError("Owner input destinations must remain Git-ignored.")
        if destination.is_symlink():
            raise ValueError("Owner input destination cannot be a symlink.")
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination)
    destination = config.checkout / "client/.env.local"
    if git(config.checkout, "ls-files", "--", "client/.env.local") or destination.is_symlink():
        raise ValueError("Frontend settings must be an untracked regular file.")
    if config.frontend_env:
        shutil.copyfile(config.frontend_env, destination)
        destination.chmod(0o600)
    elif destination.exists():
        destination.unlink()


def build_checkout(config: Config) -> None:
    version = (config.checkout / ".node-version").read_text().strip()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Invalid pinned Node.js version.")
    subprocess.run([sys.executable, "-B", "deploy/with-node.py", "--", "bash", "deploy/build.sh"],
                   cwd=config.checkout, stdin=subprocess.DEVNULL, check=True)


def install_checkout(config: Config) -> None:
    subprocess.run(["sudo", "-n", "/usr/bin/bash", str(config.checkout / "deploy/deploy.sh")],
                   cwd=config.checkout, stdin=subprocess.DEVNULL, check=True)


def poll(config: Config, *, inspect: bool = False) -> None:
    state = read_state(config)
    if inspect:
        validate_inputs(config)
        if config.checkout.exists():
            validate_worktree(config)
    if state.get("installing_sha"):
        print(f"Automatic deployment halted at {state['installing_sha']}; recover before --resume.", flush=True)
        return
    sha = target_sha(config)
    if state.get("last_success_sha") == sha:
        print(f"Already deployed {sha}.", flush=True)
        return
    if state.get("failed_build_sha") == sha and not inspect:
        print(f"Build blocked for {sha}; fix inputs and use --retry-build, or wait for a newer commit.", flush=True)
        return
    if not ci_success(config, sha):
        return
    if inspect:
        print(f"Eligible commit: {sha}. Inspection does not build or install.", flush=True)
        return
    report = DeployReport(config.notification, config.repository, sha, pending_commits(config, state, sha),
                          pending_dir=config.state_dir)
    report.publish()
    try:
        deploy(config, state, sha, report)
    except BaseException:
        report.fail()
        raise


def deploy(config: Config, state: dict, sha: str, report: DeployReport) -> None:
    try:
        prepare_checkout(config, sha)
        print(f"Building approved commit {sha}.", flush=True)
        build_checkout(config)
        validate_worktree(config)
        if git(config.checkout, "rev-parse", "HEAD") != sha:
            raise ValueError("Deployment revision changed during build.")
    except Exception:
        state["failed_build_sha"] = sha
        save_state(config, state)
        raise
    report.advance("verify")
    # CI may have been rerun while building; API failures must remain retryable.
    if not ci_success(config, sha):
        report.finish("cancelled", "CI 在建置期間有變動，下一輪會重新檢查。")
        return
    state.pop("failed_build_sha", None)
    state["installing_sha"] = sha
    save_state(config, state)
    report.advance("install")
    install_checkout(config)
    state.pop("installing_sha")
    state["last_success_sha"] = sha
    save_state(config, state)
    print(f"Successfully deployed {sha}.", flush=True)
    report.succeed()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("/etc/card-together-auto-deploy.json"))
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--inspect", action="store_true", help="Fetch and check CI without building or deploying")
    action.add_argument("--retry-build", action="store_true", help="Clear the failed-build block without deploying")
    action.add_argument("--resume", action="store_true", help="Clear the install halt only after operator recovery")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        config = load_config(args.config)
        with cycle_lock(config) as acquired:
            if not acquired:
                print("Another automatic deployment cycle is running.", flush=True)
                return 0
            if not args.inspect:
                flush_pending(config)
            if args.retry_build or args.resume:
                state = read_state(config)
                state.pop("failed_build_sha" if args.retry_build else "installing_sha", None)
                save_state(config, state)
                print("Block cleared; no deployment performed.", flush=True)
            else:
                poll(config, inspect=args.inspect)
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Automatic deployment failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
