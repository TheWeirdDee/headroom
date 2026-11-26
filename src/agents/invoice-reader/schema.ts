import { z } from 'zod';

export const Field = z.object({
  value: z.string().min(1).max(200),
  excerpt: z.string().min(1).max(200),
});

export const InvoiceExtraction = z.object({
  isInvoice: z.boolean(),
  invoiceNumber: Field.nullable(),
  issueDate: Field.nullable(),
  supplyDate: Field.nullable(),
  clientName: Field.nullable(),
  clientTaxId: Field.nullable(),
  clientCountry: Field.nullable(),
  currency: Field.nullable(),
  amount: Field.nullable(),
  kind: Field.nullable(),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;
