#!/usr/bin/env python3
"""Poll trusted main commits and install only their successful push CI revisions."""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlencode


SHA = re.compile(r"[0-9a-f]{40}")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
WORKFLOW = re.compile(r"[A-Za-z0-9_-]+\.ya?ml")


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


def load_config(path: Path) -> Config:
    raw = json.loads(path.read_text())
    required = {"repository", "source", "checkout", "state_dir", "music_dir",
                "emoji_dir", "frontend_env", "workflows"}
    if not isinstance(raw, dict) or set(raw) != required:
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
    return Config(repository=raw["repository"], workflows=tuple(workflows), **paths)


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


def read_state(config: Config) -> dict:
    path = config.state_dir / "state.json"
    state = json.loads(path.read_text()) if path.exists() else {}
    keys = {"last_success_sha", "failed_build_sha", "installing_sha"}
    if (not isinstance(state, dict) or not set(state).issubset(keys)
            or any(not isinstance(value, str) or not SHA.fullmatch(value) for value in state.values())):
        raise ValueError("Invalid deployment state; inspect it before recovery.")
    return state


def save_state(config: Config, state: dict) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".state-", dir=config.state_dir)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(state, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, config.state_dir / "state.json")
        descriptor = os.open(config.state_dir, os.O_RDONLY | os.O_DIRECTORY)
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
    subprocess.run(["npm", "exec", "--yes", f"--package=node@{version}", "--",
                    "bash", "deploy/build.sh"], cwd=config.checkout, stdin=subprocess.DEVNULL, check=True)


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
    # CI may have been rerun while building; API failures must remain retryable.
    if not ci_success(config, sha):
        return
    state.pop("failed_build_sha", None)
    state["installing_sha"] = sha
    save_state(config, state)
    install_checkout(config)
    state.pop("installing_sha")
    state["last_success_sha"] = sha
    save_state(config, state)
    print(f"Successfully deployed {sha}.", flush=True)


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
