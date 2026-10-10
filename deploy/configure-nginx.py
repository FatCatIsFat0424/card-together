#!/usr/bin/env python3
"""Prepare a narrowly scoped nginx site candidate without modifying the input."""

import argparse
from pathlib import Path
import sys
from dataclasses import dataclass

HOST = "acserver.csie.org"
SNIPPET = "/etc/nginx/snippets/card-together.conf"
MARKER = "# Card Together managed route"
BLOCKS = {
    protocol: "\n" + MARKER + f" BEGIN {protocol}\n"
    f"    include /etc/nginx/snippets/{filename};\n"
    + MARKER + f" END {protocol}\n"
    for protocol, filename in (
        ("http", "card-together-http.conf"), ("https", "card-together.conf")
    )
}


@dataclass
class Directive:
    words: list[str]
    children: list | None
    start: int
    end: int


def tokenize(source: str) -> list[tuple[str, int, bool]]:
    """Keep syntax tokens separate from quoted and escaped argument content."""
    tokens = []
    index = 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if char == "#":
            end = source.find("\n", index)
            index = len(source) if end == -1 else end + 1
            continue
        if char in "{};":
            tokens.append((char, index, True))
            index += 1
            continue
        start = index
        value = ""
        quote = None
        while index < len(source):
            char = source[index]
            if char == "\\":
                if index + 1 >= len(source):
                    raise ValueError("Trailing escape in nginx configuration")
                value += source[index + 1]
                index += 2
                continue
            if quote:
                if char == quote:
                    quote = None
                else:
                    value += char
                index += 1
                continue
            if char in "\"'":
                quote = char
                index += 1
                continue
            if source.startswith("${", index):
                end = source.find("}", index + 2)
                if end == -1:
                    raise ValueError("Unterminated nginx variable")
                value += source[index:end + 1]
                index = end + 1
                continue
            if char.isspace() or char in "{};#":
                break
            value += char
            index += 1
        if quote:
            raise ValueError("Unterminated quote in nginx configuration")
        tokens.append((value, start, False))
    return tokens


def parse(source: str) -> list[Directive]:
    tokens = tokenize(source)
    index = 0

    def level(nested: bool) -> tuple[list[Directive], int]:
        nonlocal index
        result = []
        words = []
        start = 0
        while index < len(tokens):
            value, position, syntax = tokens[index]
            index += 1
            if not syntax:
                if not words:
                    start = position
                words.append(value)
            elif value == "}":
                if words or not nested:
                    raise ValueError("Unexpected closing brace or missing semicolon")
                return result, position
            elif value in ("{", ";"):
                if not words:
                    raise ValueError("Directive name is missing")
                children, end = level(True) if value == "{" else (None, position)
                result.append(Directive(words, children, start, end))
                words = []
        if nested or words:
            raise ValueError("Unclosed block or missing semicolon")
        return result, len(source)

    return level(False)[0]


def walk(nodes: list[Directive]):
    for node in nodes:
        yield node
        if node.children is not None:
            yield from walk(node.children)


def configure(source: str) -> str:
    # Only recognize exact generated blocks; never erase manually edited content.
    original = source
    managed = {}
    for protocol, block in BLOCKS.items():
        if source.count(block) > 1:
            raise ValueError(f"Duplicate managed {protocol} block")
        managed[protocol] = block if block in source else None
        source = source.replace(block, "")
    if MARKER in source:
        raise ValueError("Unrecognized or modified managed application block")
    servers = {}
    for node in walk(parse(source)):
        if node.words != ["server"] or node.children is None:
            continue
        names = [child for child in node.children if child.words[0] == "server_name"]
        if not any(HOST in child.words[1:] for child in names):
            continue
        protocols = set()
        for child in node.children:
            if child.words[0] == "listen":
                address = child.words[1] if len(child.words) > 1 else ""
                port = address.rsplit(":", 1)[-1]
                if port == "80" and "ssl" not in child.words:
                    protocols.add("http")
                elif port == "443" and "ssl" in child.words:
                    protocols.add("https")
                else:
                    raise ValueError(f"Unsupported listen directive for {HOST}")
        if len(protocols) != 1:
            raise ValueError(f"Ambiguous protocol for {HOST}")
        protocol = protocols.pop()
        if protocol in servers:
            raise ValueError(f"Multiple {protocol} server blocks for {HOST}")
        for child in walk(node.children):
            if child.words[0] == "location" and any(
                "card-together" in word for word in child.words[1:]
            ):
                raise ValueError("Unmanaged conflicting application location")
            if child.words[0] == "include" and any(
                "card-together" in word for word in child.words[1:]
            ):
                raise ValueError("Unmanaged conflicting application include")
        servers[protocol] = node
    if set(servers) != set(BLOCKS):
        raise ValueError(f"Expected one HTTP and one HTTPS server for {HOST}")
    original_nodes = list(walk(parse(original)))
    for protocol, block in managed.items():
        if block is None:
            continue
        position = original.index(block)
        owners = [node for node in original_nodes if node.words == ["server"]
                  and node.children is not None and node.start < position < node.end]
        nested = any(node.children is not None and node.words != ["server"]
                     and node.start < position < node.end for node in original_nodes)
        if nested or len(owners) != 1 or not any(
            child.words[0] == "server_name" and HOST in child.words[1:]
            for child in owners[0].children
        ) or not any(
            child.words[0] == "listen" and
            ("ssl" in child.words) == (protocol == "https")
            for child in owners[0].children
        ):
            raise ValueError("Managed block belongs to the wrong server")
    for protocol, node in sorted(servers.items(), key=lambda pair: pair[1].end, reverse=True):
        source = source[:node.end] + BLOCKS[protocol] + source[node.end:]
    return source


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if (args.input.resolve() == args.output.resolve() or
                (args.output.exists() and args.input.samefile(args.output))):
            raise ValueError("Input and candidate output must be different files")
        with args.input.open(encoding="utf-8", newline="") as stream:
            candidate = configure(stream.read())
        with args.output.open("w", encoding="utf-8", newline="") as stream:
            stream.write(candidate)
    except (OSError, ValueError) as error:
        print(f"configure-nginx: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
