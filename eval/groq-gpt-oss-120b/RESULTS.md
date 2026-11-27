# Headroom evaluation results

Measured 2026-11-27 on 2 synthetic profiles we designed, runs per profile: c02 1, p01 1; mode live, models groq/openai/gpt-oss-120b / groq/openai/gpt-oss-120b, Mozaik 6.0.0, profile seed headroom-2026-11-26.


Incomplete: p03 run 1 hit the daily quota and was not counted.

| Metric | Value | Target | Note |
|---|---|---|---|
| Planted errors detected | 3 / 3 (100.0%) |  | on 2 synthetic profiles we designed |
| False discrepancies on clean profiles | 1 in 1 runs | 0 |  |
| Findings that were not planted (all profiles) | 2 |  |  |
| Verified invoice facts equal to the truth | 60 / 60 (100.0%) |  | issue date, amount in RSD and kind of every invoice |
| Wrong figures that got verified | 0 | 0 | the most important miss: listed below with figure ids |
| Contested figures that were in fact wrong | 0 / 0 |  |  |
| Figures shown without a source | 0 | 0 |  |
| Runs with 6M and 8M totals (with the draft) equal to the truth | 2 / 2 |  |  |
| Profiles with identical headroom across runs | n/a |  | every profile ran once |
| Runs with a failed loop | 0 / 2 |  |  |
| Median loops running at once (peak) | 15 |  |  |
| Median loop time / wall time | 10.16 |  | above 1 means loops overlapped |
| Median wall time per run | 575.6 s |  |  |
| Median tokens per run (in / out) | 67108.5 / 24588 |  |  |
| Verifier contests by reason (all runs) | UNSOURCED 0, SOURCE_MISMATCH 0, DERIVATION_MISMATCH 0, NOT_SUPPORTED_BY_SOURCE 0, IMPLAUSIBLE 0 |  |  |
| Planted book errors that surfaced as real agent conflicts | 0 / 0 |  | E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk |
| Messy CSV layouts parsed without errors | 7 / 7 |  | 02-windows-1250.csv: account currency asked from the user |

## By planted error type

| Type | Planted | Found | Missed | Extra |
|---|---|---|---|---|
| E1 | 1 | 1 | 0 | 0 |
| E3 | 1 | 1 | 0 | 0 |
| E8 | 1 | 1 | 0 | 0 |

## Misses

None in these runs.

Not financial or tax advice. Synthetic data only.
