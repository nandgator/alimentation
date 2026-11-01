import { useState } from 'react';
import { useLocation } from 'wouter';
import { postJson } from '../api.ts';
import { Field, Form, useAction } from '../components/ui.tsx';
import { useSession } from '../session.tsx';
import { CopySetup } from './CopySetup.tsx';

function NewOrganisation({ first }: { first: boolean }) {
  const [, go] = useLocation();
  const { refresh } = useSession();
  const [name, setName] = useState('');
  const act = useAction();
  return (
    <section className="card stack" aria-labelledby="org-h">
      <h2 id="org-h">{first ? 'Start an organisation' : 'Start another organisation'}</h2>
      <p className="muted">
        A head office over several kitchens. It sees how each is doing: how many people, how many
        meals, what was billed, paid and is owed. It never sees a name. A kitchen joins only when
        its own admin agrees, and can stop whenever it likes.
      </p>
      <Form
        error={act.error}
        onSubmit={() =>
          act.run(async () => {
            const made = await postJson<{ id: string }>('/api/organisations', { name });
            await refresh();
            go(`/org/${made.id}`);
          })
        }
      >
        <Field label="Name" id="org-name" hint="What the group of kitchens is called.">
          <input
            id="org-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <button className="btn" disabled={act.busy}>
          Start it
        </button>
      </Form>
    </section>
  );
}

/** What someone who runs several kitchens is given beyond what everyone has. */
export function ManyKitchens({
  kitchens,
  organisations,
}: {
  kitchens: { slug: string; name: string }[];
  organisations: number;
}) {
  return (
    <>
      {kitchens.length >= 2 ? <CopySetup kitchens={kitchens} /> : null}
      <NewOrganisation first={organisations === 0} />
    </>
  );
}
