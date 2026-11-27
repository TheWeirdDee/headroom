# Headroom evaluation results

Measured 2026-11-27 on 14 synthetic profiles we designed, runs per profile: c01 1, c02 1, p01 1, p02 1, p03 1, p04 1, p05 1, p06 1, p07 1, p08 1, p09 1, p10 1, p11 1, p12 1; mode fake, models fake-model (test) / fake-model (test), Mozaik 6.0.0, profile seed headroom-2026-11-26.

Fake mode uses the deterministic test model: it measures the pipeline, not model reading accuracy.


| Metric | Value | Target | Note |
|---|---|---|---|
| Planted errors detected | 40 / 40 (100.0%) |  | on 14 synthetic profiles we designed |
| False discrepancies on clean profiles | 0 in 2 runs | 0 |  |
| Findings that were not planted (all profiles) | 0 |  |  |
| Verified invoice facts equal to the truth | 459 / 459 (100.0%) |  | issue date, amount in RSD and kind of every invoice |
| Wrong figures that got verified | 0 | 0 | the most important miss: listed below with figure ids |
| Contested figures that were in fact wrong | 0 / 0 |  |  |
| Figures shown without a source | 0 | 0 |  |
| Runs with 6M and 8M totals (with the draft) equal to the truth | 14 / 14 |  |  |
| Profiles with identical headroom across runs | n/a |  | every profile ran once |
| Runs with a failed loop | 0 / 14 |  |  |
| Median loops running at once (peak) | 14.5 |  |  |
| Median loop time / wall time | 0.14 |  | the test model answers instantly, so wall time is mostly the quiet period that ends a run |
| Median wall time per run | 1.6 s |  |  |
| Median tokens per run (in / out) | 19000 / 4582 |  |  |
| Verifier contests by reason (all runs) | UNSOURCED 0, SOURCE_MISMATCH 0, DERIVATION_MISMATCH 0, NOT_SUPPORTED_BY_SOURCE 0, IMPLAUSIBLE 0 |  |  |
| Planted book errors that surfaced as real agent conflicts | 17 / 17 |  | E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk |
| Messy CSV layouts parsed without errors | 7 / 7 |  | 02-windows-1250.csv: account currency asked from the user |

## By planted error type

| Type | Planted | Found | Missed | Extra |
|---|---|---|---|---|
| E1 | 5 | 5 | 0 | 0 |
| E2 | 4 | 4 | 0 | 0 |
| E3 | 5 | 5 | 0 | 0 |
| E4 | 4 | 4 | 0 | 0 |
| E5 | 5 | 5 | 0 | 0 |
| E6 | 4 | 4 | 0 | 0 |
| E7 | 4 | 4 | 0 | 0 |
| E8 | 4 | 4 | 0 | 0 |
| E9 | 5 | 5 | 0 | 0 |

## Misses

None in these runs.

Not financial or tax advice. Synthetic data only.
