#!/usr/bin/env python3
"""Import the free NQ dated-contract Parquet sample into a local AMI research archive.

The importer rebuilds 1-minute bars from dated NQ tick records and checks them
against the pack's published one-minute bars. The published bars are continuous-
series output; they are a reconciliation reference only, never relabelled as
the dated-contract source.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


PACK_SCHEMA = "historical-futures-sample-pack/1"
EXCHANGE = "CME"
SYMBOL = "NQ"
MINUTE_NS = 60_000_000_000
MINUTE_MS = 60_000
REQUIRED_TICK_COLUMNS = {
    "ts", "price", "volume", "bid_sz", "ask_sz", "trade_count", "symbol", "exchange"
}
REQUIRED_BAR_COLUMNS = {"ts", "open", "high", "low", "close", "volume", "trade_count"}
CONTRACT_PATTERN = re.compile(r"^NQ[HMUZ][0-9]{1,2}$")


class ImportErrorDetail(Exception):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def parse_sha256sums(raw: bytes) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in raw.decode("utf-8").splitlines():
        item = line.strip()
        if not item:
            continue
        parts = item.split(maxsplit=1)
        if len(parts) != 2:
            raise ImportErrorDetail("Malformed SHA256SUMS entry.")
        digest, filename = parts
        filename = filename.lstrip("*").strip()
        if not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            raise ImportErrorDetail("Invalid SHA-256 in SHA256SUMS for " + filename)
        if "/" in filename or "\\" in filename or filename in {".", ".."}:
            raise ImportErrorDetail("Unsafe source filename in SHA256SUMS.")
        if filename in result:
            raise ImportErrorDetail("Duplicate filename in SHA256SUMS: " + filename)
        result[filename] = digest.lower()
    return result


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ImportErrorDetail("Sample timestamps must carry an explicit UTC offset.")
    return parsed.astimezone(timezone.utc)


def epoch_ns(value: datetime) -> int:
    return int(value.timestamp() * 1_000_000_000)


def aggregate_minute_bars(ticks: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate already-chronological dated-contract trades without gap fill."""
    bars: list[dict[str, Any]] = []
    previous_ts: int | None = None
    current: dict[str, Any] | None = None
    current_bucket: int | None = None

    for tick in ticks:
        ts_ns = tick["ts_ns"]
        price = tick["price"]
        volume = tick["volume"]
        trade_count = tick["trade_count"]

        if not isinstance(ts_ns, int) or ts_ns < 0:
            raise ImportErrorDetail("Tick timestamp must be a non-negative integer in UTC nanoseconds.")
        if previous_ts is not None and ts_ns < previous_ts:
            raise ImportErrorDetail("Dated-contract tick timestamps are not sorted.")
        if not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0:
            raise ImportErrorDetail("Tick price must be a positive finite value.")
        if not isinstance(volume, int) or volume < 0:
            raise ImportErrorDetail("Tick volume must be a non-negative integer contract count.")
        if not isinstance(trade_count, int) or trade_count <= 0:
            raise ImportErrorDetail("Tick trade_count must be a positive integer.")

        bucket_ns = (ts_ns // MINUTE_NS) * MINUTE_NS
        if current_bucket != bucket_ns:
            if current is not None:
                bars.append(current)
            current_bucket = bucket_ns
            timestamp_ms = bucket_ns // 1_000_000
            current = {
                "timestamp": timestamp_ms,
                "open": float(price),
                "high": float(price),
                "low": float(price),
                "close": float(price),
                "volume": volume,
                "trade_count": trade_count,
                "close_timestamp": timestamp_ms + MINUTE_MS - 1,
                "tick_rows": 1,
            }
        else:
            assert current is not None
            current["high"] = max(current["high"], float(price))
            current["low"] = min(current["low"], float(price))
            current["close"] = float(price)
            current["volume"] += volume
            current["trade_count"] += trade_count
            current["tick_rows"] += 1
        previous_ts = ts_ns

    if current is not None:
        bars.append(current)
    return bars


def compare_derived_to_reference(
    derived: list[dict[str, Any]],
    reference: list[dict[str, Any]],
    price_tolerance: float = 1e-9,
) -> None:
    if len(derived) != len(reference):
        raise ImportErrorDetail(
            f"Derived minute-bar count {len(derived)} does not match reference count {len(reference)}."
        )
    for index, (actual, expected) in enumerate(zip(derived, reference)):
        if actual["timestamp"] != expected["timestamp"]:
            raise ImportErrorDetail(f"Reference minute timestamp mismatch at row {index + 1}.")
        for name in ("open", "high", "low", "close"):
            if not math.isclose(actual[name], expected[name], rel_tol=0.0, abs_tol=price_tolerance):
                raise ImportErrorDetail(f"Derived {name} does not match reference at row {index + 1}.")
        for name in ("volume", "trade_count"):
            if actual[name] != expected[name]:
                raise ImportErrorDetail(f"Derived {name} does not match reference at row {index + 1}.")


def _pyarrow():
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise ImportErrorDetail(
            "Parquet reading requires PyArrow. Install it in this Python environment with: "
            "python3 -m pip install pyarrow"
        ) from exc
    return pa, pq


def _read_parquet_columns(raw: bytes, required: set[str], label: str):
    pa, pq = _pyarrow()
    table = pq.read_table(pa.BufferReader(raw))
    missing = required.difference(table.column_names)
    if missing:
        raise ImportErrorDetail(label + " Parquet is missing columns: " + ", ".join(sorted(missing)))
    timestamp_type = table.schema.field("ts").type
    if not pa.types.is_timestamp(timestamp_type) or timestamp_type.unit != "ns":
        raise ImportErrorDetail(label + " timestamp column must be Parquet timestamp[ns, UTC].")
    if timestamp_type.tz not in {"UTC", "Etc/UTC", "utc"}:
        raise ImportErrorDetail(label + " timestamp column must declare UTC timezone.")
    for integer_column in ({"volume", "trade_count"} if "volume" in required else set()):
        if not pa.types.is_integer(table.schema.field(integer_column).type):
            raise ImportErrorDetail(label + " " + integer_column + " must use an integer Parquet type.")
    if label == "NQ tick":
        for integer_column in ("bid_sz", "ask_sz"):
            if not pa.types.is_integer(table.schema.field(integer_column).type):
                raise ImportErrorDetail(label + " " + integer_column + " must use an integer Parquet type.")
    ts_values = table.column("ts").cast(pa.int64()).to_pylist()
    return table, ts_values


def read_tick_records(raw: bytes, expected_contract: str, start_ns: int, end_ns: int):
    required = REQUIRED_TICK_COLUMNS
    table, ts_values = _read_parquet_columns(raw, required, "NQ tick")
    columns = {
        name: table.column(name).to_pylist()
        for name in ("price", "volume", "bid_sz", "ask_sz", "trade_count", "symbol", "exchange")
    }
    unique_symbols = set(columns["symbol"])
    unique_exchanges = set(columns["exchange"])
    if unique_symbols != {expected_contract}:
        raise ImportErrorDetail("Tick Parquet symbol does not match the dated contract.")
    if unique_exchanges != {EXCHANGE}:
        raise ImportErrorDetail("Tick Parquet exchange is not CME.")

    records = []
    previous_ts: int | None = None
    for index, ts_ns in enumerate(ts_values):
        if not isinstance(ts_ns, int) or ts_ns < start_ns or ts_ns >= end_ns:
            raise ImportErrorDetail("Tick timestamp is outside the sample's UTC window.")
        if previous_ts is not None and ts_ns < previous_ts:
            raise ImportErrorDetail("Tick timestamps are not chronologically ordered.")
        volume = columns["volume"][index]
        trade_count = columns["trade_count"][index]
        bid_sz = columns["bid_sz"][index]
        ask_sz = columns["ask_sz"][index]
        if not isinstance(bid_sz, int) or bid_sz < 0 or not isinstance(ask_sz, int) or ask_sz < 0:
            raise ImportErrorDetail("Executed bid/ask volume fields must be non-negative integers.")
        records.append({
            "ts_ns": ts_ns,
            "price": columns["price"][index],
            "volume": volume,
            "trade_count": trade_count,
        })
        previous_ts = ts_ns
    return records


def read_reference_bars(raw: bytes, start_ns: int, end_ns: int):
    table, ts_values = _read_parquet_columns(raw, REQUIRED_BAR_COLUMNS, "Reference bar")
    columns = {
        name: table.column(name).to_pylist()
        for name in ("open", "high", "low", "close", "volume", "trade_count")
    }
    bars = []
    previous_ts: int | None = None
    for index, ts_ns in enumerate(ts_values):
        if not isinstance(ts_ns, int) or ts_ns < start_ns or ts_ns >= end_ns:
            raise ImportErrorDetail("Reference bar timestamp is outside the sample UTC window.")
        if ts_ns % MINUTE_NS != 0:
            raise ImportErrorDetail("Reference bar timestamp is not aligned to a UTC minute.")
        if previous_ts is not None and ts_ns <= previous_ts:
            raise ImportErrorDetail("Reference bar timestamps must be unique and increasing.")
        row = {
            "timestamp": ts_ns // 1_000_000,
            "open": float(columns["open"][index]),
            "high": float(columns["high"][index]),
            "low": float(columns["low"][index]),
            "close": float(columns["close"][index]),
            "volume": int(columns["volume"][index]),
            "trade_count": int(columns["trade_count"][index]),
        }
        if not all(math.isfinite(row[name]) and row[name] > 0 for name in ("open", "high", "low", "close")):
            raise ImportErrorDetail("Reference bars contain invalid OHLC values.")
        if row["high"] < max(row["open"], row["close"], row["low"]):
            raise ImportErrorDetail("Reference bar high/low integrity failed.")
        if row["low"] > min(row["open"], row["close"], row["high"]):
            raise ImportErrorDetail("Reference bar high/low integrity failed.")
        if row["volume"] < 0 or row["trade_count"] < 0:
            raise ImportErrorDetail("Reference bar volume and trade_count must be non-negative.")
        bars.append(row)
        previous_ts = ts_ns
    return bars


def to_normalized_csv(bars: list[dict[str, Any]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow([
        "timestamp", "open", "high", "low", "close", "volume", "trade_count", "close_timestamp"
    ])
    for bar in bars:
        writer.writerow([
            bar["timestamp"],
            format(bar["open"], ".17g"),
            format(bar["high"], ".17g"),
            format(bar["low"], ".17g"),
            format(bar["close"], ".17g"),
            bar["volume"],
            bar["trade_count"],
            bar["close_timestamp"],
        ])
    return output.getvalue().encode("utf-8")


def import_sample_archive(archive_path: Path, output_root: Path, contract: str, expected_zip_sha256: str | None = None):
    archive_path = archive_path.resolve()
    if not archive_path.is_file():
        raise ImportErrorDetail("Archive file does not exist: " + str(archive_path))
    if not CONTRACT_PATTERN.fullmatch(contract):
        raise ImportErrorDetail("Contract must be an explicit NQ month code such as NQZ6.")

    archive_sha_hash = hashlib.sha256()
    with archive_path.open("rb") as archive_file:
        for chunk in iter(lambda: archive_file.read(1024 * 1024), b""):
            archive_sha_hash.update(chunk)
    archive_sha = archive_sha_hash.hexdigest()
    if expected_zip_sha256 and archive_sha.lower() != expected_zip_sha256.lower():
        raise ImportErrorDetail("Archive SHA-256 does not match --expected-zip-sha256.")

    try:
        with zipfile.ZipFile(archive_path) as archive:
            members: dict[str, str] = {}
            for member in archive.namelist():
                member_path = PurePosixPath(member)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise ImportErrorDetail("Sample archive contains an unsafe path entry.")
                if member.endswith("/"):
                    continue
                basename = member_path.name
                if basename in members:
                    raise ImportErrorDetail("Sample archive contains duplicate basenames: " + basename)
                members[basename] = member
            if "manifest.json" not in members or "SHA256SUMS" not in members:
                raise ImportErrorDetail("Sample archive must include manifest.json and SHA256SUMS.")
            source_manifest_raw = archive.read(members["manifest.json"])
            checksums_raw = archive.read(members["SHA256SUMS"])
            sample_manifest = json.loads(source_manifest_raw)
            checksums = parse_sha256sums(checksums_raw)
            if sample_manifest.get("schema") != PACK_SCHEMA:
                raise ImportErrorDetail("Unsupported Historical Futures Data sample-pack schema.")
            if SYMBOL not in sample_manifest.get("symbols", []):
                raise ImportErrorDetail("Sample pack does not declare NQ.")
            start = parse_utc(sample_manifest["start_utc"])
            end = parse_utc(sample_manifest["end_utc"])
            start_ns = epoch_ns(start)
            end_ns = epoch_ns(end)
            if end_ns <= start_ns:
                raise ImportErrorDetail("Sample UTC window is invalid.")

            files = sample_manifest.get("files", [])
            tick_meta = next(
                (item for item in files if item.get("kind") == "ticks" and item.get("symbol") == SYMBOL),
                None,
            )
            bar_meta = next(
                (item for item in files if item.get("kind") == "bars" and item.get("symbol") == SYMBOL),
                None,
            )
            minute_volume_meta = next(
                (item for item in files if item.get("kind") == "minute_volume" and item.get("symbol") == SYMBOL),
                None,
            )
            if not tick_meta or not bar_meta or not minute_volume_meta:
                raise ImportErrorDetail("Sample manifest is missing NQ ticks, bars or minute-volume data.")
            if tick_meta.get("contract") != contract:
                raise ImportErrorDetail("Requested contract does not match NQ tick contract in the sample manifest.")

            tick_name = tick_meta["name"]
            bar_name = bar_meta["name"]
            minute_volume_name = minute_volume_meta["name"]
            for name in (tick_name, bar_name, minute_volume_name):
                if name not in members or name not in checksums:
                    raise ImportErrorDetail("Sample archive is missing a checksummed NQ source file: " + name)

            tick_raw = archive.read(members[tick_name])
            bar_raw = archive.read(members[bar_name])
            minute_volume_raw = archive.read(members[minute_volume_name])
            source_bytes = {
                tick_name: tick_raw,
                bar_name: bar_raw,
                minute_volume_name: minute_volume_raw,
            }
            for filename, raw in source_bytes.items():
                expected = next(item["sha256"] for item in files if item["name"] == filename)
                if sha256_bytes(raw) != expected.lower() or sha256_bytes(raw) != checksums[filename]:
                    raise ImportErrorDetail("SHA-256 mismatch for source file: " + filename)

            ticks = read_tick_records(tick_raw, contract, start_ns, end_ns)
            reference_bars = read_reference_bars(bar_raw, start_ns, end_ns)
            derived_bars = aggregate_minute_bars(ticks)
            compare_derived_to_reference(derived_bars, reference_bars)

            tick_volume = sum(row["volume"] for row in ticks)
            tick_trade_count = sum(row["trade_count"] for row in ticks)
            if len(ticks) != int(tick_meta["rows"]) or tick_volume != int(tick_meta["volume"]):
                raise ImportErrorDetail("NQ tick row count or contract-volume total differs from the sample manifest.")
            if tick_trade_count != int(tick_meta["trade_count"]):
                raise ImportErrorDetail("NQ tick trade_count total differs from the sample manifest.")
            if len(derived_bars) != int(bar_meta["rows"]):
                raise ImportErrorDetail("Derived NQ minute-bar count differs from the sample manifest.")

            normalized_raw = to_normalized_csv(derived_bars)
            normalized_sha = sha256_bytes(normalized_raw)
            tick_sha = sha256_bytes(tick_raw)
            reference_sha = sha256_bytes(bar_raw)
            volume_sha = sha256_bytes(minute_volume_raw)
            manifest_sha = sha256_bytes(source_manifest_raw)
            dataset_id = (
                contract.lower() + "-m1-" + start.strftime("%Y%m%d") + "-" +
                tick_sha[:8] + "-" + normalized_sha[:12]
            )
            gaps = []
            for previous, current in zip(derived_bars, derived_bars[1:]):
                delta = current["timestamp"] - previous["timestamp"]
                if delta > MINUTE_MS:
                    gaps.append({
                        "fromTs": previous["timestamp"],
                        "toTs": current["timestamp"],
                        "missingMinuteBuckets": delta // MINUTE_MS - 1,
                    })

            manifest = {
                "schemaVersion": 1,
                "datasetId": dataset_id,
                "instrument": {
                    "id": contract,
                    "root": "NQ",
                    "exchange": EXCHANGE,
                    "dataClass": "EXCHANGE_FUTURES",
                    "provider": "HistoricalFuturesData",
                    "providerReadiness": "HISTORICAL_CANDIDATE",
                    "quoteCurrency": "USD",
                    "pnlCurrency": "USD",
                    "priceSide": "TRADE",
                    "volumeSemantics": "EXCHANGE_TRADED_VOLUME",
                    "contractEconomicsStatus": "UNVERIFIED",
                    "executionCostsStatus": "UNVERIFIED",
                    "initialMarginStatus": "UNVERIFIED",
                },
                "interval": {
                    "timeframe": "1m",
                    "durationMs": MINUTE_MS,
                    "timestampMeaning": "BAR_OPEN_TIME_UTC",
                    "closeTimestampMeaning": "BAR_CLOSE_TIME_UTC_INCLUSIVE",
                },
                "requestedRange": {
                    "from": start.isoformat(),
                    "toExclusive": end.isoformat(),
                },
                "actualCoverage": {
                    "fromTs": derived_bars[0]["timestamp"] if derived_bars else None,
                    "toTs": derived_bars[-1]["close_timestamp"] if derived_bars else None,
                    "rows": len(derived_bars),
                },
                "volume": {
                    "present": True,
                    "units": "contracts",
                    "total": tick_volume,
                    "semantics": "EXCHANGE_TRADED_VOLUME",
                    "tradeCount": tick_trade_count,
                    "note": "Contracts traded aggregated from source tick records; do not treat tick-row count as volume.",
                },
                "provenance": {
                    "provider": "HistoricalFuturesData",
                    "exchange": EXCHANGE,
                    "contractCode": contract,
                    "samplePackSchema": PACK_SCHEMA,
                    "sourceArchiveName": archive_path.name,
                    "sourceArchiveSha256": archive_sha,
                    "sourcePackManifestSha256": manifest_sha,
                    "sourceTickFile": tick_name,
                    "sourceTickSha256": tick_sha,
                    "referenceContinuousBarsFile": bar_name,
                    "referenceContinuousBarsSha256": reference_sha,
                    "minuteVolumeFile": minute_volume_name,
                    "minuteVolumeSha256": volume_sha,
                    "barConstruction": "AGGREGATED_FROM_DATED_CONTRACT_TICKS",
                    "referenceCheck": "EXACT_OHLCV_TRADE_COUNT_MATCH_TO_PUBLISHED_CONTINUOUS_BARS",
                    "importer": "ami-nq-dated-contract-sample-importer",
                    "importerVersion": 1,
                    "importedAtUtc": datetime.now(timezone.utc).isoformat(),
                    "sourceTimestamp": "UTC nanoseconds",
                },
                "quality": {
                    "integrityStatus": "PASS",
                    "referenceBarsMatched": len(reference_bars),
                    "sourceTickRows": len(ticks),
                    "gapCount": len(gaps),
                    "gaps": gaps,
                    "sessionCalendarStatus": "UNVERIFIED",
                    "syntheticBarsCreated": 0,
                    "notes": [
                        "Bars were aggregated from dated-contract NQ ticks; the published continuous-series bars were used only as an independent equality check.",
                        "Empty minute buckets were not synthesized; provider/CME session calendar remains unverified by this importer.",
                        "The sample is one UTC day and is not a full-history backtest dataset.",
                    ],
                },
                "dataUse": {
                    "classification": "PRIVATE_INTERNAL_EVALUATION_RESEARCH_BACKTESTING_ONLY",
                    "restrictions": [
                        "No redistribution or resale.",
                        "Do not share the data or cleaned/normalized derivatives.",
                        "No commercial use or shared-account access is included.",
                    ],
                },
                "operationPolicy": {
                    "chart": "LOCAL_RESEARCH_ONLY",
                    "signalResearch": "EXPLORATORY_ONLY",
                    "strategyBacktest": "BLOCKED_UNTIL_CONTRACT_COST_MARGIN_AND_SESSION_VERIFICATION",
                    "paperExecution": "BLOCKED",
                    "liveOrderRouting": "DISABLED",
                },
                "hashes": {
                    "normalizedSha256": normalized_sha,
                    "sourceTickSha256": tick_sha,
                    "referenceContinuousBarsSha256": reference_sha,
                    "minuteVolumeSha256": volume_sha,
                    "sourcePackManifestSha256": manifest_sha,
                },
            }

            output_root = output_root.resolve()
            output_root.mkdir(parents=True, exist_ok=True)
            contract_dir = output_root / contract.lower() / "1m"
            contract_dir.mkdir(parents=True, exist_ok=True)
            destination = contract_dir / dataset_id
            if destination.exists():
                raise ImportErrorDetail("Immutable dataset revision already exists: " + str(destination))

            temp_dir = Path(tempfile.mkdtemp(prefix=".nq-import-", dir=contract_dir))
            try:
                (temp_dir / "source-ticks.parquet").write_bytes(tick_raw)
                (temp_dir / "reference-continuous-bars.parquet").write_bytes(bar_raw)
                (temp_dir / "minute-volume.csv").write_bytes(minute_volume_raw)
                (temp_dir / "source-pack-manifest.json").write_bytes(source_manifest_raw)
                (temp_dir / "source-SHA256SUMS").write_bytes(checksums_raw)
                (temp_dir / "normalized.csv").write_bytes(normalized_raw)
                (temp_dir / "manifest.json").write_text(
                    json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                os.replace(temp_dir, destination)
            except Exception:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise
            return destination, manifest
    except zipfile.BadZipFile as exc:
        raise ImportErrorDetail("Input file is not a valid ZIP sample pack.") from exc
    except json.JSONDecodeError as exc:
        raise ImportErrorDetail("Sample pack manifest JSON is malformed.") from exc


def build_parser():
    parser = argparse.ArgumentParser(
        description="Import the free NQ dated-contract Parquet sample; rebuild 1m bars from ticks and reconcile to reference bars."
    )
    parser.add_argument("--archive", required=True, help="Path to the downloaded Historical Futures Data sample ZIP.")
    parser.add_argument("--contract", default="NQZ6", help="Exact dated NQ contract in the sample manifest (default: NQZ6).")
    parser.add_argument("--output-root", default="data/market-data/futures-samples", help="Ignored local output root.")
    parser.add_argument("--expected-zip-sha256", help="Optional independently published ZIP SHA-256.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        destination, manifest = import_sample_archive(
            Path(args.archive),
            Path(args.output_root),
            args.contract,
            args.expected_zip_sha256,
        )
    except ImportErrorDetail as exc:
        print("NQ sample import rejected: " + str(exc), file=sys.stderr)
        return 2
    print("NQ dated-contract sample imported and cross-checked.")
    print("Dataset ID: " + manifest["datasetId"])
    print("Contract: " + manifest["instrument"]["id"] + " (" + manifest["instrument"]["dataClass"] + ")")
    print("Bars: " + str(manifest["actualCoverage"]["rows"]))
    print("Ticks: " + str(manifest["quality"]["sourceTickRows"]))
    print("Volume (contracts): " + str(manifest["volume"]["total"]))
    print("Integrity: " + manifest["quality"]["integrityStatus"])
    print("Session calendar: " + manifest["quality"]["sessionCalendarStatus"])
    print("Backtest policy: " + manifest["operationPolicy"]["strategyBacktest"])
    print("Local path: " + str(destination))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
