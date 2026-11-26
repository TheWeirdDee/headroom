// PDF text extraction (text layer only; scanned PDFs are reported, never OCR'd) and source location of
// excerpts. An excerpt must be an exact substring of the extracted text to become a SourceRef.
import { PDFParse } from 'pdf-parse';
import { sha256 } from '../util/hash.ts';
import type { SourceRef } from '../domain/types.ts';

export interface ReadableDocument {
  kind: 'readable';
  docId: string;
  fileName: string;
  sha256: string; // of the file bytes
  pages: string[]; // extracted text per page
}

export interface UnreadableDocument {
  kind: 'unreadable';
  docId: string;
  fileName: string;
  sha256: string;
  reason: string;
}

export type InputDocument = ReadableDocument | UnreadableDocument;

export async function readPdf(docId: string, fileName: string, bytes: Buffer): Promise<InputDocument> {
  const fileSha = sha256(bytes);
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { kind: 'unreadable', docId, fileName, sha256: fileSha, reason: 'not a PDF file' };
  }
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    const pages = result.pages.sort((a, b) => a.num - b.num).map((p) => p.text.replace(/\r\n?/g, '\n'));
    if (pages.every((p) => p.trim().length === 0)) {
      return { kind: 'unreadable', docId, fileName, sha256: fileSha, reason: 'no text layer, no OCR' };
    }
    return { kind: 'readable', docId, fileName, sha256: fileSha, pages };
  } catch (e) {
    return {
      kind: 'unreadable',
      docId,
      fileName,
      sha256: fileSha,
      reason: `PDF could not be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    await parser.destroy();
  }
}

/** Text given to a reading model: page markers and numbered lines, so excerpts can be located. */
export function numberedText(doc: ReadableDocument): string {
  const out: string[] = [];
  doc.pages.forEach((page, i) => {
    out.push(`--- page ${i + 1} ---`);
    page.split('\n').forEach((line, j) => out.push(`${j + 1}: ${line}`));
  });
  return out.join('\n');
}

export class ExcerptNotFoundError extends Error {
  constructor(docId: string, excerpt: string) {
    super(`Excerpt is not an exact substring of ${docId}: "${excerpt.slice(0, 80)}"`);
    this.name = 'ExcerptNotFoundError';
  }
}

/**
 * Build a document SourceRef for an excerpt: it must occur verbatim in one page (whitespace runs in the
 * excerpt may match any whitespace run, since line breaks are lost when a model quotes across lines).
 */
export function locateExcerpt(
  doc: ReadableDocument,
  excerpt: string,
): Extract<SourceRef, { type: 'document' }> {
  const wanted = excerpt.trim();
  if (wanted.length === 0 || wanted.length > 300) throw new ExcerptNotFoundError(doc.docId, excerpt);
  const pattern = new RegExp(wanted.split(/\s+/).map(escapeRe).join('\\s+'));
  for (const [i, page] of doc.pages.entries()) {
    const m = pattern.exec(page);
    if (!m) continue;
    const exact = m[0];
    const lineStart = page.slice(0, m.index).split('\n').length;
    const lineEnd = lineStart + exact.split('\n').length - 1;
    return {
      type: 'document',
      docId: doc.docId,
      page: i + 1,
      lineStart,
      lineEnd,
      excerpt: exact,
      excerptSha256: sha256(exact),
    };
  }
  throw new ExcerptNotFoundError(doc.docId, excerpt);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
