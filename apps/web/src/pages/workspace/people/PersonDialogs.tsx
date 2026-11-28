import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { z } from "zod";
import { api, postJson } from "@/api";
import { AppForm, ConfirmAction, FormDialog, FormField, toast, useAppForm } from "@/components/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "../context.tsx";
import type { Member } from "./model.ts";
import { PersonDialog } from "./PersonForm.tsx";

const inviteSchema = z.object({
  email: z.email("Enter an email address, like name@example.org.").max(254),
});

function InviteDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const ws = useWorkspace();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useAppForm(inviteSchema, { email: "" });
  // The row nobody has signed in as yet.
  const row = member.rows.find((r) => !r.linked) ?? member.main;
  const title = `Invite ${member.main.name}`;

  if (link)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Send this link to {member.main.name}. It works once, for 7 days, and only with the
              email you typed.
            </DialogDescription>
          </DialogHeader>
          <Input
            readOnly
            value={link}
            aria-label="Invitation link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Done
            </Button>
            <Button
              type="button"
              onClick={() =>
                void navigator.clipboard?.writeText(link).then(() => {
                  setCopied(true);
                  toast.success("Link copied.");
                })
              }
            >
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description="They sign in with this address."
      formId="invite-form"
      submitLabel="Make a link"
      busyLabel="Making a link…"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <AppForm
        form={form}
        id="invite-form"
        serverFields={{ invalid: "email" }}
        onSubmit={async (v) => {
          const r = await postJson<{ link: string }>(`${ws.api}/people/${row.id}/invite`, {
            email: v.email,
          });
          setLink(r.link);
        }}
      >
        <FormField name="email" label={`${member.main.name}’s email`} required>
          {(f) => (
            <Input
              {...f}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </FormField>
      </AppForm>
    </FormDialog>
  );
}

type Open = { kind: "add" } | { kind: "edit" | "invite" | "disable"; member: Member } | null;

/**
 * The dialogs a person can be opened in, shared by the list and the person's page: add, edit, invite and disable.
 * Render `node` once; call the openers from a button or a menu.
 */
export function usePersonDialogs(): {
  node: ReactNode;
  add: () => void;
  edit: (m: Member) => void;
  invite: (m: Member) => void;
  disable: (m: Member) => void;
  enable: (m: Member) => void;
} {
  const ws = useWorkspace();
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);

  const enable = (m: Member) => {
    void Promise.all(m.rows.map((r) => api.patch(`${ws.api}/people/${r.id}`, { status: "ACTIVE" })))
      .then(() => {
        toast.success(`${m.main.name} is enabled.`);
        ws.reload();
      })
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : "That did not work. Try again."),
      );
  };

  const node = (
    <>
      <PersonDialog
        open={open?.kind === "add" || open?.kind === "edit"}
        member={open?.kind === "edit" ? open.member : null}
        onOpenChange={(o) => !o && close()}
      />
      {open?.kind === "invite" ? <InviteDialog member={open.member} onClose={close} /> : null}
      {open?.kind === "disable" ? (
        <ConfirmAction
          level="confirm"
          open
          onOpenChange={(o) => !o && close()}
          title={`Disable ${open.member.main.name}?`}
          description="Their history is kept and no new entries can be made for them. You can enable them again."
          confirmLabel="Disable"
          onConfirm={async () => {
            const m = open.member;
            await Promise.all(
              m.rows.map((r) => api.patch(`${ws.api}/people/${r.id}`, { status: "DISABLED" })),
            );
            toast.success(`${m.main.name} is disabled.`);
            ws.reload();
          }}
        />
      ) : null}
    </>
  );

  return {
    node,
    add: () => setOpen({ kind: "add" }),
    edit: (member) => setOpen({ kind: "edit", member }),
    invite: (member) => setOpen({ kind: "invite", member }),
    disable: (member) => setOpen({ kind: "disable", member }),
    enable,
  };
}
