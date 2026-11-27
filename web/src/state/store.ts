// One zustand store per open run, fed by the snapshot and then the SSE stream (PRD 15.4). On a gap the
// snapshot is fetched again and the stream resumes; the browser's EventSource resends Last-Event-ID.
import { useEffect } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { emptyView, reduce, type Action, type RunView } from './reducer.ts';
import { getJson, ApiError } from '../api/client.ts';
import { apiUrl } from '../api/base.ts';
import type { HrEvent, Snapshot } from '../api/types.ts';

interface RunStore {
  view: RunView;
  connected: boolean;
  error?: string;
  dispatch: (a: Action) => void;
}

const stores = new Map<string, UseBoundStore<StoreApi<RunStore>>>();

export function runStore(runId: string): UseBoundStore<StoreApi<RunStore>> {
  let s = stores.get(runId);
  if (!s) {
    s = create<RunStore>((set) => ({
      view: emptyView(runId),
      connected: false,
      dispatch: (a) => set((st) => ({ view: reduce(st.view, a) })),
    }));
    stores.set(runId, s);
  }
  return s;
}

/** Load the snapshot and keep the store live from the event stream while the component is mounted. */
export function useRunConnection(runId: string): void {
  useEffect(() => {
    const store = runStore(runId);
    let closed = false;
    let source: EventSource | undefined;
    const load = async (): Promise<void> => {
      try {
        const snap = await getJson<Snapshot>(`/api/runs/${runId}`);
        if (!closed) store.getState().dispatch({ type: 'snapshot', snapshot: snap });
      } catch (e) {
        store.setState({ error: e instanceof ApiError ? e.message : 'Could not load the run.' });
      }
    };
    void load().then(() => {
      if (closed) return;
      source = new EventSource(apiUrl(`/api/runs/${runId}/stream`));
      source.addEventListener('open', () => store.setState({ connected: true }));
      source.addEventListener('error', () => store.setState({ connected: false }));
      source.addEventListener('gap', () => void load());
      source.addEventListener('hr', (m) => {
        const msg = m as MessageEvent<string>;
        const id = Number.parseInt(msg.lastEventId, 10);
        store.getState().dispatch({ type: 'event', id, event: JSON.parse(msg.data) as HrEvent });
      });
    });
    return () => {
      closed = true;
      source?.close();
    };
  }, [runId]);
}

export function useRun<T>(runId: string, pick: (s: RunStore) => T): T {
  return runStore(runId)(pick);
}
