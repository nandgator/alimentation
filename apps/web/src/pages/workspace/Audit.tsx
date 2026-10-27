import { useState } from 'react';
import { getJson } from '../../api.ts';
import { Chip, PageHead, Problem, Spinner, useLoad } from '../../components/ui.tsx';
import { useWorkspace } from './context.tsx';

interface Entry {
  id: number;
  table: string;
  rowId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actor: string | null;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const PAGE = 50;

export function Audit() {
  const ws = useWorkspace();
  const [before, setBefore] = useState<number | null>(null);
  const [seen, setSeen] = useState<Entry[]>([]);
  const res = useLoad(async () => {
    const rows = await getJson<Entry[]>(
      `${ws.api}/audit?limit=${PAGE}${before ? `&before=${before}` : ''}`,
    );
    setSeen((prev) => (before ? [...prev, ...rows] : rows));
    return rows;
  }, [ws.api, before]);
  const more = (res.data?.length ?? 0) === PAGE;
  return (
    <div className="stack">
      <PageHead
        title="Audit trail"
        lead="Every change, who made it and when. Names and notes appear as “(encrypted)”: the trail itself holds no readable details."
      />
      <Problem error={res.error} />
      {res.loading && seen.length === 0 ? <Spinner /> : null}
      <div
        className="tablewrap"
        tabIndex={0}
        role="region"
        aria-label="Table; scrolls sideways when it is wider than the screen"
      >
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Table</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {seen.map((e) => (
              <tr key={e.id}>
                <td>
                  {new Date(e.at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </td>
                <td>{e.actor ? ws.nameOf(e.actor) : 'System'}</td>
                <td>
                  <Chip
                    tone={e.action === 'DELETE' ? 'bad' : e.action === 'INSERT' ? 'good' : 'warn'}
                  >
                    {e.action.toLowerCase()}
                  </Chip>
                </td>
                <td>{e.table.replace(/_/g, ' ')}</td>
                <td>
                  <details>
                    <summary className="muted small">show</summary>
                    <pre className="small json">
                      {JSON.stringify(
                        e.action === 'UPDATE'
                          ? { before: e.before, after: e.after }
                          : (e.after ?? e.before),
                        null,
                        1,
                      )}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more ? (
        <div>
          <button
            className="btn ghost"
            disabled={res.loading}
            onClick={() => setBefore(seen.at(-1)?.id ?? null)}
          >
            Older entries
          </button>
        </div>
      ) : null}
    </div>
  );
}
