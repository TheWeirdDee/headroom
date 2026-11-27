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
  /** A hosted server is being woken up (first requests after it slept). */
  waking?: boolean;
}

export const useApp = create<AppStore>(() => ({}));

let started = false;
export function useAppBoot(): void {
  useEffect(() => {
    if (started) return;
    started = true;
    let tries = 0;
    // A hosted server on a free plan sleeps when idle and wakes on the first request (about a minute), so
    // a hosted frontend keeps asking; a local one says how to start the server.
    const boot = (): void => {
      getJson<Health>('/api/health')
        .then((health) => {
          useApp.setState({ health, error: undefined, waking: false });
          getJson<Rule[]>('/api/rules')
            .then((rules) => useApp.setState({ rules }))
            .catch(() => undefined);
        })
        .catch(() => {
          if (REMOTE_API && ++tries <= 18) {
            useApp.setState({ waking: true });
            setTimeout(boot, 10_000);
            return;
          }
          useApp.setState({
            waking: false,
            error: REMOTE_API
              ? 'The sample server is not answering. Reload the page in a minute.'
              : 'The Headroom server is not reachable. Start it with npm start.',
          });
        });
    };
    boot();
  }, []);
}
