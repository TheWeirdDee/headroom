// A deliberately wrong reading, to show a check between agents at work. It replays the recorded sample and
// alters one thing: the amount in the InvoiceReader's first reading of one invoice. Everything after that
// is the pipeline's own doing: the Verifier rejects the figure against the document, the InvoiceReader is
// asked to read again, and that second request is answered with what the model really answered. Every
// screen and report that shows such a run says the fault was injected.
import type { HrInferenceRequest, ModelBackend } from '../runtime/types.ts';

export interface InjectedFault {
  id: 'misread-amount';
  profileId: 'p07';
  invoice: string;
  /** The amount the model read, and the amount put in its place. */
  right: string;
  wrong: string;
  currency: string;
  note: string;
}

export const MISREAD_AMOUNT: InjectedFault = {
  id: 'misread-amount',
  profileId: 'p07',
  invoice: '2026-006',
  right: '3500.00',
  wrong: '5300.00',
  currency: 'EUR',
  note: 'Injected fault: the first reading of invoice 2026-006 is altered from 3500.00 to 5300.00 EUR before it reaches the InvoiceReader. The model did not make this mistake.',
};

/** `backend` with the fault injected into the reading of the document whose file hash is `docSha256`. */
export function injectMisread(backend: ModelBackend, docSha256: string, fault: InjectedFault): ModelBackend {
  const prefix = `doc:${docSha256}:read`;
  const recorded = `${prefix}1`;
  const originals = new Map<string, string>(); // altered tool arguments -> the recorded ones

  const misread = (args: string): string => {
    const parsed = JSON.parse(args) as { amount?: { value?: string } };
    if (parsed.amount?.value !== fault.right) return args;
    parsed.amount.value = fault.wrong;
    const altered = JSON.stringify(parsed);
    originals.set(altered, args);
    return altered;
  };

  return {
    ...(backend.recorded === undefined ? {} : { recorded: backend.recorded }),
    async infer(request: HrInferenceRequest) {
      if (request.agentId !== 'invoice-reader' || !request.loopInputKey.startsWith(prefix))
        return backend.infer(request);
      const first = request.loopInputKey === recorded;
      // The recording knows the document's first reading; a re-read is answered with that same reading.
      const response = await backend.infer({
        ...request,
        loopInputKey: recorded,
        transcript: request.transcript.map((t) =>
          t.type === 'function_call' ? { ...t, args: originals.get(t.args) ?? t.args } : t,
        ),
      });
      if (!first) return response;
      return {
        ...response,
        items: response.items.map((i) => (i.type === 'function_call' ? { ...i, args: misread(i.args) } : i)),
      };
    },
  };
}
