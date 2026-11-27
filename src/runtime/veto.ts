// Defence in depth (interception veto): a submit-tool call in which a reported value has no
// excerpt is rejected before the tool runs. The tools validate excerpts against the source text too;
// this check sits in the Mozaik loop itself, between the model's decision and its execution.

const SUBMIT_TOOLS = new Set(['submit_invoice', 'submit_rows', 'submit_matches', 'submit_criteria']);

function missingEvidence(v: unknown, path: string): string | undefined {
  if (Array.isArray(v)) {
    for (const [i, x] of v.entries()) {
      const r = missingEvidence(x, `${path}[${i}]`);
      if (r) return r;
    }
    return undefined;
  }
  if (v === null || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  // A field reported with a value must carry the excerpt it was read from.
  if (
    'value' in o &&
    'excerpt' in o &&
    o['value'] !== null &&
    (typeof o['excerpt'] !== 'string' || o['excerpt'].trim() === '')
  ) {
    return `${path} has a value but no excerpt`;
  }
  // A row linked to an invoice must cite the text that names it.
  if (
    'invoiceNumber' in o &&
    o['invoiceNumber'] !== null &&
    'reasonExcerpt' in o &&
    (typeof o['reasonExcerpt'] !== 'string' || o['reasonExcerpt'].trim() === '')
  ) {
    return `${path} names an invoice without citing the row text`;
  }
  // A contract criterion must cite the field it was judged from.
  if (
    'n' in o &&
    'value' in o &&
    'field' in o &&
    (typeof o['field'] !== 'string' || o['field'].trim() === '')
  ) {
    return `${path} gives a criterion without citing a contract field`;
  }
  for (const [k, x] of Object.entries(o)) {
    const r = missingEvidence(x, path ? `${path}.${k}` : k);
    if (r) return r;
  }
  return undefined;
}

export function unsourcedVeto(toolName: string, args: string): string | undefined {
  if (!SUBMIT_TOOLS.has(toolName)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return undefined; // malformed JSON is rejected by the tool's own validation with a clear message
  }
  return missingEvidence(parsed, '');
}
