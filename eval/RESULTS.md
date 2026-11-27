# Headroom evaluation results

Measured 2026-11-27 on 5 synthetic profiles we designed, runs per profile: c01 2, p02 1, p05 1, p06 1, p07 2; mode live, models gemini-3.5-flash-lite / gemini-3.5-flash-lite, Mozaik 6.0.0, profile seed headroom-2026-11-26.


| Metric | Value | Target | Note |
|---|---|---|---|
| Planted errors detected | 19 / 19 (100.0%) |  | on 5 synthetic profiles we designed |
| False discrepancies on clean profiles | 0 in 2 runs | 0 |  |
| Findings that were not planted (all profiles) | 0 |  |  |
| Verified invoice facts equal to the truth | 222 / 222 (100.0%) |  | issue date, amount in RSD and kind of every invoice |
| Wrong figures that got verified | 0 | 0 | the most important miss: listed below with figure ids |
| Contested figures that were in fact wrong | 0 / 0 |  |  |
| Figures shown without a source | 0 | 0 |  |
| Runs with 6M and 8M totals (with the draft) equal to the truth | 7 / 7 |  |  |
| Profiles with identical headroom across runs | 2 / 2 |  | measured only on profiles with more than one run: c01 (2 runs), p07 (2 runs) |
| Runs with a failed loop | 0 / 7 |  |  |
| Median loops running at once (peak) | 15 |  |  |
| Median loop time / wall time | 10.73 |  | above 1 means loops overlapped |
| Median wall time per run | 482.1 s |  |  |
| Median tokens per run (in / out) | 64203 / 6934 |  |  |
| Verifier contests by reason (all runs) | UNSOURCED 0, SOURCE_MISMATCH 0, DERIVATION_MISMATCH 0, NOT_SUPPORTED_BY_SOURCE 5, IMPLAUSIBLE 0 |  |  |
| Planted book errors that surfaced as real agent conflicts | 8 / 8 |  | E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk |
| Messy CSV layouts parsed without errors | 7 / 7 |  | 02-windows-1250.csv: account currency asked from the user |

## By planted error type

| Type | Planted | Found | Missed | Extra |
|---|---|---|---|---|
| E1 | 2 | 2 | 0 | 0 |
| E2 | 3 | 3 | 0 | 0 |
| E3 | 3 | 3 | 0 | 0 |
| E4 | 2 | 2 | 0 | 0 |
| E5 | 2 | 2 | 0 | 0 |
| E6 | 2 | 2 | 0 | 0 |
| E7 | 1 | 1 | 0 | 0 |
| E8 | 1 | 1 | 0 | 0 |
| E9 | 3 | 3 | 0 | 0 |

## Misses

None in these runs.

Not financial or tax advice. Synthetic data only.
