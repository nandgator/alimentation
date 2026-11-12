import { assembleBundle, type Bundle } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { FieldCipher } from "../src/crypto/fields.ts";
import { Keyring, loadWorkspaceKeys, newWorkspaceKeys } from "../src/crypto/keys.ts";
import { nodeDb } from "../src/db/node.ts";
import { exportWorkspace } from "../src/lifecycle/bundleio.ts";
import { importBundle } from "../src/lifecycle/import.ts";
import { makeFixture } from "./support/fixture.ts";
import { newWorkspace } from "./support/pg.ts";
import { seedSpec } from "./support/spec.ts";

/**
 * A bundle that was altered and sealed again has a good checksum, so what stops it is what it says: it must be
 * refused with reasons, never fail half way in the database, and leave the target empty.
 */
const when = new Date("2026-11-15T06:00:00Z");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("a bundle that was altered and sealed again", () => {
  it("is refused in words, for each thing the database would refuse", async () => {
    const fx = await makeFixture();
    try {
      await seedSpec(fx);
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const bundle: Bundle = await exportWorkspace(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today: "2026-11-15",
      });
      await owner.close();
      const { manifest: _m, ...base } = bundle;
      const cases: Record<string, (b: any) => void> = {
        "two items with one name in different case": (b) => {
          b.catalogue[1].name = b.catalogue[0].name.toUpperCase();
        },
        "two services with one name": (b) => {
          b.services.push({
            ...b.services[0],
            id: crypto.randomUUID(),
            name: b.services[0].name.toLowerCase(),
          });
        },
        "a person taking one service twice on the same days": (b) => {
          b.enrolments.push({ ...b.enrolments[0], id: crypto.randomUUID() });
        },
        "a largest quantity of zero": (b) => {
          b.catalogue[0].maxQty = 0;
        },
        "a largest quantity of a thousand": (b) => {
          b.catalogue[0].maxQty = 1000;
        },
        "an item named with nothing": (b) => {
          b.catalogue[0].name = "";
        },
        "an item with a unit of fifty characters": (b) => {
          b.catalogue[0].unit = "x".repeat(50);
        },
        "two menus starting on one day": (b) => {
          b.menus.push({ ...b.menus[0], id: crypto.randomUUID() });
        },
        "a log entry of two leaves in one scope": (b) => {
          const leave = b.log.find((e: any) => e.action === "Leave");
          b.log.push({ ...leave, id: crypto.randomUUID() });
        },
        "a quantity of a hundred": (b) => {
          const x = b.log.find((e: any) => e.action === "Extra");
          x.qty = 100;
        },
        "a service in position minus one": (b) => {
          b.services[0].position = -1;
        },
        "an extra above the largest quantity of its item": (b) => {
          const x = b.log.find((e: any) => e.action === "Extra");
          const item = b.catalogue.find((i: any) => i.id === x.itemId);
          x.qty = item.maxQty + 1;
        },
        "a whole day and one of its services both left": (b) => {
          const leave = b.log.find((e: any) => e.action === "Leave" && e.serviceId === null);
          b.log.push({ ...leave, id: crypto.randomUUID(), serviceId: b.services[0].id });
        },
      };
      for (const [name, change] of Object.entries(cases)) {
        const body = clone(base) as any;
        change(body);
        const ws = await newWorkspace();
        const { keyring } = await Keyring.generate();
        const keys = await loadWorkspaceKeys(
          keyring,
          ws.id,
          await newWorkspaceKeys(keyring, ws.id),
        );
        const t = { ws, cipher: new FieldCipher(keys), owner: nodeDb(ws.ownerUrl, { max: 2 }) };
        try {
          const r = await importBundle(t.owner, t.cipher, await assembleBundle(body), {
            dryRun: false,
          });
          expect(r.ok, name).toBe(false);
          expect(r.problems.length, name).toBeGreaterThan(0);
          const left = await t.ws.owner.query(
            "SELECT (SELECT count(*) FROM person) + (SELECT count(*) FROM catalogue_item) AS n",
          );
          expect(Number(left.rows[0]!.n), name).toBe(0);
        } finally {
          await t.owner.close();
          await t.ws.destroy();
        }
      }
    } finally {
      await fx.close();
    }
  }, 120_000);
});
