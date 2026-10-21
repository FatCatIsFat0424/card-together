#!/usr/bin/env python3
"""Run a command with the pinned, checksum-verified official Node.js distribution."""

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener


ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
ARCHITECTURES = {"x86_64": "x64", "aarch64": "arm64"}


class OfficialRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        target = urlsplit(new_url)
        if target.scheme != "https" or target.netloc != "nodejs.org":
            raise ValueError("Node.js download redirected outside the official HTTPS origin.")
        return super().redirect_request(request, response, code, message, headers, new_url)


def distribution_name(version: str) -> str:
    if not VERSION.fullmatch(version):
        raise ValueError("Invalid pinned Node.js version.")
    architecture = ARCHITECTURES.get(platform.machine())
    if platform.system() != "Linux" or architecture is None:
        raise ValueError("Official Node.js bootstrap supports Linux x64 and arm64 only.")
    return f"node-v{version}-linux-{architecture}"


def download(url: str, destination: Path) -> None:
    opener = build_opener(OfficialRedirectHandler())
    with opener.open(url, timeout=60) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def verify_archive(archive: Path, manifest: Path) -> None:
    matches = [parts[0] for line in manifest.read_text(encoding="utf-8").splitlines()
               if len(parts := line.split()) == 2 and parts[1] == archive.name]
    if len(matches) != 1 or not re.fullmatch(r"[0-9a-f]{64}", matches[0]):
        raise ValueError("Official SHA-256 manifest has no unique checksum for this archive.")
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != matches[0]:
        raise ValueError("Official Node.js archive SHA-256 mismatch.")


def extract_runtime(archive: Path, directory: Path, name: str) -> Path:
    runtime = directory / name
    with tarfile.open(archive, "r:xz") as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != name:
                raise ValueError("Node.js archive contains an unexpected member path.")
        source.extractall(directory, filter="data")
    for executable in (runtime / "bin/node", runtime / "bin/npm"):
        if (not executable.resolve().is_relative_to(runtime) or not executable.is_file()
                or not os.access(executable, os.X_OK)):
            raise ValueError("Official Node.js distribution is missing a safe executable.")
    return runtime


def run_command(root: Path, command: list[str]) -> int:
    if sys.version_info < (3, 12):
        raise ValueError("Official Node.js bootstrap requires Python 3.12 or newer.")
    if os.geteuid() == 0:
        raise ValueError("Run Node.js commands as the deployment user, not root.")
    if not command:
        raise ValueError("Provide a command after --.")
    version = (root / ".node-version").read_text().strip()
    name = distribution_name(version)
    with tempfile.TemporaryDirectory(prefix="card-together-node-") as temporary:
        directory = Path(temporary)
        archive = directory / f"{name}.tar.xz"
        manifest = directory / "SHASUMS256.txt"
        base = f"https://nodejs.org/dist/v{version}"
        print(f"Downloading official Node.js {version} ({name}).", flush=True)
        download(f"{base}/SHASUMS256.txt", manifest)
        download(f"{base}/{archive.name}", archive)
        verify_archive(archive, manifest)
        runtime = extract_runtime(archive, directory, name)
        environment = {**os.environ, "PATH": f"{runtime / 'bin'}:{os.environ.get('PATH', os.defpath)}"}
        actual = subprocess.run([str(runtime / "bin/node"), "-p", "process.versions.node"],
                                check=True, capture_output=True, text=True).stdout.strip()
        if actual != version:
            raise ValueError("Downloaded Node.js does not match the pinned version.")
        print(f"Verified official Node.js {version}; running {command[0]}.", flush=True)
        result = subprocess.run(command, cwd=root, env=environment)
        return result.returncode if result.returncode >= 0 else 128 - result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    arguments = parser.parse_args()
    command = arguments.command
    if command and command[0] == "--":
        command = command[1:]
    try:
        return run_command(ROOT, command)
    except (OSError, ValueError, URLError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f"Node.js bootstrap failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
