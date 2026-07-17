#!/usr/bin/env python3
"""
trainer.py — Validate, merge, and optionally launch a RunPod fine-tuning job.

Usage
-----
    python3 trainer.py                  # validate + show stats
    python3 trainer.py --merge          # merge into merged_train.jsonl
    python3 trainer.py --runpod         # merge + launch RunPod job
    python3 trainer.py --dry-run        # validate only, no writes

Env vars
--------
    RUNPOD_API_KEY   — RunPod API key (required for --runpod)
    RUNPOD_MODEL     — base model id (default: meta-llama/Meta-Llama-3-8B-Instruct)
    RUNPOD_GPU       — GPU type (default: NVIDIA RTX A4000)
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
TRAINING_DIR = BASE_DIR / "training_data"

RUNPOD_API_KEY = os.environ.get("RUNPOD_API_KEY", "")
RUNPOD_MODEL   = os.environ.get("RUNPOD_MODEL", "meta-llama/Meta-Llama-3-8B-Instruct")
RUNPOD_GPU     = os.environ.get("RUNPOD_GPU", "NVIDIA RTX A4000")


# ── Validation ────────────────────────────────────────────────────────────────

def validate_record(record: dict, line_no: int) -> list[str]:
    """Return list of error strings (empty = valid)."""
    errors = []
    if "messages" not in record and ("prompt" not in record or "completion" not in record):
        errors.append(f"L{line_no}: missing 'messages' or 'prompt'/'completion' keys")
    if "messages" in record:
        msgs = record["messages"]
        if not isinstance(msgs, list) or len(msgs) < 2:
            errors.append(f"L{line_no}: 'messages' must be a list with ≥2 entries")
        else:
            for i, m in enumerate(msgs):
                if not isinstance(m, dict) or "role" not in m or "content" not in m:
                    errors.append(f"L{line_no}: message[{i}] missing 'role' or 'content'")
    if "completion" in record and len(record["completion"].strip()) < 20:
        errors.append(f"L{line_no}: completion too short (<20 chars)")
    return errors


def load_all_records() -> tuple[list[dict], list[str]]:
    """Scan all *.jsonl files in training_data/. Returns (records, errors)."""
    records, errors = [], []
    if not TRAINING_DIR.exists():
        return [], ["training_data/ directory not found"]
    files = sorted(TRAINING_DIR.rglob("*.jsonl"))
    files = [f for f in files if f.name not in ("merged_train.jsonl", "_index.jsonl")]
    if not files:
        return [], ["No .jsonl training files found in training_data/"]
    for fpath in files:
        try:
            for ln, line in enumerate(fpath.read_text().splitlines(), 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    errs = validate_record(rec, ln)
                    if errs:
                        errors.extend([f"{fpath.name}: {e}" for e in errs])
                    else:
                        records.append(rec)
                except json.JSONDecodeError as e:
                    errors.append(f"{fpath.name} L{ln}: JSON error: {e}")
        except Exception as e:
            errors.append(f"{fpath.name}: read error: {e}")
    return records, errors


def show_stats(records: list[dict]) -> None:
    total_prompt_chars   = sum(len(r.get("prompt", "")) for r in records)
    total_complete_chars = sum(len(r.get("completion", "")) for r in records)
    total_tokens = (total_prompt_chars + total_complete_chars) // 4
    print(f"\n{'='*50}")
    print(f"  Training data summary")
    print(f"{'='*50}")
    print(f"  Total records     : {len(records)}")
    print(f"  ~Total tokens     : {total_tokens:,}")
    print(f"  Avg prompt len    : {total_prompt_chars // max(1,len(records)):,} chars")
    print(f"  Avg completion    : {total_complete_chars // max(1,len(records)):,} chars")
    if records:
        dates = [r.get("meta", {}).get("date", "") for r in records if r.get("meta", {}).get("date")]
        if dates:
            print(f"  Oldest session    : {min(dates)}")
            print(f"  Newest session    : {max(dates)}")
    print(f"{'='*50}\n")


# ── Merge ─────────────────────────────────────────────────────────────────────

def merge_records(records: list[dict]) -> Path:
    """Write merged_train.jsonl. Returns path."""
    out_path = TRAINING_DIR / "merged_train.jsonl"
    with out_path.open("w") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"  Merged {len(records)} records → {out_path}")
    return out_path


# ── RunPod ────────────────────────────────────────────────────────────────────

# NOTE: Use __MODEL__ as placeholder (not {model}) to avoid .format() consuming
# the Python dict-access braces like {m['role']} inside the script body.
RUNPOD_SCRIPT = r"""#!/bin/bash
set -e
pip install -q unsloth[colab-new] transformers datasets trl
python3 << 'PY'
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments
import torch

model_obj, tokenizer = FastLanguageModel.from_pretrained(
    model_name     = "__MODEL__",
    max_seq_length = 4096,
    load_in_4bit   = True,
)
model_obj = FastLanguageModel.get_peft_model(
    model_obj, r=16,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    lora_alpha=16, lora_dropout=0, bias="none", use_gradient_checkpointing=True,
)
dataset = load_dataset("json", data_files="/workspace/merged_train.jsonl", split="train")

def fmt(ex):
    msgs = ex.get("messages", [])
    parts = ["<|start_header_id|>" + m["role"] + "<|end_header_id|>\n" + m["content"] + "<|eot_id|>" for m in msgs]
    return {"text": "<|begin_of_text|>" + "".join(parts)}

dataset = dataset.map(fmt)
trainer = SFTTrainer(
    model=model_obj,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    args=TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        num_train_epochs=3,
        learning_rate=2e-4,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=10,
        output_dir="/workspace/lukas_lora",
        save_strategy="epoch",
    ),
)
trainer.train()
model_obj.save_pretrained("/workspace/lukas_lora_final")
tokenizer.save_pretrained("/workspace/lukas_lora_final")
print("Training complete! Model saved to /workspace/lukas_lora_final/")
PY
"""


def launch_runpod(merged_path: Path) -> None:
    if not RUNPOD_API_KEY:
        print("ERROR: RUNPOD_API_KEY not set.")
        sys.exit(1)

    import base64

    # Replace __MODEL__ placeholder (safe: no format-brace collisions)
    script = RUNPOD_SCRIPT.replace("__MODEL__", RUNPOD_MODEL).strip()

    # Embed training data as base64 so no temp file copy needed on host side
    data_b64 = base64.b64encode(merged_path.read_bytes()).decode()

    # Build startup script that first restores the data file, then trains
    full_script = (
        "#!/bin/bash\nset -e\n"
        f"echo {data_b64} | base64 -d > /workspace/merged_train.jsonl\n"
        "cd /workspace\n"
        + script
    )

    # Base64-encode the ENTIRE startup script so we don't hit shell quoting issues
    # in dockerArgs (no single-quotes inside dockerArgs string)
    full_script_b64 = base64.b64encode(full_script.encode()).decode()
    docker_args = f"bash -c 'echo {full_script_b64} | base64 -d | bash'"

    payload = json.dumps({
        "query": """
        mutation RunPod($input: PodFindAndDeployOnDemandInput!) {
          podFindAndDeployOnDemand(input: $input) {
            id
            imageName
            gpuCount
            costPerHr
          }
        }
        """,
        "variables": {
            "input": {
                "name":          "lukas-finetune",
                "imageName":     "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04",
                "gpuTypeId":     RUNPOD_GPU,
                "cloudType":     "SECURE",
                "startJupyter":  False,
                "startSsh":      True,
                "gpuCount":      1,
                "volumeInGb":    20,
                "containerDiskInGb": 20,
                "dockerArgs":    docker_args,
            }
        }
    }).encode()

    req = urllib.request.Request(
        "https://api.runpod.io/graphql",
        data=payload,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {RUNPOD_API_KEY}"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
        pod = resp.get("data", {}).get("podFindAndDeployOnDemand", {})
        pod_id = pod.get("id", "?")
        cost   = pod.get("costPerHr", "?")
        print(f"\n  RunPod job launched!")
        print(f"  Pod ID   : {pod_id}")
        print(f"  GPU      : {RUNPOD_GPU}")
        print(f"  Cost     : ~${cost}/hr")
        print(f"  Model    : {RUNPOD_MODEL}")
        print(f"  Records  : {sum(1 for l in merged_path.read_text().splitlines() if l.strip())} training pairs")
    except urllib.error.HTTPError as e:
        print(f"  RunPod API error {e.code}: {e.read().decode()[:300]}")
    except Exception as e:
        print(f"  RunPod launch error: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Lukas LoRA trainer pipeline")
    parser.add_argument("--merge",   action="store_true", help="Merge all data into merged_train.jsonl")
    parser.add_argument("--runpod",  action="store_true", help="Merge + launch RunPod fine-tuning job")
    parser.add_argument("--dry-run", action="store_true", help="Validate only, no file writes")
    args = parser.parse_args()

    print(f"\n[trainer.py] Scanning {TRAINING_DIR}...")
    records, errors = load_all_records()

    if errors:
        print(f"\n⚠️  Validation errors ({len(errors)}):")
        for e in errors[:20]:
            print(f"  • {e}")
        if len(errors) > 20:
            print(f"  ... and {len(errors)-20} more")
    else:
        print(f"  ✓ All records valid")

    show_stats(records)

    if not records:
        print("No valid records to process. Collect more session data first.")
        sys.exit(1)

    if args.dry_run:
        print("Dry-run mode: no files written.")
        return

    if args.merge or args.runpod:
        TRAINING_DIR.mkdir(parents=True, exist_ok=True)
        merged = merge_records(records)
        if args.runpod:
            print(f"\nLaunching RunPod job...")
            launch_runpod(merged)

    if not args.merge and not args.runpod:
        print("Use --merge to write merged_train.jsonl, or --runpod to train.")


if __name__ == "__main__":
    main()


################################################################################
## SECTION: 7_DATA_FEEDS
################################################################################
