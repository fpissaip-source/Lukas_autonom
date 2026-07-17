#!/usr/bin/env python3
"""
chainlink_oracle.py — Chainlink BTC/USD price source for LUKAS BTC-trader.

Two providers, in priority order:
  1. Chainlink Data Streams API (sub-second; requires CHAINLINK_API_KEY + CHAINLINK_API_SECRET)
  2. Chainlink On-Chain Aggregator on Polygon (public; ~27s heartbeat)

Polymarket's BTC-Up/Down-5min markets resolve against Chainlink BTC/USD specifically.
Reading the same source as the resolver eliminates surprise resolutions vs Binance/CoinGecko.
"""
import os
import json
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# Polygon mainnet Chainlink BTC/USD AggregatorV3 proxy
CHAINLINK_BTCUSD_POLYGON = "0xc907E116054Ad103354f2D350FD2514433D57F6f"
LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c"  # latestRoundData()
DECIMALS_SELECTOR = "0x313ce567"  # decimals()

FALLBACK_RPCS = [
    os.environ.get("POLYGON_RPC_URL") or "",
    "https://polygon-bor-rpc.publicnode.com",
    "https://1rpc.io/matic",
    "https://polygon.llamarpc.com",
]
FALLBACK_RPCS = [u for u in FALLBACK_RPCS if u]
DEFAULT_RPC = FALLBACK_RPCS[0]
DATA_STREAMS_BASE = os.environ.get("CHAINLINK_DATA_STREAMS_URL") or "https://api.dataengine.chain.link"
DATA_STREAMS_BTCUSD_FEED_ID = os.environ.get("CHAINLINK_BTCUSD_FEED_ID") or "0x00037da06d56d083fe599397a4769a042d63aa73dc4ef57709d31e9971a5b439"

STATE_FILE = Path("/root/Agent-spy/chainlink_oracle_state.json")
LOG_FILE = Path("/root/Agent-spy/chainlink_oracle.log")


def _log(msg):
    line = f"[{datetime.now().isoformat()}] {msg}"
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _save_state(d):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(d, f, indent=2)
    except Exception:
        pass


def _load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _rpc_call(method, params, rpc_url=None, timeout=8):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        rpc_url or DEFAULT_RPC,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 LUKAS-Bot"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    if "error" in data:
        raise RuntimeError(f"RPC error: {data['error']}")
    return data["result"]


def _eth_call(to_addr, data_hex, rpc_url=None):
    urls = [rpc_url] if rpc_url else FALLBACK_RPCS
    last_err = None
    for url in urls:
        try:
            return _rpc_call("eth_call", [{"to": to_addr, "data": data_hex}, "latest"], rpc_url=url)
        except Exception as e:
            last_err = f"{url}: {e}"
            continue
    raise RuntimeError(f"All RPCs failed: {last_err}")


def _decode_int(hex_str, signed=False):
    h = hex_str[2:] if hex_str.startswith("0x") else hex_str
    n = int(h, 16)
    if signed:
        bits = len(h) * 4
        if n >= 2 ** (bits - 1):
            n -= 2 ** bits
    return n


# ---------- Provider 1: On-chain Chainlink Aggregator (Polygon) ----------

class ChainlinkOnChainProvider:
    name = "chainlink_onchain"

    def __init__(self, rpc_url=None, contract=CHAINLINK_BTCUSD_POLYGON):
        self.rpc_url = rpc_url or DEFAULT_RPC
        self.contract = contract
        self._decimals = None

    def _get_decimals(self):
        if self._decimals is not None:
            return self._decimals
        try:
            res = _eth_call(self.contract, DECIMALS_SELECTOR, rpc_url=self.rpc_url)
            self._decimals = _decode_int(res)
        except Exception:
            self._decimals = 8  # Chainlink BTC/USD standard
        return self._decimals

    def fetch(self):
        """Returns dict {price, updated_at, round_id, source, fetch_latency_ms} or raises."""
        t0 = time.time()
        raw = _eth_call(self.contract, LATEST_ROUND_DATA_SELECTOR, rpc_url=self.rpc_url)
        latency_ms = (time.time() - t0) * 1000

        # latestRoundData returns (uint80, int256, uint256, uint256, uint80) — five 32-byte words
        h = raw[2:] if raw.startswith("0x") else raw
        if len(h) < 5 * 64:
            raise RuntimeError(f"Unexpected RPC payload length: {len(h)}")
        words = [h[i:i + 64] for i in range(0, 5 * 64, 64)]
        round_id = _decode_int("0x" + words[0])
        answer = _decode_int("0x" + words[1], signed=True)
        # words[2] = startedAt, words[3] = updatedAt, words[4] = answeredInRound
        updated_at = _decode_int("0x" + words[3])

        decimals = self._get_decimals()
        price = answer / (10 ** decimals)

        return {
            "price": price,
            "updated_at": updated_at,
            "round_id": round_id,
            "source": self.name,
            "fetch_latency_ms": latency_ms,
            "age_s": time.time() - updated_at,
        }


# ---------- Provider 2: Chainlink Data Streams API (sub-second, requires creds) ----------

class ChainlinkDataStreamsProvider:
    name = "chainlink_streams"

    def __init__(self, api_key=None, api_secret=None, base_url=None, feed_id=None):
        self.api_key = api_key or os.environ.get("CHAINLINK_API_KEY")
        self.api_secret = api_secret or os.environ.get("CHAINLINK_API_SECRET")
        self.base_url = base_url or DATA_STREAMS_BASE
        self.feed_id = feed_id or DATA_STREAMS_BTCUSD_FEED_ID

    def is_configured(self):
        return bool(self.api_key and self.api_secret)

    def fetch(self):
        """Returns dict like OnChainProvider, or raises if not configured/error."""
        if not self.is_configured():
            raise RuntimeError("Chainlink Data Streams API credentials not configured (CHAINLINK_API_KEY/SECRET)")
        # Endpoint shape per Chainlink Data Streams Direct docs:
        # GET /api/v1/reports/latest?feedID=<feedId>
        url = f"{self.base_url.rstrip('/')}/api/v1/reports/latest?feedID={self.feed_id}"
        # Auth uses HMAC over (method, path, body, ts, key); for stub we send key in header.
        # Real signed-request implementation slot — replace once whitelist arrives.
        headers = {"Authorization": self.api_key}
        t0 = time.time()
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read())
        latency_ms = (time.time() - t0) * 1000
        report = data.get("report") or data
        # Actual report structure: bid/ask/observations + benchmark price as int with 18 decimals
        bench = report.get("benchmarkPrice") or report.get("price")
        ts = int(report.get("observationsTimestamp") or report.get("validFromTimestamp") or time.time())
        if isinstance(bench, str):
            bench = int(bench, 16) if bench.startswith("0x") else int(bench)
        price = float(bench) / (10 ** 18)
        return {
            "price": price,
            "updated_at": ts,
            "round_id": None,
            "source": self.name,
            "fetch_latency_ms": latency_ms,
            "age_s": time.time() - ts,
        }


# ---------- Manager ----------

class ChainlinkOracleManager:
    """Tries providers in priority order; caches last good fetch."""

    def __init__(self):
        self.streams = ChainlinkDataStreamsProvider()
        self.onchain = ChainlinkOnChainProvider()
        self._last_good = None

    def fetch_price(self, prefer_streams=True):
        """Returns dict on success or None on total failure. Always logs."""
        providers = []
        if prefer_streams and self.streams.is_configured():
            providers.append(self.streams)
        providers.append(self.onchain)

        last_err = None
        for p in providers:
            try:
                result = p.fetch()
                self._last_good = result
                _save_state({"last_fetch": result, "last_attempt_ts": time.time()})
                _log(f"OK source={result['source']} price=${result['price']:.2f} "
                     f"age={result['age_s']:.1f}s latency={result['fetch_latency_ms']:.0f}ms")
                return result
            except Exception as e:
                last_err = f"{p.name}: {e}"
                _log(f"FAIL {last_err}")
                continue
        _log(f"All providers failed. Last error: {last_err}")
        return None

    def status(self):
        return {
            "streams_configured": self.streams.is_configured(),
            "last_good": self._last_good,
        }


_MANAGER = None


def get_manager():
    global _MANAGER
    if _MANAGER is None:
        _MANAGER = ChainlinkOracleManager()
    return _MANAGER


def fetch_btc_usd_chainlink():
    """Convenience: returns dict or None."""
    return get_manager().fetch_price()


if __name__ == "__main__":
    # Quick smoke test
    mgr = get_manager()
    print(f"Streams configured: {mgr.streams.is_configured()}")
    print(f"On-chain RPC: {mgr.onchain.rpc_url}")
    r = mgr.fetch_price()
    if r:
        print(json.dumps(r, indent=2, default=str))
    else:
        print("FAILED to fetch from any provider")
