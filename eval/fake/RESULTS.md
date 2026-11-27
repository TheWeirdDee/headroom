# Headroom evaluation results

Measured 2026-11-27 on 14 synthetic profiles we designed, runs per profile: c01 2, c02 2, p01 2, p02 2, p03 2, p04 2, p05 2, p06 2, p07 2, p08 2, p09 2, p10 2, p11 2, p12 2; mode fake, models fake-model (test) / fake-model (test), Mozaik 6.0.0, profile seed headroom-2026-11-26.

Fake mode uses the deterministic test model: it measures the pipeline, not model reading accuracy.


| Metric | Value | Target | Note |
|---|---|---|---|
| Planted errors detected | 82 / 82 (100.0%) |  | on 14 synthetic profiles we designed |
| False discrepancies on clean profiles | 0 in 4 runs | 0 |  |
| Findings that were not planted (all profiles) | 0 |  |  |
| Verified invoice facts equal to the truth | 918 / 918 (100.0%) |  | issue date, amount in RSD and kind of every invoice |
| Wrong figures that got verified | 0 | 0 | the most important miss: listed below with figure ids |
| Contested figures that were in fact wrong | 0 / 0 |  |  |
| Figures shown without a source | 0 | 0 |  |
| Runs with 6M and 8M totals (with the draft) equal to the truth | 28 / 28 |  |  |
| Profiles with identical headroom across runs | 14 / 14 |  | measured only on profiles with more than one run: c01 (2 runs), c02 (2 runs), p01 (2 runs), p02 (2 runs), p03 (2 runs), p04 (2 runs), p05 (2 runs), p06 (2 runs), p07 (2 runs), p08 (2 runs), p09 (2 runs), p10 (2 runs), p11 (2 runs), p12 (2 runs) |
| Runs with a failed loop | 0 / 28 |  |  |
| Median loops running at once (peak) | 15 |  |  |
| Median loop time / wall time | 0.62 |  | the test model answers instantly, so wall time is mostly the quiet period that ends a run |
| Median wall time per run | 2.2 s |  |  |
| Median tokens per run (in / out) | 19000 / 4582 |  |  |
| Verifier contests by reason (all runs) | UNSOURCED 0, SOURCE_MISMATCH 0, DERIVATION_MISMATCH 0, NOT_SUPPORTED_BY_SOURCE 0, IMPLAUSIBLE 0 |  |  |
| Planted book errors that surfaced as real agent conflicts | 36 / 36 |  | E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk |
| Messy CSV layouts parsed without errors | 7 / 7 |  | 02-windows-1250.csv: account currency asked from the user |

## By planted error type

| Type | Planted | Found | Missed | Extra |
|---|---|---|---|---|
| E1 | 10 | 10 | 0 | 0 |
| E2 | 8 | 8 | 0 | 0 |
| E3 | 10 | 10 | 0 | 0 |
| E4 | 8 | 8 | 0 | 0 |
| E5 | 12 | 12 | 0 | 0 |
| E6 | 8 | 8 | 0 | 0 |
| E7 | 8 | 8 | 0 | 0 |
| E8 | 8 | 8 | 0 | 0 |
| E9 | 10 | 10 | 0 | 0 |

## Misses

None in these runs.

Not financial or tax advice. Synthetic data only.
