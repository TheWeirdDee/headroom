// Is a cited value the field it is claimed to be? That the excerpt holds the value is not enough: a due
// date or a unit price is also "in the document". Code reads the label in front of the value, on the
// document's own lines (not only the excerpt, which may leave the label out), and compares it with the
// lines the document itself labels as the issue date or the total. Serbian and English labels.
import { amountsIn, datesIn } from '../../inputs/parse.ts';
import { canonical } from '../../domain/money.ts';
import type { ReadableDocument } from '../../inputs/documents.ts';
import type { SourceRef } from '../../domain/types.ts';

type DocumentRef = Extract<SourceRef, { type: 'document' }>;

const DATE_TOKEN = /\d{1,4}[./-]\s?\d{1,2}[./-]\s?\d{1,4}\.?/g;
const AMOUNT_TOKEN = /\d[\d.,' \u00a0]*\d|\d/g;

const DUE = /\brok\b|valuta pla|dosp|\bdue\b|pay(ment)? by|platiti do|plativo do/i;
const SUPPLY = /datum prometa|promet(a)? dobara|date of supply|supply date|delivery|isporuk/i;
const ISSUE = /^(datum izdavanja|datum fakture|datum računa|issue date|date of issue|invoice date)\b/i;

/** Lines that state what is to be paid in all. */
const TOTAL =
  /^(grand total|total|ukupno|ukupan iznos|za uplatu|iznos za uplatu|amount due|balance due|svega)\b/i;
/** Parts of an invoice that are not its total, even on a line that says "total". */
const PART =
  /unit price|price per|rate per|jedini[cč]na|cena po|po komadu|sub-?total|me[dđ]uzbir|osnovica|bez pdv|excl|net amount|discount|popust|rabat|advance|avans|(total|ukupan|iznos)\s+(vat|pdv|tax|poreza?)\b|^(vat|pdv|tax)\b/i;

interface Labelled {
  label: string;
  token: string;
}

/** Each value on a line with the text in front of it (since the previous value). */
function labelled(line: string, token: RegExp): Labelled[] {
  const out: Labelled[] = [];
  let from = 0;
  for (const m of line.matchAll(token)) {
    out.push({ label: line.slice(from, m.index).replace(/^[\s,;:|()-]+/, ''), token: m[0] });
    from = m.index + m[0].length;
  }
  return out;
}

const lines = (page: string): string[] => page.split('\n');

/** The values the excerpt's lines show, each with its label (taken from the line above if there is none). */
function cited(doc: ReadableDocument, ref: DocumentRef, token: RegExp): Labelled[] {
  const page = lines(doc.pages[ref.page - 1] ?? '');
  const out: Labelled[] = [];
  for (let i = ref.lineStart - 1; i < ref.lineEnd; i++) {
    for (const v of labelled(page[i] ?? '', token)) {
      const bare = !/\p{L}{2}/u.test(v.label.replace(/\b(RSD|EUR|USD|GBP|CHF|din)\b/gi, ''));
      out.push(bare ? { ...v, label: (page[i - 1] ?? '').trim() } : v);
    }
  }
  return out;
}

function everywhere(doc: ReadableDocument, token: RegExp): Labelled[] {
  return doc.pages.flatMap((p) => lines(p).flatMap((l) => labelled(l, token)));
}

/** Why the date is not this invoice's issue (or supply) date; undefined if nothing speaks against it. */
export function wrongDate(
  doc: ReadableDocument,
  ref: DocumentRef,
  iso: string,
  field: 'issueDate' | 'supplyDate',
): string | undefined {
  const here = cited(doc, ref, DATE_TOKEN).filter((v) => datesIn(v.token).has(iso));
  const wrong = (label: string): boolean => DUE.test(label) || (field === 'issueDate' && SUPPLY.test(label));
  if (here.length > 0 && here.every((v) => wrong(v.label)))
    return `${iso} is the date labelled "${here[0]?.label.trim()}", not the ${field === 'issueDate' ? 'issue' : 'supply'} date`;
  if (field !== 'issueDate') return undefined;
  const stated = everywhere(doc, DATE_TOKEN).filter((v) => ISSUE.test(v.label));
  if (stated.length > 0 && !stated.some((v) => datesIn(v.token).has(iso)))
    return `the document labels ${stated[0]?.token} as the issue date, not ${iso}`;
  return undefined;
}

/** Why the amount is not this invoice's total; undefined if nothing speaks against it. */
export function wrongAmount(doc: ReadableDocument, ref: DocumentRef, amount: string): string | undefined {
  const want = canonical(amount);
  const holds = (v: Labelled): boolean => amountsIn(v.token).has(want);
  const here = cited(doc, ref, AMOUNT_TOKEN).filter(holds);
  const part = (label: string): boolean => PART.test(label);
  if (here.length > 0 && here.every((v) => part(v.label)))
    return `${amount} is the amount labelled "${here[0]?.label.trim()}", not the invoice total`;
  const totals = everywhere(doc, AMOUNT_TOKEN).filter((v) => TOTAL.test(v.label) && !part(v.label));
  if (totals.length > 0 && !totals.some(holds))
    return `the document labels ${totals.at(-1)?.token.trim()} as the total, not ${amount}`;
  return undefined;
}
