import { useState } from "react";
import { z } from "zod";
import { api, postJson } from "@/api";
import { AppForm, FormField, SubmitButton, toast, useAppForm } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ActionProblem, useRun } from "./books/parts.tsx";
import { useWorkspace } from "./context.tsx";

const linkSchema = z.object({ link: z.string().trim().min(1, "Paste the link") });

/**
 * Whether this kitchen shares its totals with a head office. Kept small and at the bottom: most kitchens
 * never have one, and for those this is a single closed line.
 */
export function HeadOffice() {
  const ws = useWorkspace();
  const mine = ws.boot.organisation;
  const stop = useRun();
  const share = useRun();
  const form = useAppForm(linkSchema, { link: "" });
  const [asked, setAsked] = useState<string | null>(null);
  const url = `${ws.api}/organisation`;

  if (mine)
    return (
      <Card role="region" aria-labelledby="ho-h">
        <CardHeader>
          <h2 id="ho-h" className="text-lg font-semibold">
            Head office
          </h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            This kitchen shares its totals with <strong>{mine.name}</strong>: how many people it
            feeds, how many meals{ws.money ? ", and what is billed, paid and owed" : ""} this month.
            No names, contacts or notes. Everyone in the kitchen can see this.
          </p>
          <ActionProblem error={stop.error} />
          <div>
            <Button
              variant="outline"
              loading={stop.busy}
              loadingText="Stopping…"
              disabled={!ws.writable}
              onClick={() =>
                void stop.run(async () => {
                  await api.del(url);
                  toast.success("This kitchen no longer shares its totals.");
                  ws.reload();
                })
              }
            >
              Stop sharing
            </Button>
          </div>
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <Collapsible>
        <CardHeader>
          <CollapsibleTrigger
            render={<button type="button" />}
            className="text-left text-sm font-medium underline-offset-4 hover:underline"
          >
            Share this kitchen's totals with a head office
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-4 pt-4">
            <p className="text-sm text-muted-foreground">
              For a group of kitchens that wants to see how each is doing. It sees counts and money
              for the month, never a name. You will be shown who it is before anything is shared,
              and you can stop whenever you like.
            </p>
            <AppForm
              form={form}
              onSubmit={async (v) => {
                const r = await postJson<{ organisation: { name: string } }>(url, {
                  token: v.link,
                });
                setAsked(r.organisation.name);
              }}
            >
              <FormField name="link" label="The link their head office sent you" required>
                {(f) => (
                  <Input
                    {...f}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => {
                      f.onChange(e);
                      setAsked(null);
                    }}
                  />
                )}
              </FormField>
              {asked ? null : (
                <SubmitButton busy="Looking…" className="self-start">
                  See who it is for
                </SubmitButton>
              )}
            </AppForm>
            {asked ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  This link is for <strong>{asked}</strong>.
                </p>
                <ActionProblem error={share.error} />
                <div>
                  <Button
                    loading={share.busy}
                    loadingText="Sharing…"
                    onClick={() =>
                      void share.run(async () => {
                        await postJson(url, {
                          token: form.getValues("link").trim(),
                          confirm: true,
                        });
                        form.reset();
                        setAsked(null);
                        toast.success(`This kitchen now shares its totals with ${asked}.`);
                        ws.reload();
                      })
                    }
                  >
                    Share this kitchen's totals with {asked}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
