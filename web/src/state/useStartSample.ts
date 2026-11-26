import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client.ts';
import { sampleMode, startSample } from '../api/runs.ts';
import { useApp } from './app.ts';

/** Starts a sample run and opens it. Live needs a model key; without one the caller offers the recorded run. */
export function useStartSample(): {
  start: (profileId: string, mode?: 'live' | 'replay') => void;
  busy: boolean;
  error?: string;
  needsKey: boolean;
} {
  const navigate = useNavigate();
  const health = useApp((s) => s.health);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const needsKey = health !== undefined && health.mode === 'live' && !health.hasModelKey;
  const start = (profileId: string, mode?: 'live' | 'replay'): void => {
    setBusy(true);
    setError(undefined);
    startSample(profileId, mode ?? sampleMode(health))
      .then((runId) => navigate(`/runs/${runId}`))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The run could not be started.'))
      .finally(() => setBusy(false));
  };
  return { start, busy, ...(error !== undefined ? { error } : {}), needsKey };
}
