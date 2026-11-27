// Client payments with no invoice (E1) are not turnover (R-LIMIT-6M-BASIS), but the invoice the user is
// about to send may cross the 6M line once they are invoiced. This is the one definition of that total:
// the LimitKeeper posts it, the Verifier re-derives it and the card's completeness check expects it.
import { add, type DecimalString } from '../../domain/money.ts';
import { convertToRsd } from '../../domain/fx.ts';
import { keys } from '../../domain/keys.ts';
import { yearOf } from '../../domain/dates.ts';
import type { HeadroomState } from '../../runtime/state.ts';
import type { Discrepancy, Figure } from '../../domain/types.ts';

export interface UnbilledPayment {
  discrepancy: Discrepancy;
  amount: Figure;
  date: Figure;
  /** Present for a foreign-currency payment: the NBS rate of its date. */
  rate?: Figure;
  amountRSD: DecimalString;
}

export interface Unbilled {
  /** Verified E1 payments received in the tax year, in a stable order. */
  payments: UnbilledPayment[];
  /** E1 payments of the year still lacking a verified figure or rate. */
  waiting: number;
  /** Rates needed before the waiting payments can be counted. */
  rates: Array<{ currency: string; date: string }>;
}

export function unbilledPayments(state: HeadroomState): Unbilled {
  const out: Unbilled = { payments: [], waiting: 0, rates: [] };
  const found = [...state.discrepancies.values()]
    .filter((d) => d.type === 'E1' && d.payment && yearOf(d.payment.date) === state.config.year)
    .sort((a, b) => (a.subjectKey ?? '').localeCompare(b.subjectKey ?? ''));
  for (const d of found) {
    const status = state.figures.get(d.id)?.status;
    if (status === 'superseded') continue;
    const ref = (d.subjectKey ?? '').slice('payment:'.length);
    const amount = state.verified(keys.payment(ref, 'amount'));
    const date = state.verified(keys.payment(ref, 'date'));
    if (status !== 'verified' || amount?.value.t !== 'money' || date?.value.t !== 'date') {
      out.waiting += 1;
      continue;
    }
    if (amount.value.currency === 'RSD') {
      out.payments.push({ discrepancy: d, amount, date, amountRSD: amount.value.amount });
      continue;
    }
    const rate = state.verified(keys.fx(amount.value.currency, date.value.iso));
    if (rate?.value.t !== 'rate') {
      out.waiting += 1;
      out.rates.push({ currency: amount.value.currency, date: date.value.iso });
      continue;
    }
    out.payments.push({
      discrepancy: d,
      amount,
      date,
      rate,
      amountRSD: convertToRsd(
        amount.value.amount,
        rate.value.rate,
        rate.value.parity,
        state.config.rsdRounding,
      ),
    });
  }
  return out;
}

export function totalWithUnbilled(withDraft: DecimalString, payments: UnbilledPayment[]): DecimalString {
  return add(withDraft, ...payments.map((p) => p.amountRSD));
}

export function unbilledInputs(withDraftId: string, payments: UnbilledPayment[]): string[] {
  return [
    withDraftId,
    ...payments.flatMap((p) => [p.discrepancy.id, p.amount.id, p.date.id, ...(p.rate ? [p.rate.id] : [])]),
  ];
}
