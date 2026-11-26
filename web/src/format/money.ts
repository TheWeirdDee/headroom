// Display formatting only (sr-Latn-RS: dot for thousands, comma for decimals). String-based: amounts are
// decimal strings from the API and are never turned into floating-point numbers here.

export function formatSr(amount: string, places = 2): string {
  const negative = amount.startsWith('-');
  const body = negative ? amount.slice(1) : amount;
  const [intPart = '0', frac = ''] = body.split('.');
  const padded = places > 0 ? `,${(frac + '0'.repeat(places)).slice(0, places)}` : '';
  const grouped = intPart.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${padded}`;
}

export function formatRsd(amount: string): string {
  return `${formatSr(amount)} RSD`;
}

export function formatDateSr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}.` : iso;
}

/** A ratio ("0.966") as a percentage with one decimal, rounded half up, exact (no floating point). */
export function formatPercent(ratio: string): string {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(ratio.trim());
  if (!m) return ratio;
  const [, sign = '', int = '0', frac = ''] = m;
  const thousandths = BigInt(int + (frac + '000').slice(0, 3)); // ratio x 1000 = percent x 10, truncated
  const next = Number.parseInt((frac + '0000').charAt(3), 10);
  const r = next >= 5 ? thousandths + 1n : thousandths;
  const s = r.toString().padStart(2, '0');
  return `${sign && r !== 0n ? '-' : ''}${s.slice(0, -1)},${s.slice(-1)}%`;
}

/** A short human rendering of any figure value. */
export function valueText(v: import('../api/types.ts').FigureValue): string {
  switch (v.t) {
    case 'money':
      return `${formatSr(v.amount)} ${v.currency}`;
    case 'rate':
      return `${v.rate.replace('.', ',')} RSD per ${v.parity} ${v.base} (NBS ${formatDateSr(v.rateDate)})`;
    case 'date':
      return formatDateSr(v.iso);
    case 'text':
      return v.text;
    case 'ratio':
      return formatPercent(v.value);
    case 'tri':
      return v.value === 'met' ? 'met' : v.value === 'not_met' ? 'not met' : 'unknown';
    case 'kpoRow':
      return `${v.rowNo}. ${formatDateSr(v.date)} ${formatSr(v.totalRSD)} RSD`;
  }
}

/** "1.234,56" or "1234.56" -> "1234.56"; undefined when it is not a plain amount with at most 2 decimals. */
export function normaliseAmount(input: string): string | undefined {
  const s = input.trim().replace(/\s/g, '');
  let t = s;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s) || /^\d+,\d{1,2}$/.test(s))
    t = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) t = s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const [i = '0', f] = t.split('.');
  const int = i.replace(/^0+(?=\d)/, '');
  if (int === '0' && (f === undefined || /^0*$/.test(f))) return undefined;
  return f === undefined ? int : `${int}.${f}`;
}

/** Examples shown next to amount and decimal-mark inputs. */
export const AMOUNT_EXAMPLE = '1250000 or 1.250.000,00';
export const DECIMAL_COMMA_EXAMPLE = '1.234,56';
export const DECIMAL_DOT_EXAMPLE = '1,234.56';

/** A rule's RSD parameter (for example R-LIMIT-6M limitRSD) as display text, or undefined until rules load. */
export function ruleRsd(
  rules: Array<{ id: string; params?: Record<string, unknown> }> | undefined,
  id: string,
  param: string,
): string | undefined {
  const v = rules?.find((r) => r.id === id)?.params?.[param];
  return typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? formatSr(v, 0) + ' RSD' : undefined;
}
