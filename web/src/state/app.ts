// App-wide data: server health (mode, key present, models) and the rules table.
import { useEffect } from 'react';
import { create } from 'zustand';
import { getJson } from '../api/client.ts';
import type { Health, Rule } from '../api/types.ts';
import { REMOTE_API } from '../api/base.ts';

interface AppStore {
  health?: Health;
  rules?: Rule[];
  error?: string;
}

export const useApp = create<AppStore>(() => ({}));

let started = false;
export function useAppBoot(): void {
  useEffect(() => {
    if (started) return;
    started = true;
    getJson<Health>('/api/health')
      .then((health) => useApp.setState({ health }))
      .catch(() =>
        useApp.setState({
          error: REMOTE_API
            ? 'The sample server is not answering. It sleeps when idle and takes up to a minute to wake: reload in a moment.'
            : 'The Headroom server is not reachable. Start it with npm start.',
        }),
      );
    getJson<Rule[]>('/api/rules')
      .then((rules) => useApp.setState({ rules }))
      .catch(() => undefined);
  }, []);
}
