import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getJson, type Me } from './api.ts';
import { forgetThisDevice } from './pwa.ts';

interface Session {
  /** `undefined` while the first answer is awaited, `null` when the server cannot be reached. */
  me: Me | null | undefined;
  refresh(): Promise<Me | null>;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session>({
  me: undefined,
  refresh: async () => null,
  signOut: async () => undefined,
});
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await getJson<Me>('/api/me');
      setMe((prev) => {
        // A different person on the same device must not meet the last one's saved statements.
        if (prev?.account && next.account && prev.account.id !== next.account.id)
          void forgetThisDevice();
        return next;
      });
      return next;
    } catch {
      setMe((prev) => prev ?? null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      await forgetThisDevice();
      setMe(await getJson<Me>('/api/me').catch(() => null));
    }
  }, []);

  const value = useMemo(() => ({ me, refresh, signOut }), [me, refresh, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
