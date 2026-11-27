# One live run of the current code

Run on 27 November 2026 at commit `0f1d044`, with `gemini-3.5-flash-lite` as reader and verifier model (free tier, paced at 10 requests a minute), on the small synthetic profile of the test suite (`smallProfile` in `test/helpers/profiles.ts`: 3 invoices, 5 bank rows, 2 KPO rows, 2 clients, 3 planted errors), with recorded NBS rates. It was started by a one-off script that calls the run engine and times each request. One run on one small profile: it shows that the current code works with a real model, and measures no accuracy.

The script's output:

```
model gemini-3.5-flash-lite | status awaiting_user | loops 27 | failed 0 | wall 190 s
requests 35 | peak requests 10 | peak agents 5 independence-checker,invoice-reader,kpo-reader,statement-reader,verifier
agents waiting together 11.7 s of 23.3 s busy
card {"complete":true,"gaps":[],"withDraft":"2558780.8","unbilled":"2808780.8"}
findings E1:payment:S1-3 E2:invoice:2026-001 E3:invoice:2026-003 | planted: E1:payment:S1-3 E2:invoice:2026-001 E3:invoice:2026-003
vetoed writes 0 | participant errors 0 | unsourced 0
```

Not financial or tax advice. Synthetic data only.
