# Evaluation and recordings

What has been measured, on what, and when. All data is synthetic. Not financial or tax advice.

`npm run eval` runs bundled profiles against their ground truth and writes `eval/results.json` and `eval/RESULTS.md` (the app's Evidence page shows them).

## The recorded sample

The recording in `runs/demo-p07` was made on 27 Nov 2026 with `gemini-3.1-flash-lite` as both reader and verifier model (free tier), on Mozaik 6.0.0 (`runs/demo-p07/meta.json`, `summary.json`). In that run: 66 loops, none failed; 85 model requests; 219 figures verified and 0 shown without a source; **3 conflicts between two agents** (the KpoReader against the InvoiceReader once, and against the RateClerk twice), each settled by the source; all six errors planted in the sample found (E1, E2, E3, E5 twice, E9) and nothing else; the 6M and 8M totals equal to the sample's ground truth; 376 s from start to finish, paced for the free tier. Three figures were contested by code checks (an invoice amount cited without its currency) and verified after the reader read the invoice again. Replaying it ten times in a row gives the same board each time (figures, values, sources, findings and card; ids and timestamps aside). All live results here come from small free-tier models; a stronger model may read better.

The first recordings, on 26 November with `gemini-3.5-flash-lite`, are in the git history. The first of them missed E1: the Verifier's model rejected correct judgements as too literal ("Uplata za konsultacije", a payment for consultations, was not accepted as a client payment; "Nemačka" was not accepted as Germany), and a reader did not re-read a contested row, so the payment never reached the E1 check. The second found everything but left one contract criterion contested for the same reason. The fixes (the Verifier gets the same category meanings as the reader; every reader re-reads a contested figure at most twice, then the question goes to you) are in the history next to the recordings.

The ten-replay claim is a test (`test/engine/replay.e2e.test.ts`).

## Results

### Latest runs: Gemini `gemini-3.1-flash-lite`

Measured 27 Nov 2026 with `gemini-3.1-flash-lite` as reader and verifier model (free tier), **on 4 synthetic profiles we designed, one run each**: `c01` (clean), `p01`, `p02`, `p03`. A fifth profile hit the daily quota and was not counted. Results: `eval/live-gemini-3.1/`.

| Metric (4 runs)                                | Value     |
| ---------------------------------------------- | --------- |
| Planted errors found                           | 8 / 9     |
| Findings that were not planted                 | 0         |
| Verified invoice facts equal to the truth      | 131 / 132 |
| **Wrong figures that got verified**            | **1**     |
| Figures shown without a source                 | 0         |
| Runs with 6M and 8M totals equal to the truth  | 2 / 4     |
| Runs with a failed loop                        | 1 / 4     |
| Planted book errors that surfaced as conflicts | 4 / 4     |

Both misses came from Headroom, not the model.

- **`p03`: a wrong figure verified.** The KPO book claimed an invoice's RSD amount while the converted amount was still waiting for its rate to be verified. The book's claim was checked alone, and verifying it retired the conversion, so the card showed a complete but wrong total (300.383,16 instead of 301.139,25 RSD for that invoice). Reproduced afterwards in 1 of 40 randomized runs, then fixed: a claim now waits for a stronger one that is still being checked ([test](../test/agents/verifier-race.test.ts)); 34 further randomized runs gave no wrong figure.
- **`p01`: E3 missed.** Two invoice reads failed on a dropped connection, which was not retried. The card stayed incomplete and the run said so. Dropped connections are now retried.

### One live run that switched models twice

27 Nov 2026, the small test-suite profile (3 invoices, 3 planted errors), with two models whose free daily quota was already used up first in line: `gemini-3.5-flash-lite`, then `gemini-3.1-flash-lite`, then `groq/openai/gpt-oss-20b`. Headroom moved on twice and reported which backup answered (371 s). The last model, a small 20B one, was weak: one contract read failed on malformed tool arguments, so the run ended `degraded` with an incomplete card, and it matched no book row to an invoice, so two invoices the book does state were reported missing from it. That false finding is fixed: a row that states an invoice number is now flagged to be checked instead ([test](../test/engine/completeness.e2e.test.ts)). Groq is used as a backup only when named; the default backup is a Gemini model.

### With a real model: Gemini `gemini-3.5-flash-lite`

Measured 27 Nov 2026 with `gemini-3.5-flash-lite` as reader and verifier model (free tier), Mozaik 6.0.0, profile seed `headroom-2026-11-26`, **on 5 of our 14 synthetic profiles, 7 runs**: `c01` (clean) and `p07` (showcase) twice each, `p02`, `p05` and `p06` once. Together they contain every planted error type, E1 to E9. The other 9 profiles were not run with a real model: the free tier allows 500 requests a day for this model and a run needs about 85. Full table: `eval/RESULTS.md`; per-run files with the commit each ran on: `eval/raw/`.

| Metric (7 runs)                                      | Value                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Planted errors found                                 | 19 / 19, all nine types (on 5 synthetic profiles we designed)        |
| Findings on the clean profile                        | 0 in 2 runs                                                          |
| Findings that were not planted                       | 0                                                                    |
| Verified invoice facts equal to the truth            | 222 / 222 (issue date, amount in RSD, kind)                          |
| Wrong figures that got verified                      | 0                                                                    |
| Figures shown without a source                       | 0                                                                    |
| Runs with 6M and 8M totals equal to the truth        | 7 / 7                                                                |
| Same headroom when a profile is run again            | 2 / 2 (only `c01` and `p07` were run twice)                          |
| Runs with a failed loop                              | 0 / 7                                                                |
| Planted book errors that surfaced as agent conflicts | 8 / 8 (E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk) |
| Verifier contests                                    | 5, all NOT_SUPPORTED_BY_SOURCE, each settled by a re-read            |
| Median loops open at once (peak) / loop ÷ wall time  | 15 / 10.73 (wall time is mostly the request pacer)                   |
| Median wall time / tokens per run                    | 482 s / 64,203 in, 6,934 out                                         |

The first runs of `c01` and `p07` were made before the claims fix of commit `64de262` (described below); the other five on commit `78f16f1`. The model did fall short before these runs: the first demo recording missed E1 (see "The recorded sample" above). Commits made after these runs changed the pipeline (the card gives a verdict only once every input is verified, E1 matches one payment to one invoice, the Verifier checks which field a value comes from, and the agents were rebuilt as Mozaik participants), and the runs above have not been repeated since. Seven runs on five profiles is a small sample; it shows the pipeline holding up with a small free model, not a measured accuracy.

### One live run on a small sample

After the later changes, one run was made on 27 Nov 2026 at commit `0f1d044` with `gemini-3.5-flash-lite`, on the small synthetic profile of the test suite (3 invoices, 3 planted errors), because the day's free quota did not cover a full sample. All 3 planted errors were found and nothing else; 35 model requests, 27 loops, none failed; the card was complete; up to 10 requests and all 5 model agents were waiting on the model at the same time. Output: [eval/live-current/RESULTS.md](../eval/live-current/RESULTS.md). It measures no accuracy.

### With a second real model: Groq `gpt-oss-120b` (partial, separate table)

Measured 27 Nov 2026 with `groq/openai/gpt-oss-120b` as reader and verifier model through Groq's free tier, **on 2 other synthetic profiles we designed, one run each**: `c02` (clean) and `p01` (3 planted errors). Groq's free tier allowed two runs that day (8,000 tokens a minute, about 200,000 a day; a run uses about 90,000). The next run, `p03`, hit the daily limit and was not counted. Results in `eval/groq-gpt-oss-120b/`.

| Metric (2 runs)                               | Value                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Planted errors found                          | 3 / 3 (E1, E3, E8 in `p01`)                                                                            |
| Verified invoice facts equal to the truth     | 60 / 60                                                                                                |
| Wrong figures that got verified               | 0                                                                                                      |
| Figures shown without a source                | 0                                                                                                      |
| Runs with 6M and 8M totals equal to the truth | 2 / 2                                                                                                  |
| Runs with a failed loop                       | 0 / 2                                                                                                  |
| **Findings that were not planted**            | **2: one E-CONFLICT on criterion 6 for client Linden, in each run (one of them on the clean profile)** |

The two false findings came from Headroom, not the model: the IndependenceChecker recomputed criterion 6 while its first value was still waiting for the Verifier (Groq's pacing makes that window long), and the claims helper treated the two versions as a conflict between equal sources. Fixed in commit `64de262` (an agent's new value for its own claim now supersedes it); these two runs were made before the fix.

### With the deterministic test model (all 14 profiles)

The table below is from **fake mode** (14 synthetic profiles we designed, two runs each, a deterministic test model, run on the current code with `npm run eval -- --mode fake --runs 2`). It measures the pipeline (rules, Verifier, conflicts, totals), not how well a real model reads documents.

| Metric                                                         | Value                                                                                           | Target | Note                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planted errors detected                                        | 82 / 82 (100.0%)                                                                                |        | on 14 synthetic profiles we designed                                                                                                                                                                                                                 |
| False discrepancies on clean profiles                          | 0 in 4 runs                                                                                     | 0      |                                                                                                                                                                                                                                                      |
| Findings that were not planted (all profiles)                  | 0                                                                                               |        |                                                                                                                                                                                                                                                      |
| Verified invoice facts equal to the truth                      | 918 / 918 (100.0%)                                                                              |        | issue date, amount in RSD and kind of every invoice                                                                                                                                                                                                  |
| Wrong figures that got verified                                | 0                                                                                               | 0      | the most important miss: listed below with figure ids                                                                                                                                                                                                |
| Contested figures that were in fact wrong                      | 0 / 0                                                                                           |        |                                                                                                                                                                                                                                                      |
| Figures shown without a source                                 | 0                                                                                               | 0      |                                                                                                                                                                                                                                                      |
| Runs with 6M and 8M totals (with the draft) equal to the truth | 28 / 28                                                                                         |        |                                                                                                                                                                                                                                                      |
| Profiles with identical headroom across runs                   | 14 / 14                                                                                         |        | measured only on profiles with more than one run: c01 (2 runs), c02 (2 runs), p01 (2 runs), p02 (2 runs), p03 (2 runs), p04 (2 runs), p05 (2 runs), p06 (2 runs), p07 (2 runs), p08 (2 runs), p09 (2 runs), p10 (2 runs), p11 (2 runs), p12 (2 runs) |
| Runs with a failed loop                                        | 0 / 28                                                                                          |        |                                                                                                                                                                                                                                                      |
| Median loops running at once (peak)                            | 15                                                                                              |        |                                                                                                                                                                                                                                                      |
| Median loop time / wall time                                   | 0.64                                                                                            |        | the test model answers instantly, so wall time is mostly the quiet period that ends a run                                                                                                                                                            |
| Median wall time per run                                       | 2.3 s                                                                                           |        |                                                                                                                                                                                                                                                      |
| Median tokens per run (in / out)                               | 19000 / 4582                                                                                    |        |                                                                                                                                                                                                                                                      |
| Verifier contests by reason (all runs)                         | UNSOURCED 0, SOURCE_MISMATCH 0, DERIVATION_MISMATCH 0, NOT_SUPPORTED_BY_SOURCE 0, IMPLAUSIBLE 0 |        |                                                                                                                                                                                                                                                      |
| Planted book errors that surfaced as real agent conflicts      | 36 / 36                                                                                         |        | E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk                                                                                                                                                                                         |
| Messy CSV layouts parsed without errors                        | 7 / 7                                                                                           |        | 02-windows-1250.csv: account currency asked from the user                                                                                                                                                                                            |

| Type | Planted | Found | Missed | Extra |
| ---- | ------- | ----- | ------ | ----- |
| E1   | 10      | 10    | 0      | 0     |
| E2   | 8       | 8     | 0      | 0     |
| E3   | 10      | 10    | 0      | 0     |
| E4   | 8       | 8     | 0      | 0     |
| E5   | 12      | 12    | 0      | 0     |
| E6   | 8       | 8     | 0      | 0     |
| E7   | 8       | 8     | 0      | 0     |
| E8   | 8       | 8     | 0      | 0     |
| E9   | 10      | 10    | 0      | 0     |

## What has not been measured

- Only five of the 14 sample profiles have been run live on the late code of 27 November (`p07`, `c01`, `p01`, `p02`, `p03`), and none since the two fixes those runs led to.
- The Groq re-run of `c02` and `p01` after the false-finding fix stopped at Groq's daily quota and was not counted. The fix has a unit test (`packages/claims/test/claims.test.ts`).
- No profile was run three times live.
- Only Gemini and Groq models have been run.
