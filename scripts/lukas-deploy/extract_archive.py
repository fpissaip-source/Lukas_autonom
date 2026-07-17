#!/usr/bin/env python3
"""
extract_archive.py — Parse the LUKAS system code archive and reconstruct all files.

The archive format is:
  ================================================================================
  FILE: /root/Agent-spy/path/to/file.py
  ================================================================================
     1 | line content
     2 | line content
  ...

Usage:
  python3 extract_archive.py <archive_path> <output_dir>
"""
import os
import re
import sys

def extract(archive_path: str, out_dir: str) -> list[str]:
    sep = "=" * 80

    with open(archive_path, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    files_found: list[str] = []
    current_file: str | None = None
    current_lines: list[str] = []

    def save_file(path: str, content_lines: list[str]) -> None:
        cleaned = []
        for l in content_lines:
            m = re.match(r'^\s*\d+\s\|\s?(.*)', l)
            if m:
                cleaned.append(m.group(1))
            else:
                cleaned.append(l.rstrip('\n'))
        full_path = out_dir + path
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(cleaned))

    i = 0
    while i < len(lines):
        line = lines[i].rstrip('\n')
        if line == sep and i + 1 < len(lines) and lines[i + 1].startswith("FILE:"):
            if current_file and current_lines:
                save_file(current_file, current_lines)
                files_found.append(current_file)
            current_file = lines[i + 1].strip()[5:].strip()
            current_lines = []
            i += 3
            continue
        if current_file is not None:
            current_lines.append(line)
        i += 1

    if current_file and current_lines:
        save_file(current_file, current_lines)
        files_found.append(current_file)

    return files_found


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <archive_path> <output_dir>")
        sys.exit(1)

    archive = sys.argv[1]
    outdir = sys.argv[2]

    files = extract(archive, outdir)
    print(f"Extracted {len(files)} files to {outdir}")
    for f in files:
        print(f"  {f}")
