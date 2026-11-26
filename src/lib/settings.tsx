import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { readSettings, writeSettings, type Settings } from './db/settings';

type SettingsContext = {
  settings: Settings | null;
  error: string | null;
  /** Saves changes and updates every screen that shows them. */
  update: (changes: Partial<Settings>) => Promise<void>;
  /** Reads the settings again, e.g. after a restore. */
  reload: () => Promise<void>;
};

const Ctx = createContext<SettingsContext | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSettings(await readSettings(db));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [db]);

  useEffect(() => {
    let active = true;
    readSettings(db)
      .then((s) => active && setSettings(s))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [db]);

  const update = useCallback(
    async (changes: Partial<Settings>) => {
      await writeSettings(db, changes);
      setSettings(await readSettings(db));
    },
    [db],
  );

  return <Ctx.Provider value={{ settings, error, update, reload }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsContext {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}
