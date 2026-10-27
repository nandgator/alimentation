import { useState } from 'react';
import type { HistoryEventDto } from '@alimentation/core';
import { getJson } from '../../api.ts';
import { PageHead, Problem, Spinner, useLoad } from '../../components/ui.tsx';
import { useWorkspace } from './context.tsx';

interface Page {
  events: HistoryEventDto[];
  next: number | null;
}

const day = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
const time = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

/**
 * What has been done to the reader's own records, in words, newest first. It is the other half of
 * "everything is attributed": the person a change affects can see who made it, and when.
 */
export function History() {
  const ws = useWorkspace();
  const tz = ws.boot.workspace.timeZone;
  const first = useLoad(() => getJson<Page>(`${ws.api}/history?limit=50`), [ws.api]);
  const [more, setMore] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Error | null>(null);

  const events = [...(first.data?.events ?? []), ...(more?.events ?? [])];
  const cursor = more ? more.next : (first.data?.next ?? null);

  const loadOlder = async () => {
    if (cursor === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const p = await getJson<Page>(`${ws.api}/history?limit=50&before=${cursor}`);
      setMore((m) => ({ events: [...(m?.events ?? []), ...p.events], next: p.next }));
    } catch (e) {
      setProblem(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const byDay = new Map<string, HistoryEventDto[]>();
  for (const e of events) {
    const k = day(e.at, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <PageHead
        title="History"
        lead={
          ws.role === 'consumer'
            ? 'Everything that has been done to your entries, claims and bills, and by whom. Nothing here can be changed or removed.'
            : 'Everything that has been done to the entries, claims and bills you can see, and by whom. Nothing here can be changed or removed.'
        }
      />
      <Problem error={first.error ?? problem} />
      {first.loading && !first.data ? <Spinner /> : null}
      {first.data && events.length === 0 ? (
        <p className="muted">Nothing has happened yet.</p>
      ) : null}
      {[...byDay].map(([label, list]) => (
        <section
          key={label}
          className="stack"
          aria-label={label}
          style={{ ['--gap' as string]: '8px' }}
        >
          <h2>{label}</h2>
          <ol className="history">
            {list.map((e) => (
              <li key={e.id}>
                <time dateTime={e.at}>{time(e.at, tz)}</time>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {cursor !== null ? (
        <div>
          <button className="btn ghost" disabled={busy} onClick={() => void loadOlder()}>
            Older
          </button>
        </div>
      ) : null}
    </div>
  );
}
