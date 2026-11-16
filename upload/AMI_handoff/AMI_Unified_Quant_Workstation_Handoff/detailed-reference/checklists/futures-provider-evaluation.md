# Futures provider evaluation checklist

- [ ] Product coverage explicitly includes CME MNQ/NQ and COMEX MGC/GC.
- [ ] Dated contract symbol mapping supplied and tested.
- [ ] Historical coverage, granularity and correction policy documented.
- [ ] Trades, best bid/ask and market depth capabilities distinguished.
- [ ] Exchange sequence/timestamp semantics documented.
- [ ] Historical/real-time entitlement and exchange licensing confirmed.
- [ ] Non-display, derived data, retention and redistribution rights reviewed.
- [ ] Session calendars, holiday/early-close handling documented.
- [ ] Symbol roll and contract metadata supplied with effective dates.
- [ ] Fees, spread, market impact and data costs documented.
- [ ] Rate limits, retention, billing and cost ceilings documented.
- [ ] Sample data imported and gap/duplicate/out-of-order/correction tests passed.
- [ ] Historical import is deterministic and hash-addressed.
- [ ] Provider credentials/keys remain local and outside source/docs/logs.
- [ ] Owner explicitly approves any paid plan or external service activation.
