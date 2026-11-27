// Intake: drop files, confirm what each one is, map unknown CSVs, describe the invoice.
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { FileText, Pencil, PlayCircle, Plus, Trash2, Upload } from 'lucide-react';
import { getJson, postForm, postJson, del, ApiError } from '../api/client.ts';
import { startUpload } from '../api/runs.ts';
import type { Draft, ProfileInfo, UploadInfo, UploadedFile } from '../api/types.ts';
import { useApp } from '../state/app.ts';
import { useStartSample } from '../state/useStartSample.ts';
import { MappingDialog } from '../components/MappingDialog.tsx';
import { DraftFields, cleanDraft } from '../components/DraftForm.tsx';
import { StatusChip } from '../components/StatusChip.tsx';
import { HostedIntake } from '../components/HostedIntake.tsx';

const KIND_LABEL: Record<string, string> = {
  statement: 'Bank statement',
  kpo: 'KPO book',
  invoice_pdf: 'Invoice PDF',
  clients: 'Client details',
  unknown: 'Not recognised',
};

interface Client {
  id: string;
  name: string;
  country: string;
  isBusiness: boolean;
  pib?: string;
  vatId?: string;
  /** Contract summary fields from the client file; the IndependenceChecker judges criteria from them. */
  contract?: Record<string, string>;
}

/** The text-valued fields of a contract object, or nothing. */
function contractOf(v: unknown): Record<string, string> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const fields = Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string');
  return fields.length ? Object.fromEntries(fields) : undefined;
}

function slug(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'client';
  let id = base;
  for (let i = 2; taken.has(id); i += 1) id = `${base}-${i}`;
  return id;
}

/** Reads a clients JSON the user dropped, to pre-fill the client list. Only well-formed entries are kept. */
async function readClients(files: File[]): Promise<Client[]> {
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.json')) continue;
    try {
      const data: unknown = JSON.parse(await f.text());
      if (!Array.isArray(data)) continue;
      const out: Client[] = [];
      for (const c of data as Array<Record<string, unknown>>) {
        if (typeof c['name'] !== 'string' || typeof c['country'] !== 'string') continue;
        const contract = contractOf(c['contract']);
        out.push({
          id: typeof c['id'] === 'string' ? c['id'] : '',
          name: c['name'],
          country: c['country'].toUpperCase(),
          isBusiness: c['isBusiness'] !== false,
          ...(typeof c['pib'] === 'string' ? { pib: c['pib'] } : {}),
          ...(typeof c['vatId'] === 'string' ? { vatId: c['vatId'] } : {}),
          ...(contract ? { contract } : {}),
        });
      }
      if (out.length) return out;
    } catch {
      // not a clients file; the server lists it as unrecognised
    }
  }
  return [];
}

export function Intake() {
  const navigate = useNavigate();
  const health = useApp((s) => s.health);
  const sample = useStartSample();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [upload, setUpload] = useState<UploadInfo>();
  const [mapping, setMapping] = useState<UploadedFile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const picked = useRef<File[]>([]);
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const [who, setWho] = useState({
    name: '',
    pib: '',
    activityCode: '',
    address: '',
    municipality: '',
    exempt: false,
    year,
    asOf: today,
  });
  const [clients, setClients] = useState<Client[]>([{ id: '', name: '', country: 'RS', isBusiness: true }]);
  const [draft, setDraft] = useState<Draft>({
    clientId: '',
    currency: 'RSD',
    amount: '',
    issueDate: today,
    description: '',
    kind: 'service',
  });

  useEffect(() => {
    getJson<ProfileInfo[]>('/api/profiles')
      .then(setProfiles)
      .catch(() => undefined);
  }, []);

  // Client ids are derived from names (unique, url-safe); the draft's client select is keyed by row index.
  const idByIndex = (() => {
    const taken = new Set<string>();
    return clients.map((c) => {
      if (!c.name.trim()) return undefined;
      const id = c.id && /^[a-z0-9-]+$/.test(c.id) && !taken.has(c.id) ? c.id : slug(c.name, taken);
      taken.add(id);
      return id;
    });
  })();
  const withIds = clients.flatMap((c, i) => {
    const id = idByIndex[i];
    return id ? [{ ...c, id }] : [];
  });

  const refresh = async (id: string): Promise<UploadInfo> => {
    const u = await getJson<UploadInfo>(`/api/uploads/${id}`);
    setUpload(u);
    return u;
  };

  const send = async (list: File[]): Promise<void> => {
    if (!list.length) return;
    setBusy(true);
    setError(undefined);
    try {
      // Files added later join the earlier ones; a file with the same name replaces the earlier one.
      const added = new Set(list.map((f) => f.name));
      const kept = picked.current.filter((f) => !added.has(f.name));
      const all = [...kept, ...list];
      const fd = new FormData();
      for (const f of all) fd.append('files', f, f.name);
      const created = await postForm<{ uploadId: string }>('/api/uploads', fd);
      // Column mappings already chosen for the earlier files carry over.
      for (const f of upload?.files ?? []) {
        if (f.mapping && kept.some((k) => k.name === f.name))
          await postJson(`/api/uploads/${created.uploadId}/mapping`, { file: f.name, mapping: f.mapping });
      }
      if (upload) await del(`/api/uploads/${upload.uploadId}`).catch(() => undefined);
      picked.current = all;
      const u = await refresh(created.uploadId);
      const pre = await readClients(list);
      if (pre.length) setClients(pre);
      const firstUnmapped = u.files.find((f) => u.mappingNeeded.includes(f.name) && f.detection);
      if (firstUnmapped) setMapping(firstUnmapped);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDrag(false);
    void send([...e.dataTransfer.files]);
  };

  const remove = async (): Promise<void> => {
    if (!upload) return;
    await del(`/api/uploads/${upload.uploadId}`).catch(() => undefined);
    picked.current = [];
    setUpload(undefined);
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!upload) return setError('Add your files first.');
    if (upload.mappingNeeded.length)
      return setError(`Say which column is which in: ${upload.mappingNeeded.join(', ')}.`);
    if (!/^\d{9}$/.test(who.pib)) return setError('PIB has 9 digits.');
    if (!who.name.trim()) return setError('Enter your name or business name.');
    if (!withIds.length) return setError('Add at least one client.');
    const c = cleanDraft({
      ...draft,
      clientId: idByIndex[Number.parseInt(draft.clientId || '-1', 10)] ?? '',
    });
    if (!c.ok) return setError(c.error);
    setBusy(true);
    setError(undefined);
    try {
      await postJson(`/api/uploads/${upload.uploadId}/details`, {
        name: who.name.trim(),
        pib: who.pib,
        activityCode: who.activityCode,
        address: who.address,
        municipality: who.municipality,
        activityExemptFromIndependenceTest: who.exempt,
        year: who.year,
        asOf: who.asOf,
        clients: withIds.map((x) => ({
          id: x.id,
          name: x.name.trim(),
          country: x.country,
          isBusiness: x.isBusiness,
          ...(x.pib ? { pib: x.pib } : {}),
          ...(x.vatId ? { vatId: x.vatId } : {}),
          ...(x.contract ? { contract: x.contract } : {}),
        })),
        draft: c.draft,
      });
      const runId = await startUpload(upload.uploadId);
      navigate(`/runs/${runId}`);
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'The check could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const noKey = health !== undefined && (health.mode === 'offline' || !health.hasModelKey);
  const field = 'w-full rounded border border-line bg-ink px-2 py-1.5';
  const clientOptions = clients
    .map((c, i) => ({ id: String(i), name: c.name.trim() || `Client ${i + 1}` }))
    .filter((_, i) => clients[i]?.name.trim());

  if (health?.publicDemo)
    return <HostedIntake busy={sample.busy} error={sample.error} start={sample.start} />;

  return (
    <div className="mx-auto max-w-[1100px] space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Check my invoice</h1>
        <p className="mt-1 text-muted">
          Your files stay on this machine. In live mode, document text is sent to the model provider to be
          read; the arithmetic is done here.
        </p>
        {!noKey && health !== undefined && health.maxRpm > 0 && (
          <p className="mt-1 text-sm text-muted">
            A check takes several minutes: requests are limited to {health.maxRpm} a minute for the free tier,
            and about a dozen invoices need some 85 of them. The card says incomplete until the run is done.
          </p>
        )}
      </div>

      {noKey && (
        <div role="note" className="rounded border border-amber/50 bg-amber/10 p-3 text-sm">
          {health?.mode === 'offline'
            ? 'This server runs offline: it can only replay the bundled samples. Start it with npm start and a model key to check your own files.'
            : `A model key is required to read your files. Add ${health?.keyEnv ?? 'GEMINI_API_KEY'} to .env and restart.`}
        </div>
      )}

      <section aria-labelledby="files-title" className="space-y-3">
        <h2 id="files-title" className="text-lg font-semibold">
          1. Your files
        </h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center rounded border-2 border-dashed p-8 text-center ${drag ? 'border-accent bg-accent/5' : 'border-line'}`}
        >
          <Upload className="text-muted" aria-hidden />
          <p className="mt-2">Drop your bank statement CSV, invoice PDFs, KPO book and client list here</p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="mt-3 rounded border border-line px-3 py-1.5 text-sm hover:border-muted disabled:opacity-60"
          >
            Choose files
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.pdf,.json"
            className="sr-only"
            aria-label="Choose files"
            onChange={(e) => {
              void send([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
        {upload && (
          <div className="rounded border border-line bg-panel">
            <ul className="divide-y divide-line">
              {upload.files.map((f) => (
                <li key={f.name} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <FileText size={16} className="text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 text-xs">
                    {KIND_LABEL[f.kind] ?? f.kind}
                  </span>
                  {upload.mappingNeeded.includes(f.name) ? (
                    <StatusChip status="needs_user" label="Needs mapping" />
                  ) : f.detection ? (
                    <StatusChip status="verified" label="Columns mapped" />
                  ) : null}
                  {f.detection && (
                    <button
                      type="button"
                      onClick={() => setMapping(f)}
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <Pencil size={12} aria-hidden /> Change
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-3 py-2">
              <button
                type="button"
                onClick={() => void remove()}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-danger"
              >
                <Trash2 size={12} aria-hidden /> Delete my files
              </button>
            </div>
          </div>
        )}
      </section>

      <form onSubmit={(e) => void submit(e)} className="space-y-8">
        <section aria-labelledby="you-title" className="space-y-3">
          <h2 id="you-title" className="text-lg font-semibold">
            2. About you
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-xs text-muted">Name or business name</span>
              <input
                className={field}
                value={who.name}
                onChange={(e) => setWho({ ...who, name: e.target.value })}
                required
                maxLength={200}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">PIB (9 digits)</span>
              <input
                className={`${field} num`}
                value={who.pib}
                onChange={(e) => setWho({ ...who, pib: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                inputMode="numeric"
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Activity code</span>
              <input
                className={field}
                value={who.activityCode}
                onChange={(e) => setWho({ ...who, activityCode: e.target.value })}
                maxLength={10}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Year</span>
              <input
                className={`${field} num`}
                type="number"
                min={2000}
                max={2100}
                value={who.year}
                onChange={(e) => setWho({ ...who, year: Number.parseInt(e.target.value, 10) || year })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Check as of</span>
              <input
                className={field}
                type="date"
                value={who.asOf}
                onChange={(e) => setWho({ ...who, asOf: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={who.exempt}
                onChange={(e) => setWho({ ...who, exempt: e.target.checked })}
              />
              My activity is exempt from the independence test
            </label>
          </div>
        </section>

        <section aria-labelledby="clients-title" className="space-y-3">
          <h2 id="clients-title" className="text-lg font-semibold">
            3. Your clients
          </h2>
          <ul className="space-y-2">
            {clients.map((c, i) => (
              <li key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_6rem_10rem_auto]">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted">Client name</span>
                  <input
                    className={field}
                    value={c.name}
                    onChange={(e) =>
                      setClients(clients.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted">Country</span>
                  <input
                    className={field}
                    value={c.country}
                    maxLength={2}
                    onChange={(e) =>
                      setClients(
                        clients.map((x, j) =>
                          j === i
                            ? { ...x, country: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted">Client is</span>
                  <select
                    className={field}
                    value={c.isBusiness ? 'b' : 'p'}
                    onChange={(e) =>
                      setClients(
                        clients.map((x, j) => (j === i ? { ...x, isBusiness: e.target.value === 'b' } : x)),
                      )
                    }
                  >
                    <option value="b">a business</option>
                    <option value="p">a private person</option>
                  </select>
                </label>
                <button
                  type="button"
                  aria-label={`Remove client ${i + 1}`}
                  onClick={() => setClients(clients.filter((_, j) => j !== i))}
                  className="mb-1.5 text-muted hover:text-danger"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
                {c.contract && (
                  <p className="text-xs text-muted sm:col-span-4">
                    Contract details from your client file: {Object.keys(c.contract).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setClients([...clients, { id: '', name: '', country: 'RS', isBusiness: true }])}
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
          >
            <Plus size={14} aria-hidden /> Add a client
          </button>
        </section>

        <section aria-labelledby="draft-title" className="space-y-3">
          <h2 id="draft-title" className="text-lg font-semibold">
            4. The invoice you are about to send
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <DraftFields draft={draft} clients={clientOptions} onChange={setDraft} />
          </div>
        </section>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || noKey}
          className="rounded bg-accent px-5 py-3 font-medium text-ink hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? 'Working...' : 'Check this invoice'}
        </button>
      </form>

      {profiles.length > 0 && (
        <section aria-labelledby="samples-title" className="space-y-3 border-t border-line pt-8">
          <h2 id="samples-title" className="text-lg font-semibold">
            Or try a synthetic sample
          </h2>
          {sample.error && (
            <p role="alert" className="text-sm text-danger">
              {sample.error}
            </p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((p) => {
              const canLive = health?.mode === 'live' && health.hasModelKey;
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded border border-line bg-panel px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{p.label}</span>
                  <span className="flex shrink-0 gap-2">
                    {canLive && (
                      <button
                        type="button"
                        disabled={sample.busy}
                        onClick={() => sample.start(p.id, 'live')}
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <PlayCircle size={14} aria-hidden /> Live
                      </button>
                    )}
                    {p.hasRecording && (
                      <button
                        type="button"
                        disabled={sample.busy}
                        onClick={() => sample.start(p.id, 'replay')}
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <PlayCircle size={14} aria-hidden /> Recorded
                      </button>
                    )}
                    {!canLive && !p.hasRecording && (
                      <span className="text-xs text-muted">needs a model key</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {mapping && upload && (
        <MappingDialog
          uploadId={upload.uploadId}
          file={mapping}
          onClose={() => setMapping(undefined)}
          onSaved={() => {
            setMapping(undefined);
            void refresh(upload.uploadId).then((u) => {
              const next = u.files.find((f) => u.mappingNeeded.includes(f.name) && f.detection);
              if (next) setMapping(next);
            });
          }}
        />
      )}
    </div>
  );
}
