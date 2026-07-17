#!/usr/bin/env python3
"""Minimal HTTP API serving activity.json for the dashboard."""
import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

BASE_DIR = Path("/root/Agent-spy")

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/activity" or self.path == "/activity.json":
            try:
                data = json.loads((BASE_DIR / "activity.json").read_text())
                diary = ""
                df = BASE_DIR / "diary.md"
                if df.exists():
                    diary = df.read_text(errors="replace")[-2000:]
                data["diary_excerpt"] = diary

                training_count = 0
                tf = BASE_DIR / "training_data.json"
                if tf.exists():
                    try:
                        td = json.loads(tf.read_text())
                        training_count = len(td) if isinstance(td, list) else 0
                    except Exception:
                        pass
                data["training_pairs"] = training_count

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        elif self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    port = 8099
    print(f"[VPS-API] Serving on :{port}")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()


################################################################################
## SECTION: B_SHELL
################################################################################
