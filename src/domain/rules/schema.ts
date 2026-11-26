import { z } from 'zod';

export const RuleSourceSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  accessed: z.iso.date(),
  locator: z.string().optional(),
  quote: z.string().optional(),
});

export const CriterionSchema = z.object({
  n: z.number().int().min(1).max(9),
  text_sr: z.string().min(1),
  text_en: z.string().min(1),
  evalMode: z.enum(['computed', 'contract_field', 'user_answer']),
  contractField: z.string().optional(),
  question_en: z.string().optional(),
});

export const RuleSchema = z.object({
  id: z.string().regex(/^R-[A-Z0-9-]+$/),
  // verified: confirmed from a cited source. assumption: shown with an assumption chip, never as fact.
  // product: a Headroom display convention, not a legal rule.
  status: z.enum(['verified', 'assumption', 'product']),
  title: z.string().min(1),
  statement_sr: z.string().min(1),
  statement_en: z.string().min(1),
  sources: z.array(RuleSourceSchema).min(1),
  params: z.record(z.string(), z.unknown()),
  note: z.string().optional(),
});

export const RuleFileSchema = z.object({ rules: z.array(RuleSchema).min(1) });

export type RuleSource = z.infer<typeof RuleSourceSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Rule = z.infer<typeof RuleSchema>;
