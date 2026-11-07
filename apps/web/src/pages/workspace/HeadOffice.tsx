import { useState } from "react";
import { api, postJson } from "../../api.ts";
import { Field, Form, toast, useAction } from "../../components/ui.tsx";
import { useWorkspace } from "./context.tsx";

/**
 * Whether this kitchen shares its totals with a head office. Kept small and at the bottom: most kitchens
 * never have one, and for those this is a single closed line.
 */
export function HeadOffice() {
  const ws = useWorkspace();
  const mine = ws.boot.organisation;
  const act = useAction();
  const [link, setLink] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const url = `${ws.api}/organisation`;

  if (mine)
    return (
      <section class="card stack" aria-labelledby="ho-h">
        <h2 id="ho-h">Head office</h2>
        <p>
          This kitchen shares its totals with <strong>{mine.name}</strong>: how many people it
          feeds, how many meals, and what is billed, paid and owed this month. No names, contacts or
          notes. Everyone in the kitchen can see this.
        </p>
        <div>
          <button
            class="btn ghost"
            disabled={act.busy || !ws.writable}
            onClick={() =>
              void act.run(async () => {
                await api.del(url);
                toast("This kitchen no longer shares its totals.");
                ws.reload();
              })
            }
          >
            Stop sharing
          </button>
        </div>
      </section>
    );

  return (
    <details class="card">
      <summary>Share this kitchen's totals with a head office</summary>
      <div class="stack">
        <p class="muted">
          For a group of kitchens that wants to see how each is doing. It sees counts and money for
          the month, never a name. You will be shown who it is before anything is shared, and you
          can stop whenever you like.
        </p>
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const r = await postJson<{ organisation: { name: string } }>(url, {
                token: link.trim(),
              });
              setAsked(r.organisation.name);
            })
          }
        >
          <Field label="The link their head office sent you" id="ho-link">
            <input
              id="ho-link"
              required
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setAsked(null);
              }}
            />
          </Field>
          {asked ? null : <button class="btn ghost">See who it is for</button>}
        </Form>
        {asked ? (
          <div class="stack">
            <p>
              This link is for <strong>{asked}</strong>.
            </p>
            <div>
              <button
                class="btn"
                disabled={act.busy}
                onClick={() =>
                  void act.run(async () => {
                    await postJson(url, { token: link.trim(), confirm: true });
                    setLink("");
                    setAsked(null);
                    toast(`This kitchen now shares its totals with ${asked}.`);
                    ws.reload();
                  })
                }
              >
                Share this kitchen's totals with {asked}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
