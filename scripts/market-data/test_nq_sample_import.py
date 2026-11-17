import unittest

from nq_sample_import import (
    ImportErrorDetail,
    aggregate_minute_bars,
    compare_derived_to_reference,
    parse_sha256sums,
)


MINUTE_NS = 60_000_000_000


class NqSampleImportTests(unittest.TestCase):
    def test_aggregates_dated_contract_ticks_without_filling_missing_minutes(self):
        ticks = [
            {"ts_ns": 5_000_000, "price": 100.0, "volume": 2, "trade_count": 1},
            {"ts_ns": 5_000_000, "price": 100.25, "volume": 3, "trade_count": 2},
            {"ts_ns": MINUTE_NS + 1_000_000, "price": 101.0, "volume": 4, "trade_count": 1},
            {"ts_ns": 3 * MINUTE_NS + 1_000_000, "price": 99.75, "volume": 5, "trade_count": 1},
        ]

        bars = aggregate_minute_bars(ticks)

        self.assertEqual(len(bars), 3)
        self.assertEqual([bar["timestamp"] for bar in bars], [0, 60_000, 180_000])
        self.assertEqual(bars[0]["open"], 100.0)
        self.assertEqual(bars[0]["high"], 100.25)
        self.assertEqual(bars[0]["low"], 100.0)
        self.assertEqual(bars[0]["close"], 100.25)
        self.assertEqual(bars[0]["volume"], 5)
        self.assertEqual(bars[0]["trade_count"], 3)
        self.assertEqual(bars[0]["tick_rows"], 2)
        self.assertEqual(bars[0]["close_timestamp"], 59_999)

    def test_preserves_source_order_for_same_timestamp_ticks(self):
        ticks = [
            {"ts_ns": 10, "price": 100.25, "volume": 1, "trade_count": 1},
            {"ts_ns": 10, "price": 100.0, "volume": 1, "trade_count": 1},
        ]
        bars = aggregate_minute_bars(ticks)
        self.assertEqual(bars[0]["open"], 100.25)
        self.assertEqual(bars[0]["close"], 100.0)

    def test_rejects_out_of_order_source_ticks(self):
        ticks = [
            {"ts_ns": MINUTE_NS, "price": 100.0, "volume": 1, "trade_count": 1},
            {"ts_ns": 0, "price": 99.0, "volume": 1, "trade_count": 1},
        ]
        with self.assertRaisesRegex(ImportErrorDetail, "not sorted"):
            aggregate_minute_bars(ticks)

    def test_rejects_invalid_volume_and_trade_counts(self):
        with self.assertRaisesRegex(ImportErrorDetail, "volume"):
            aggregate_minute_bars([
                {"ts_ns": 1, "price": 100.0, "volume": 1.5, "trade_count": 1},
            ])
        with self.assertRaisesRegex(ImportErrorDetail, "trade_count"):
            aggregate_minute_bars([
                {"ts_ns": 1, "price": 100.0, "volume": 1, "trade_count": 0},
            ])

    def test_reference_reconciliation_checks_time_prices_volume_and_trade_count(self):
        derived = [{
            "timestamp": 0,
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.5,
            "volume": 10,
            "trade_count": 8,
        }]
        compare_derived_to_reference(derived, [dict(derived[0])])

        for field, value in [
            ("timestamp", 60_000),
            ("close", 100.75),
            ("volume", 11),
            ("trade_count", 9),
        ]:
            changed = dict(derived[0])
            changed[field] = value
            with self.subTest(field=field):
                with self.assertRaises(ImportErrorDetail):
                    compare_derived_to_reference(derived, [changed])

    def test_parses_sha256sum_entries_and_rejects_unsafe_paths(self):
        parsed = parse_sha256sums(
            b"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  NQZ6_ticks.parquet\n"
        )
        self.assertEqual(
            parsed["NQZ6_ticks.parquet"],
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )
        with self.assertRaisesRegex(ImportErrorDetail, "Unsafe"):
            parse_sha256sums(
                b"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  ../outside.parquet\n"
            )


if __name__ == "__main__":
    unittest.main()
