/**
 * OtaUpdater — React Context + Hook
 * ───────────────────────────────────
 * Wraps OtaClient and provides a React-friendly API.
 *
 * Usage:
 *   // In your App root:
 *   <OtaProvider config={{ serverUrl, channel, appVersion }}>
 *     <YourApp />
 *   </OtaProvider>
 *
 *   // Anywhere inside:
 *   const { status, progress, checkForUpdate, applyNow } = useOtaUpdate();
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { OtaClient } from './OtaClient';
import type {
  CheckUpdateResponse,
  DownloadProgress,
  OtaConfig,
  OtaRelease,
  OtaStatus,
  UpdateStrategy,
} from './types';

// ─── Context types ────────────────────────────────────────────────────────────

interface OtaContextValue {
  /** Current state of the update pipeline */
  status: OtaStatus;
  /** Download progress (0-100), only set during DOWNLOADING */
  progress: number;
  /** The release available for install, if any */
  availableRelease: OtaRelease | null;
  /** Error message if status === 'ERROR' */
  error: string | null;
  /** Manually trigger an update check */
  checkForUpdate: () => Promise<CheckUpdateResponse | null>;
  /** Immediately download + apply the available release */
  applyNow: () => Promise<void>;
  /** Rollback to the previous bundle */
  rollback: () => Promise<void>;
}

const OtaContext = createContext<OtaContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface OtaProviderProps {
  config: OtaConfig;
  children: React.ReactNode;
  /** Check for updates automatically on mount (default: true) */
  checkOnMount?: boolean;
}

export function OtaProvider({
  config,
  children,
  checkOnMount = true,
}: OtaProviderProps) {
  const clientRef = useRef<OtaClient>(new OtaClient(config));
  const [status, setStatus] = useState<OtaStatus>('IDLE');
  const [progress, setProgress] = useState(0);
  const [availableRelease, setAvailableRelease] = useState<OtaRelease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // If config changes (e.g., channel), recreate the client
  useEffect(() => {
    clientRef.current = new OtaClient(config);
  }, [config.serverUrl, config.channel, config.appVersion]);

  const checkForUpdate = useCallback(async (): Promise<CheckUpdateResponse | null> => {
    const client = clientRef.current;
    setStatus('CHECKING');
    setError(null);

    try {
      const result = await client.checkForUpdate();

      if (result.hasUpdate) {
        setAvailableRelease(result.release);
        setStatus('UPDATE_AVAILABLE');

        // Auto-download for BACKGROUND and IMMEDIATE strategies
        if (
          config.strategy === 'BACKGROUND' ||
          config.strategy === 'IMMEDIATE'
        ) {
          await _download(result.release);
        }
      } else {
        setStatus('UP_TO_DATE');
        setAvailableRelease(null);
      }

      return result;
    } catch (err: any) {
      setStatus('ERROR');
      setError(err?.message ?? 'Unknown error during update check');
      return null;
    }
  }, [config.strategy]);

  const _download = useCallback(async (release: OtaRelease) => {
    const client = clientRef.current;
    setStatus('DOWNLOADING');
    setProgress(0);

    try {
      await client.downloadAndApply(release, (p: DownloadProgress) => {
        setProgress(p.percent);
      });

      if (config.strategy === 'IMMEDIATE') {
        setStatus('INSTALLING');
      } else {
        setStatus('READY_TO_INSTALL');
      }
    } catch (err: any) {
      setStatus('ERROR');
      setError(err?.message ?? 'Download failed');
    }
  }, [config.strategy]);

  const applyNow = useCallback(async () => {
    if (!availableRelease) return;
    await _download(availableRelease);
    // Force immediate restart
    await clientRef.current.restart();
  }, [availableRelease, _download]);

  const rollback = useCallback(async () => {
    await clientRef.current.rollback();
    setStatus('ROLLED_BACK');
  }, []);

  // ── AppState listener for ON_RESUME strategy ──────────────────────────────
  useEffect(() => {
    if (config.strategy !== 'ON_RESUME') return;

    const sub = AppState.addEventListener('change', async (nextState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        if (status === 'READY_TO_INSTALL') {
          await clientRef.current.restart();
        }
      }
      appStateRef.current = nextState;
    });

    return () => sub.remove();
  }, [config.strategy, status]);

  // ── Auto-check on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (checkOnMount) {
      checkForUpdate();
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <OtaContext.Provider
      value={{
        status,
        progress,
        availableRelease,
        error,
        checkForUpdate,
        applyNow,
        rollback,
      }}
    >
      {children}
    </OtaContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOtaUpdate(): OtaContextValue {
  const ctx = useContext(OtaContext);
  if (!ctx) {
    throw new Error('[OtaSDK] useOtaUpdate must be used inside <OtaProvider>');
  }
  return ctx;
}
