#!/usr/bin/env python3
"""
patcher.py – Lukas verbessert sich selbst.
Wird von run.sh nach jeder Session aufgerufen.
Liest self_improvement.json (geschrieben von agent.py) und:
  - patcht bestehende Dateien (action: "patch")
  - erstellt neue Python-Module (action: "create")
Erlaubte Dateien: agent.py, patcher.py, soul.md, telegram_bot.py
"""
import json
import os
import subprocess
import urllib.request
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
ALLOWED_FILES = {"agent.py", "patcher.py", "soul.md", "telegram_bot.py", "tools.py"}
PATCH_LOG = BASE_DIR / "patches.md"
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")


def send_telegram(message):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    body = json.dumps({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML"
    }).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            pass
    except Exception as e:
        print(f"  [Patcher/Telegram] Error: {e}")


def write_repair_needed(filename, description, old_code, new_code, error_type, error_msg):
    """Write repair_needed.json so Lukas sees the failure on next wake and can fix it."""
    repair = {
        "file": filename,
        "description": description,
        "old_code": old_code,
        "new_code": new_code,
        "error_type": error_type,
        "error_msg": error_msg,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    repair_path = BASE_DIR / "repair_needed.json"
    try:
        repair_path.write_text(json.dumps(repair, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"  [Patcher] Could not write repair_needed.json: {e}")


def log_patch(filename, description, old_snippet, new_snippet, success, reason=""):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    status = "✓ APPLIED" if success else f"✗ FAILED ({reason})"
    with open(PATCH_LOG, "a") as f:
        f.write(f"\n## [{now}] {filename} – {status}\n")
        f.write(f"**Reason:** {description}\n\n")
        if old_snippet:
            f.write(f"```diff\n- {old_snippet[:200]}\n+ {new_snippet[:200]}\n```\n")
        else:
            f.write(f"```\n{new_snippet[:200]}\n```\n")


def apply_patch(patch):
    filename = patch.get("file", "").strip()
    description = patch.get("description", "")
    old_code = patch.get("old_code", "")
    new_code = patch.get("new_code", "")

    if filename not in ALLOWED_FILES:
        msg = f"BLOCKED: {filename} not in allowed files"
        print(f"  [Patcher] {msg}")
        send_telegram(f"🚫 <b>Patch blockiert:</b> {filename}\n{msg}")
        return False

    if not old_code or not new_code:
        print(f"  [Patcher] SKIP: empty old_code or new_code in {filename}")
        return False

    filepath = BASE_DIR / filename
    if not filepath.exists():
        print(f"  [Patcher] SKIP: {filename} not found")
        return False

    content = filepath.read_text(errors="replace")

    if old_code not in content:
        reason = "old_code not found in file"
        print(f"  [Patcher] SKIP: {reason} ({filename})")
        print(f"    Looking for: {old_code[:80]}...")
        log_patch(filename, description, old_code, new_code, False, reason)
        send_telegram(
            f"⚠️ <b>Patch fehlgeschlagen:</b> {filename}\n"
            f"Grund: old_code nicht gefunden\n"
            f"<i>{description[:120]}</i>"
        )
        write_repair_needed(filename, description, old_code, new_code, "old_code_not_found",
                            f"The exact old_code was not found in {filename}. It may have changed since you wrote the patch.")
        return False

    # Backup before patching
    backup = filepath.with_suffix(filepath.suffix + ".prepatch")
    backup.write_text(content)

    # Apply patch
    new_content = content.replace(old_code, new_code, 1)
    filepath.write_text(new_content)

    # Validate syntax if Python
    if filename.endswith(".py"):
        result = subprocess.run(
            ["python3", "-m", "py_compile", str(filepath)],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            reason = result.stderr.strip()[:200]
            print(f"  [Patcher] SYNTAX ERROR – reverting: {reason}")
            filepath.write_text(content)
            backup.unlink(missing_ok=True)
            log_patch(filename, description, old_code, new_code, False, f"syntax error: {reason}")
            send_telegram(
                f"❌ <b>Patch zurückgerollt:</b> {filename}\n"
                f"Syntaxfehler: <code>{reason[:200]}</code>\n"
                f"<i>{description[:120]}</i>"
            )
            write_repair_needed(filename, description, old_code, new_code, "syntax_error", reason)
            return False
        backup.unlink(missing_ok=True)

    log_patch(filename, description, old_code, new_code, True)
    print(f"  [Patcher] ✓ Patched {filename}: {description[:80]}")
    send_telegram(
        f"✅ <b>Patch angewandt:</b> {filename}\n"
        f"<i>{description[:200]}</i>"
    )
    return True


def create_file(patch):
    filename = patch.get("file", "").strip()
    description = patch.get("description", "")
    content = patch.get("content", "")

    # Safety: only Python files, no path traversal
    if not filename.endswith(".py"):
        msg = "create_file: only .py files allowed"
        print(f"  [Patcher] BLOCKED: {msg}")
        send_telegram(f"🚫 <b>create_file blockiert:</b> {filename}\n{msg}")
        return False

    if "/" in filename or "\\" in filename or ".." in filename:
        msg = "create_file: path traversal blocked"
        print(f"  [Patcher] BLOCKED: {msg}")
        send_telegram(f"🚫 <b>create_file blockiert:</b> {filename}\n{msg}")
        return False

    if not content:
        print(f"  [Patcher] SKIP: empty content for {filename}")
        return False

    filepath = BASE_DIR / filename

    # Write to temp first, validate syntax
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    result = subprocess.run(
        ["python3", "-m", "py_compile", tmp_path],
        capture_output=True, text=True
    )
    Path(tmp_path).unlink(missing_ok=True)

    if result.returncode != 0:
        reason = result.stderr.strip()[:200]
        print(f"  [Patcher] CREATE SYNTAX ERROR: {reason}")
        log_patch(filename, description, "", content, False, f"syntax error: {reason}")
        send_telegram(
            f"❌ <b>create_file fehlgeschlagen:</b> {filename}\n"
            f"Syntaxfehler: <code>{reason[:200]}</code>\n"
            f"<i>{description[:120]}</i>"
        )
        return False

    filepath.write_text(content)
    log_patch(filename, description, "", content, True)
    print(f"  [Patcher] ✓ Created {filename}: {description[:80]}")
    send_telegram(
        f"🆕 <b>Neue Datei erstellt:</b> {filename}\n"
        f"<i>{description[:200]}</i>"
    )
    return True


def main():
    patch_file = BASE_DIR / "self_improvement.json"
    if not patch_file.exists():
        return

    try:
        patches = json.loads(patch_file.read_text())
    except Exception as e:
        print(f"  [Patcher] Read error: {e}")
        send_telegram(f"⚠️ <b>Patcher Lesefehler:</b> {e}")
        return

    if not patches:
        return

    print(f"  [Patcher] Processing {len(patches)} item(s)...")
    applied = 0
    new_files = []

    for patch in patches:
        action = patch.get("action", "patch")
        if action == "create":
            if create_file(patch):
                applied += 1
                new_files.append(patch.get("file", ""))
        else:
            if apply_patch(patch):
                applied += 1

    # Clear the queue
    patch_file.unlink(missing_ok=True)

    if applied > 0:
        # Commit self-improvements to git
        git_add_files = ["agent.py", "patcher.py", "soul.md", "telegram_bot.py", "patches.md"] + new_files
        subprocess.run(["git", "add"] + git_add_files, capture_output=True, cwd=BASE_DIR)
        msg = f"self-improvement: {applied} change(s) by Lukas"
        subprocess.run(["git", "commit", "-m", msg], capture_output=True, cwd=BASE_DIR)
        subprocess.run(
            ["git", "push", "origin", "HEAD:claude/bot-communication-system-eriiT", "--force"],
            capture_output=True, cwd=BASE_DIR
        )
        print(f"  [Patcher] Committed and pushed {applied} self-improvement(s).")
    else:
        print("  [Patcher] No changes applied.")


if __name__ == "__main__":
    main()
