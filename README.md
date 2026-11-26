# Headroom

Before a Serbian paušalac sends an invoice, Headroom shows how much room is left under the 6M limit. Every number proven.

**Not financial or tax advice · Bundled samples are synthetic**

Built for the JigJoy Black Friday AI Hackathon (track: Agents in Finance) on Mozaik (`@mozaik-ai/core` 6.0.0).

> Demo GIF: recorded from the offline replay of `runs/demo-p07` once that recording is made with a real model (`npm run record-demo`). Until then, run the app (below) to see it.

## Who it is for, and the moment

A Belgrade IT freelancer on paušal, with two or three clients (mostly foreign, invoiced in EUR) and one domestic client. It is late November, and they are about to invoice December's work for their biggest client.

They do not know whether this invoice pushes calendar-year turnover past 6,000,000 RSD once each foreign invoice is converted at the right NBS rate, whether a payment that landed in September without an invoice changes that answer, or whether the client's share of their income now meets criterion 6 of the independence test.

Headroom answers those three questions from their own bank statement, invoices and KPO book, before they press send, and shows the line each number came from.

## Use it on your own files

```
git clone <repo> && cd headroom
npm run setup
cp .env.example .env         # add your Gemini key (GEMINI_API_KEY, free at aistudio.google.com)
npm start                    # open http://localhost:4317
```

Then drop in your bank statement CSV, invoice PDFs and KPO book, map the columns if asked, fill in the invoice you are about to send, and click **Check this invoice**. Requirements: Node 22 and a model key. Gemini is the default because it has a free tier; requests are paced (10 a minute by default, `HEADROOM_MAX_RPM`) so the free quota slows a run down instead of failing it. Claude, GPT and DeepSeek models work too (set `HEADROOM_MODEL_READER` / `HEADROOM_MODEL_VERIFIER` and that provider's key). Tested on Linux (Ubuntu); macOS and Windows are not yet tested.

## Try it without your files or a key

```
npm run start:offline        # bundled sample, recorded model outputs, no key, no network
```

Or click **Try with sample data** on the landing page. Offline mode is real Mozaik execution with recorded model outputs, not a video. If a recorded run asks for anything that was not recorded, it stops with `REPLAY_MISS` instead of inventing an answer.

## What you will see

1. The landing page: the 6M limit, unchanged since 2013 (cited), what crossing it means (cited), and two buttons.
2. Intake: your files, a column mapper for CSV layouts it does not recognise, your clients and the draft invoice.
3. Seven agent lanes start at once, each with a plain "doing now" line.
4. Figures appear on the board as proposed, then turn verified, contested or needs-you as the Verifier checks each against its source.
5. Conflicts are visible: the KPO book says one date or amount, the invoice says another, and the source decides.
6. The headroom card fills in once its inputs are verified. When a correction moves the band, the card says which discrepancy did it.
7. Discrepancies and questions collect below the board. Answering a question re-opens the run and the dependent agents recompute.
8. The KPO book tab shows the corrected book in the official layout with a correction log, exportable as CSV or PDF.
9. The Evidence tab shows the evaluation results, misses included.

## Your data

- Uploaded files stay on your machine, in `uploads/<id>/`. **Delete my files** on the intake page removes them.
- In live mode, the extracted text of your invoices, statement rows and KPO rows is sent to the model provider (Google Gemini by default) to be read. Nothing else leaves the machine: arithmetic, rules and totals run locally.
- NBS middle rates come from the public Kurs API (`kurs.resenje.org`); only currency and date are sent.
- Runs on your files are never recorded. Only bundled synthetic samples can be recorded for offline replay.

## How it uses Mozaik

| Capability                                          | Mozaik feature                                                    | Where                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Seven agents in parallel, one loop per unit of work | `runLoop`, `createAgent`                                          | `src/runtime/mozaik/adapter.ts`                             |
| One shared Figure Board                             | `RuntimeState` subclass                                           | `src/runtime/mozaik/adapter.ts`, `src/runtime/state.ts`     |
| Agents react to each other's figures and answers    | semantic events and situation handlers (`SituationSpecification`) | `src/runtime/mozaik/adapter.ts`, `src/agents/*/agent.ts`    |
| No figure is written without a source               | `InterceptionHandler` veto on board tool calls                    | `src/runtime/veto.ts`, `src/runtime/mozaik/adapter.ts`      |
| Readers return typed figures                        | structured output through submit tools with JSON Schema           | `src/agents/common.ts`                                      |
| Offline mode, recording, timeouts and retries       | custom `InferenceRunner`                                          | `src/runtime/mozaik/adapter.ts`, `src/engine/recordings.ts` |

Concurrency carries the product. Three readers, the Verifier, the RateClerk and the LimitKeeper work at the same time on one board. Readers claim the same keys: the InvoiceReader and the KpoReader both state an invoice's date and RSD amount, the RateClerk re-derives the amount from the NBS rate. Agreement corroborates; disagreement is a conflict that the claims helper and the source-authority order settle (invoice document over KPO row for invoice facts, statement row over document for payment facts), and the losing figure becomes the discrepancy the user sees.

## Proof it is concurrent

From the evaluation in fake mode (deterministic test model, 14 profiles): a median peak of 13 loops running at the same time, 63 loops for the showcase profile `p07`. The run screen draws every loop as a bar on a timeline. Live-model medians for loop overlap and wall time are published once the live evaluation has run.

## Every number has a source

Every figure carries `SourceRef`s: a document page and line range with the excerpt and its SHA-256, a statement or KPO row with its raw line and hash, an NBS response with its hash and JSON path, a contract field, a rule, a user answer, or the input figures it was derived from. The Verifier checks each proposed figure before it counts: the source exists, the hash matches, derived values recompute exactly, the value matches the source (code checks dates, amounts, currency and invoice numbers; a model only judges country, kind and contract criteria), and the value is plausible. A failed check contests the figure with a reason code; after three contests on one key the question goes to you. Only verified figures reach the headroom card, and the run report counts figures shown without a source (it must be 0).

## Results

`npm run eval` runs every bundled profile against its ground truth. The table below is from **fake mode** (14 synthetic profiles we designed, one run each, deterministic test model). It measures the pipeline (rules, Verifier, conflicts, totals), not how well a real model reads documents. Live-model results (3 runs per profile) need a model key and are published in `eval/RESULTS.md` and on the Evidence page when measured.

| Metric                                                         | Value                                                                                           | Target | Note                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Planted errors detected                                        | 40 / 40 (100.0%)                                                                                |        | on 14 synthetic profiles we designed                                                      |
| False discrepancies on clean profiles                          | 0 in 2 runs                                                                                     | 0      |                                                                                           |
| Findings that were not planted (all profiles)                  | 0                                                                                               |        |                                                                                           |
| Verified invoice facts equal to the truth                      | 459 / 459 (100.0%)                                                                              |        | issue date, amount in RSD and kind of every invoice                                       |
| Wrong figures that got verified                                | 0                                                                                               | 0      | the most important miss: listed below with figure ids                                     |
| Contested figures that were in fact wrong                      | 0 / 0                                                                                           |        |                                                                                           |
| Figures shown without a source                                 | 0                                                                                               | 0      |                                                                                           |
| Runs with 6M and 8M totals (with the draft) equal to the truth | 14 / 14                                                                                         |        |                                                                                           |
| Profiles with identical headroom across runs                   | 14 / 14                                                                                         |        |                                                                                           |
| Median loops running at once (peak)                            | 14                                                                                              |        |                                                                                           |
| Median loop time / wall time                                   | 0.19                                                                                            |        | the test model answers instantly, so wall time is mostly the quiet period that ends a run |
| Median wall time per run                                       | 1.6 s                                                                                           |        |                                                                                           |
| Median tokens per run (in / out)                               | 19000 / 4582                                                                                    |        |                                                                                           |
| Verifier contests by reason (all runs)                         | UNSOURCED 0, SOURCE_MISMATCH 0, DERIVATION_MISMATCH 0, NOT_SUPPORTED_BY_SOURCE 0, IMPLAUSIBLE 0 |        |                                                                                           |
| Planted book errors that surfaced as real agent conflicts      | 17 / 17                                                                                         |        | E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk                              |
| Messy CSV layouts parsed without errors                        | 7 / 7                                                                                           |        | 02-windows-1250.csv: account currency asked from the user                                 |

| Type | Planted | Found | Missed | Extra |
| ---- | ------- | ----- | ------ | ----- |
| E1   | 5       | 5     | 0      | 0     |
| E2   | 4       | 4     | 0      | 0     |
| E3   | 5       | 5     | 0      | 0     |
| E4   | 4       | 4     | 0      | 0     |
| E5   | 5       | 5     | 0      | 0     |
| E6   | 4       | 4     | 0      | 0     |
| E7   | 4       | 4     | 0      | 0     |
| E8   | 4       | 4     | 0      | 0     |
| E9   | 5       | 5     | 0      | 0     |

## Architecture

```
Browser (React + Vite): landing, intake + column mapper, run screen, KPO, evidence
        |  REST + SSE (/api/runs/:id/stream, Last-Event-ID resume)
Node 22 backend (Fastify)
  Run engine: one Mozaik runtime per run
    Mozaik adapter (src/runtime/mozaik/): the only place that imports Mozaik
    Figure Board (RuntimeState) + claims helper (packages/claims)
    Agents: InvoiceReader, StatementReader, KpoReader, RateClerk, LimitKeeper,
            IndependenceChecker, Verifier; Human (answers, draft changes)
    Rules engine (pure TypeScript, rules/*.json, exact decimals)
    Recorder / replayer, quiescence detector
  Exporters: KPO CSV and PDF, correction log, run report JSON
        |                                     |
  Model provider (via Mozaik)        Kurs API (NBS middle rates)
```

- **InvoiceReader** reads invoice PDFs and proposes number, dates, amount, currency, client and kind, each with its line excerpt.
- **StatementReader** classifies incoming statement rows and links payments to invoices.
- **KpoReader** reads the user's KPO book and claims each row against the invoices.
- **RateClerk** fetches the NBS middle rate for each foreign invoice date and converts to RSD.
- **LimitKeeper** totals verified turnover for the 6M limit and the 8M VAT window, with and without the draft, and explains band crossings.
- **IndependenceChecker** evaluates the nine criteria per client, including the income share of criterion 6.
- **Verifier** checks every figure against its source before it counts.

The event types are defined in `src/events/schemas.ts`.

## Tax rules used

| Rule                         | Statement                                                                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                                                                                                            | Status              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `R-FX`                       | For bookkeeping, the official NBS middle rate of the dinar applies.                                                                                                                                                                                                                                                                                                                                         | [Zakon o deviznom poslovanju](https://www.paragraf.rs/propisi/zakon_o_deviznom_poslovanju.html)                                                                                                                                   | Sourced             |
| `R-FX-DATE`                  | A foreign-currency invoice is converted at the NBS middle rate on its issue date.                                                                                                                                                                                                                                                                                                                           | [Unija: KPO knjiga](https://unija.com/sr/kpo-knjiga/)                                                                                                                                                                             | Assumption [VERIFY] |
| `R-FX-NONPUB`                | On weekends and holidays, when NBS publishes no new rate, the most recent published rate is used. Both the requested date and the rate date are shown.                                                                                                                                                                                                                                                      | [Kurs API documentation](https://kurs.resenje.org/doc/)                                                                                                                                                                           | Assumption [VERIFY] |
| `R-FX-ROUNDING`              | The RSD amount is rounded to two decimals, half up.                                                                                                                                                                                                                                                                                                                                                         | [Zakon o deviznom poslovanju](https://www.paragraf.rs/propisi/zakon_o_deviznom_poslovanju.html)                                                                                                                                   | Assumption [VERIFY] |
| `R-INDEP`                    | Income from a client is treated as "other income" instead of self-employment income if, for that client, at least five of the nine criteria are met (or it could be concluded at the start of the work that five would be met and they later were). Evaluated per client.                                                                                                                                   | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Sourced             |
| `R-INDEP-EXEMPT`             | The test does not apply to an entrepreneur who, under the law governing their activity, cannot be employed by the client (for example a lawyer).                                                                                                                                                                                                                                                            | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Sourced             |
| `R-INDEP-C6-WINDOWS`         | Every 12-calendar-month period that starts or ends in the tax year is checked; the card shows the highest share and its period.                                                                                                                                                                                                                                                                             | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Sourced             |
| `R-INDEP-C6-HORIZON`         | Headroom evaluates the 12-month periods that have ended by the month being checked (the as-of month, or the draft invoice month for the with-draft share) and that your files cover, plus always the 12 months up to that month. A period reaching into the future, or mostly before your files start, holds only part of its income, so its share would mislead. Another period may still reach 70% later. | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Headroom convention |
| `R-INDEP-C6-BASIS`           | Income is counted from issued invoices in RSD by issue date. The law says "ostvarenih prihoda" (income earned) and does not say invoiced or received.                                                                                                                                                                                                                                                       | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Assumption [VERIFY] |
| `R-INDEP-CONSEQUENCE`        | Income from that client may be taxed as other income: 20% tax plus 25.5% pension and disability (PIO) contributions, with no standardised expenses deducted. Headroom does not calculate any amount.                                                                                                                                                                                                        | [Biznis.rs](https://biznis.rs/preduzetnik/preduzetnici-na-proveri-poslovne-samostalnosti/)                                                                                                                                        | Sourced             |
| `R-INDEP-WHO-FILES`          | Check who files and pays. Not confirmed for foreign clients.                                                                                                                                                                                                                                                                                                                                                | [Poreska uprava: Tax bulletins for natural persons who are self-employed](https://www.purs.gov.rs/upload/media/2025/6/30/759981/Tax_bulletins_for_natural_persons_who_are_self_-_employed.pdf)                                    | Assumption [VERIFY] |
| `R-KPO`                      | A paušal entrepreneur keeps only the KPO book, recording income from products sold and services provided; every issued invoice is entered, paid or not.                                                                                                                                                                                                                                                     | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Sourced             |
| `R-KPO-LAYOUT`               | Columns: 1 row number; 2 date and description; 3 income from products; 4 income from services; 5 total (3 + 4). Header: PIB, taxpayer name, business name, address, taxpayer code, activity code.                                                                                                                                                                                                           | [Pravilnik o poslovnim knjigama i iskazivanju finansijskog rezultata po sistemu prostog knjigovodstva](https://www.paragraf.rs/propisi/pravilnik-o-poslovnim-knjigama-finansijski-rezultat-po-sistemu-prostog-knjigovodstva.html) | Sourced             |
| `R-KPO-DATE`                 | Column 2 takes the invoice issue date and number.                                                                                                                                                                                                                                                                                                                                                           | [Pravilnik o poslovnim knjigama i iskazivanju finansijskog rezultata po sistemu prostog knjigovodstva](https://www.paragraf.rs/propisi/pravilnik-o-poslovnim-knjigama-finansijski-rezultat-po-sistemu-prostog-knjigovodstva.html) | Assumption [VERIFY] |
| `R-PAYMENT-NO-INVOICE`       | A payment was received with no matching invoice. Headroom states only the fact and its statement row; no legal obligation or deadline is claimed.                                                                                                                                                                                                                                                           | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Assumption [VERIFY] |
| `R-NUMBERING`                | A gap in invoice numbering is shown as worth checking, not as an error.                                                                                                                                                                                                                                                                                                                                     | [Pravilnik o poslovnim knjigama i iskazivanju finansijskog rezultata po sistemu prostog knjigovodstva](https://www.paragraf.rs/propisi/pravilnik-o-poslovnim-knjigama-finansijski-rezultat-po-sistemu-prostog-knjigovodstva.html) | Assumption [VERIFY] |
| `R-LIMIT-6M`                 | Flat-rate taxation is not granted to a taxpayer whose total turnover in the year before the tax year (or planned turnover when starting) is above 6,000,000 dinars. When the limit is crossed during a year, the tax office orders business books from mid-year or from the next year (Art. 42). Headroom sums the calendar-year turnover of issued invoices against this limit.                            | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Sourced             |
| `R-LIMIT-6M-BASIS`           | Turnover is counted by invoice issue date within the calendar year, summed across all activities. A payment received without an invoice is shown as a discrepancy, not as turnover.                                                                                                                                                                                                                         | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Assumption [VERIFY] |
| `R-LIMIT-6M-CONSEQUENCE`     | Crossing 6M means keeping full business books: from 1 July if crossed in the first half of the year, otherwise from 1 January of the next year.                                                                                                                                                                                                                                                             | [Biznis.rs](https://biznis.rs/vesti/srbija/limit-od-sest-miliona-dinara-koci-razvoj-preduzetnika/)                                                                                                                                | Sourced             |
| `R-LIMIT-6M-INDEP-EXCLUSION` | Income taxed as other income after a failed independence test is not counted in the 6M turnover. Headroom does not apply this automatically; it notes it when a client shows "fails".                                                                                                                                                                                                                       | [Zakon o porezu na dohodak građana](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dohodak_gradjana.html)                                                                                                                      | Sourced             |
| `R-LIMIT-BANDS`              | Green below 80%, amber from 80% to below 90%, red from 90% to below 100%, crossed at 100% or more. The 90% line mirrors the Minimax warning.                                                                                                                                                                                                                                                                | [Minimax help: Upozorenje za ulazak paušalaca u knjigaše ili za ulazak u sistem PDV-a](https://rs-minimax.knowledgeowl.com/help/upozorenje-za-ulazak-pausalaca-u-knjigase-ili-za-ulazak-u-sistem-pdv-a)                           | Headroom convention |
| `R-VAT-8M`                   | A small taxpayer is one whose total turnover of goods and services in the previous 12 months is not above 8,000,000 dinars. "Previous 12 months" is 365 days (366 in a leap period) ending on the day of the turnover.                                                                                                                                                                                      | [Zakon o porezu na dodatu vrednost](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dodatu_vrednost.html)                                                                                                                       | Sourced             |
| `R-VAT-8M-SCOPE`             | Counted: all goods, including goods exported abroad (exempt with the right to deduction), services to clients in Serbia, and services to foreign clients that are not businesses. Not counted: services to foreign business clients, because they are supplied where the client has its seat.                                                                                                               | [Zakon o porezu na dodatu vrednost](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dodatu_vrednost.html)                                                                                                                       | Sourced             |
| `R-VAT-8M-REGISTRATION`      | A taxpayer whose turnover in the previous 12 months goes above 8,000,000 dinars must file a VAT registration (evidenciona prijava) within five days of the day that turnover was reached.                                                                                                                                                                                                                   | [Zakon o porezu na dodatu vrednost](https://www.paragraf.rs/propisi/zakon_o_porezu_na_dodatu_vrednost.html)                                                                                                                       | Sourced             |
| `R-VAT-8M-BASIS`             | Turnover is placed in the window by invoice issue date.                                                                                                                                                                                                                                                                                                                                                     | [Minimax help: Upozorenje za ulazak paušalaca u knjigaše ili za ulazak u sistem PDV-a](https://rs-minimax.knowledgeowl.com/help/upozorenje-za-ulazak-pausalaca-u-knjigase-ili-za-ulazak-u-sistem-pdv-a)                           | Assumption [VERIFY] |

Rules marked **Assumption [VERIFY]** are not confirmed by an official source and appear as assumption chips wherever they affect a number.

## Limitations

Headroom runs on synthetic data and a rules table we sourced from public Serbian guidance; rules marked as assumptions still need an accountant's confirmation, and it does not calculate tax owed.

- No OCR: scanned PDFs without a text layer are listed as unreadable.
- The column mapper supports no bank by name; unknown layouts are mapped by hand.
- Only the products and services split of the KPO book; no credit notes or advances.
- No SEF e-invoicing integration.
- Special VAT place-of-supply cases are not modelled.

## packages/claims

A small synchronous claims store: agents propose a value for a key with sources; the store answers claimed, corroborated, conflict, stale or duplicate, keeps one verified record per key, and delivers change events after each mutation. It has no Headroom or Mozaik dependency. See `packages/claims/README.md`.

## Development

```
npm run dev          # API with reload on :4317 and Vite on :5173
npm test             # unit and integration tests (deterministic test model)
npm run test:e2e     # Playwright against the real server
npm run lint && npm run typecheck
npm run eval -- --mode fake
```

## Credits and licence

MIT. See `LICENSE`. Inter font under the SIL Open Font License (`assets/fonts/OFL.txt`). NBS rates via the Kurs API by resenje.org. Built on Mozaik by JigJoy.
