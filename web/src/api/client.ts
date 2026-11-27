import type { ApiErrorBody } from './types.ts';
import { apiUrl } from './base.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(
      res.status,
      'BAD_RESPONSE',
      `The server answered with something that is not JSON (HTTP ${res.status}).`,
    );
  }
  if (!res.ok) {
    const e = (body as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? `Request failed (HTTP ${res.status})`,
      e?.details,
    );
  }
  return body as T;
}

export async function getJson<T>(url: string): Promise<T> {
  return parse<T>(await fetch(apiUrl(url), { headers: { accept: 'application/json' } }));
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return parse<T>(
    await fetch(apiUrl(url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function postForm<T>(url: string, form: FormData): Promise<T> {
  return parse<T>(await fetch(apiUrl(url), { method: 'POST', body: form }));
}

export async function del(url: string): Promise<void> {
  const res = await fetch(apiUrl(url), { method: 'DELETE' });
  if (!res.ok && res.status !== 204) await parse(res);
}
