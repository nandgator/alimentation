import { ChevronDownIcon, CopyIcon, LandmarkIcon } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { postJson } from "@/api";
import { AppForm, FormDialog, FormField, useAppForm } from "@/components/app";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useSession } from "../session.tsx";
import { CopySetupDialog } from "./CopySetup.tsx";

const orgSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the organisation a name")
    .max(120, "Keep it under 120 characters"),
});

function NewOrganisationDialog({
  first,
  open,
  onOpenChange,
}: {
  first: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, go] = useLocation();
  const { refresh } = useSession();
  const form = useAppForm(orgSchema, { name: "" });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={first ? "Start an organisation" : "Start another organisation"}
      description="A head office over several kitchens. It sees how each is doing: how many people, how many meals, what was billed, paid and is owed. It never sees a name. A kitchen joins only when its own admin agrees, and can stop whenever it likes."
      formId="new-org-form"
      submitLabel="Start it"
      busyLabel="Starting…"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
    >
      <AppForm
        id="new-org-form"
        form={form}
        onSubmit={async (v) => {
          const made = await postJson<{ id: string }>("/api/organisations", { name: v.name });
          await refresh();
          form.reset();
          onOpenChange(false);
          go(`/app/org/${made.id}`);
        }}
      >
        <FormField
          name="name"
          label="Name"
          required
          description="What the group of kitchens is called."
        >
          {(f) => <Input {...f} maxLength={120} autoComplete="off" />}
        </FormField>
      </AppForm>
    </FormDialog>
  );
}

/**
 * What someone who runs several kitchens is given beyond what everyone has: a "Manage" menu with the ways to work
 * across them. It is loaded only for such a person, so no one else downloads it.
 */
export function ManyKitchens({
  kitchens,
  organisations,
}: {
  kitchens: { slug: string; name: string }[];
  organisations: number;
}) {
  const [copying, setCopying] = useState(false);
  const [starting, setStarting] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          Manage
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {kitchens.length >= 2 ? (
            <DropdownMenuItem onClick={() => setCopying(true)}>
              <CopyIcon />
              Copy a setup
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setStarting(true)}>
            <LandmarkIcon />
            {organisations === 0 ? "Start an organisation" : "Start another organisation"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {kitchens.length >= 2 ? (
        <CopySetupDialog kitchens={kitchens} open={copying} onOpenChange={setCopying} />
      ) : null}
      <NewOrganisationDialog
        first={organisations === 0}
        open={starting}
        onOpenChange={setStarting}
      />
    </>
  );
}
