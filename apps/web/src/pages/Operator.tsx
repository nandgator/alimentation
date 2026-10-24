import { Link } from 'wouter';
import { api, getJson, postJson } from '../api.ts';
import { AppBar, Page, RequireSignIn } from '../components/Chrome.tsx';
import { Chip, Problem, Spinner, toast, useAction, useLoad } from '../components/ui.tsx';

interface Row {
  id: string;
  slug: string;
  state: string;
  placement: string;
  createdAt: string;
  requestsToday: number;
  overSince: string | null;
}
interface Listing {
  capacity: { capacity: number; used: number; open: boolean };
  workspaces: Row[];
}

export function Operator() {
  const list = useLoad(() => getJson<Listing>('/api/platform/workspaces'), []);
  const act = useAction();
  const tone = (s: string) => (s === 'ACTIVE' ? 'good' : s === 'WIPING' ? 'bad' : 'warn');
  return (
    <>
      <AppBar />
      <RequireSignIn>
        <Page
          title="Operator"
          actions={
            <button
              className="btn ghost small"
              disabled={act.busy}
              onClick={() =>
                void act.run(async () => {
                  const r = await postJson<Record<string, unknown>>('/api/platform/housekeeping');
                  toast(`Housekeeping done: ${JSON.stringify(r).slice(0, 120)}`);
                  list.reload();
                })
              }
            >
              Run housekeeping
            </button>
          }
        >
          <Problem error={act.error ?? list.error} />
          {list.loading && !list.data ? <Spinner /> : null}
          {list.data ? (
            <>
              <p className="muted">
                {list.data.capacity.used} of {list.data.capacity.capacity} free places used ·{' '}
                {list.data.capacity.open ? 'open' : 'full'}
              </p>
              <div
                className="tablewrap"
                tabIndex={0}
                role="region"
                aria-label="Table; scrolls sideways when it is wider than the screen"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>State</th>
                      <th>Where</th>
                      <th className="r">Requests today</th>
                      <th>Over since</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.workspaces.map((w) => (
                      <tr key={w.id}>
                        <td>
                          <Link href={`/w/${w.slug}`}>{w.slug}</Link>
                        </td>
                        <td>
                          <Chip tone={tone(w.state)}>{w.state}</Chip>
                        </td>
                        <td>{w.placement}</td>
                        <td className="r">{w.requestsToday}</td>
                        <td>{w.overSince ?? '-'}</td>
                        <td>
                          {w.state === 'MIGRATING' ? (
                            <button
                              className="btn ghost small"
                              onClick={() =>
                                void act.run(async () => {
                                  await api.post(`/api/platform/workspaces/${w.slug}/release`);
                                  toast('Released: writing is open again.');
                                  list.reload();
                                })
                              }
                            >
                              Release
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </Page>
      </RequireSignIn>
    </>
  );
}
