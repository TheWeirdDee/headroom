# Headroom evaluation results

Measured 2026-11-27 on 4 synthetic profiles we designed, runs per profile: c01 1, p01 1, p02 1, p03 1; mode live, models gemini-3.1-flash-lite / gemini-3.1-flash-lite, Mozaik 6.0.0, profile seed headroom-2026-11-26.


Incomplete: p05 run 1 hit the daily quota and was not counted.

| Metric | Value | Target | Note |
|---|---|---|---|
| Planted errors detected | 8 / 9 (88.9%) |  | on 4 synthetic profiles we designed |
| False discrepancies on clean profiles | 0 in 1 runs | 0 |  |
| Findings that were not planted (all profiles) | 0 |  |  |
| Verified invoice facts equal to the truth | 131 / 132 (99.2%) |  | issue date, amount in RSD and kind of every invoice |
| Wrong figures that got verified | 1 | 0 | the most important miss: listed below with figure ids |
| Contested figures that were in fact wrong | 0 / 0 |  |  |
| Figures shown without a source | 0 | 0 |  |
| Runs with 6M and 8M totals (with the draft) equal to the truth | 2 / 4 |  |  |
| Profiles with identical headroom across runs | n/a |  | every profile ran once |
| Runs with a failed loop | 1 / 4 |  |  |
| Median loops running at once (peak) | 15 |  |  |
| Median loop time / wall time | 8.93 |  | above 1 means loops overlapped |
| Median wall time per run | 451.6 s |  |  |
| Median tokens per run (in / out) | 66175.5 / 7176 |  |  |
| Verifier contests by reason (all runs) | UNSOURCED 0, SOURCE_MISMATCH 0, DERIVATION_MISMATCH 0, NOT_SUPPORTED_BY_SOURCE 7, IMPLAUSIBLE 0 |  |  |
| Planted book errors that surfaced as real agent conflicts | 4 / 4 |  | E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk |
| Messy CSV layouts parsed without errors | 7 / 7 |  | 02-windows-1250.csv: account currency asked from the user |

## By planted error type

| Type | Planted | Found | Missed | Extra |
|---|---|---|---|---|
| E1 | 1 | 1 | 0 | 0 |
| E2 | 1 | 1 | 0 | 0 |
| E3 | 1 | 0 | 1 | 0 |
| E4 | 1 | 1 | 0 | 0 |
| E5 | 1 | 1 | 0 | 0 |
| E6 | 1 | 1 | 0 | 0 |
| E7 | 1 | 1 | 0 | 0 |
| E8 | 1 | 1 | 0 | 0 |
| E9 | 1 | 1 | 0 | 0 |

## Misses

- p01 E3: run 1: not found (E3:invoice:2026-005)
- p03 wrong figure verified: run 1: f000144 invoice:2026-001:amountRSD = 300383.16, truth 301139.25

Not financial or tax advice. Synthetic data only.
