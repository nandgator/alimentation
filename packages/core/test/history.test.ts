import { describe, expect, it } from "vitest";
import {
  type AuditRow,
  describeAudit,
  type HistoryContext,
  lateByDays,
  type Role,
  whoLabel,
} from "../src/index.ts";

const ROLES: Record<string, Role> = {
  jovial: "consumer",
  smruti: "consumer",
  admin: "admin",
  maple: "supplier",
};
const NAMES: Record<string, string> = { jovial: "Jovial", smruti: "Smruti" };
const ITEMS: Record<string, string> = { thali: "Thali", curd: "Curd", rice: "Rice" };
const SERVICES: Record<string, string> = { lunch: "Lunch", dinner: "Dinner" };
const CLAIMS = { c1: { consumerId: "jovial", amount: 100_000, forMonth: "2026-10-01" } };

/** What the person reading may know. A member knows no one's name but their own. */
const as = (
  viewerId: string,
  known: string[] = [viewerId],
  severalServices = false,
): HistoryContext => ({
  viewerId,
  itemName: (id) => ITEMS[id],
  serviceName: (id) => SERVICES[id],
  severalServices,
  timeZone: "Asia/Kolkata",
  nameOf: (id) => (known.includes(id) ? NAMES[id] : undefined),
  roleOf: (id) => ROLES[id],
  claimOf: (id) => CLAIMS[id as keyof typeof CLAIMS],
});

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: 1,
  table: "log_entry",
  rowId: "x",
  action: "INSERT",
  actor: "jovial",
  at: "2026-10-14T10:00:00Z",
  before: null,
  after: null,
  ...over,
});

const entry = {
  on_date: "2026-10-14",
  person_id: "jovial",
  all_consumers: false,
  action: "Leave",
  service_id: null,
  item_id: null,
  qty: null,
  logged_at: "2026-10-14T05:00:00Z",
};

describe("how late an entry is", () => {
  it("counts days by the kitchen’s own calendar, not by UTC", () => {
    // 20:00 UTC on the 13th is already 01:30 on the 14th in Kolkata.
    expect(lateByDays("2026-10-14", "2026-10-13T20:00:00Z", "Asia/Kolkata")).toBe(0);
    expect(lateByDays("2026-10-14", "2026-10-14T20:00:00Z", "Asia/Kolkata")).toBe(1);
    expect(lateByDays("2026-10-14", "2026-10-17T05:00:00Z", "Asia/Kolkata")).toBe(3);
  });
  it("is never negative for an entry made ahead of its day", () => {
    expect(lateByDays("2026-10-20", "2026-10-14T05:00:00Z", "Asia/Kolkata")).toBe(0);
  });
});

describe("who did it, as the reader may know them", () => {
  it('says "You" for the reader, a role for staff and a name only if the reader may know it', () => {
    const member = as("jovial");
    expect(whoLabel("jovial", member)).toBe("You");
    expect(whoLabel("admin", member)).toBe("The admin");
    expect(whoLabel("maple", member)).toBe("The supplier");
    expect(whoLabel("smruti", member)).toBe("Someone");
    expect(whoLabel("smruti", as("maple", ["jovial", "smruti"]))).toBe("Smruti");
    expect(whoLabel(null, member)).toBe("The kitchen’s rules");
  });
});

describe("the trail in words", () => {
  const me = as("jovial");

  it("tells a member what they did, in the first person", () => {
    expect(describeAudit(row({ after: entry }), me)).toBe("You logged Leave on 14-Oct-2026.");
    expect(
      describeAudit(
        row({ after: { ...entry, action: "Extra", service_id: "lunch", item_id: "curd", qty: 2 } }),
        me,
      ),
    ).toBe("You logged Extra Curd ×2 on 14-Oct-2026.");
  });

  it("says when an entry was added after its day", () => {
    const late = { ...entry, logged_at: "2026-10-17T05:00:00Z" };
    expect(describeAudit(row({ after: late }), me)).toBe(
      "You logged Leave on 14-Oct-2026. It was added 3 days after the day itself.",
    );
    expect(
      describeAudit(row({ after: { ...late, logged_at: "2026-10-15T05:00:00Z" } }), me),
    ).toContain("added 1 day after");
  });

  it("tells a member plainly when someone else added or removed something of theirs", () => {
    expect(describeAudit(row({ actor: "admin", after: entry }), me)).toBe(
      "The admin logged Leave on 14-Oct-2026 for you.",
    );
    expect(describeAudit(row({ actor: "admin", action: "DELETE", before: entry }), me)).toBe(
      "The admin removed your Leave entry for 14-Oct-2026.",
    );
    expect(describeAudit(row({ actor: "jovial", action: "DELETE", before: entry }), me)).toBe(
      "You removed your Leave entry for 14-Oct-2026.",
    );
  });

  it("shows the supplier a member’s name, and a member only themselves", () => {
    const supplier = as("maple", ["jovial", "smruti"]);
    expect(describeAudit(row({ after: entry }), supplier)).toBe(
      "Jovial logged Leave on 14-Oct-2026.",
    );
    expect(describeAudit(row({ actor: "admin", after: entry }), supplier)).toBe(
      "The admin logged Leave on 14-Oct-2026 for Jovial.",
    );
    expect(describeAudit(row({ actor: "admin", after: entry }), as("smruti"))).toBe(
      "The admin logged Leave on 14-Oct-2026 for a member.",
    );
  });

  it("words a day the kitchen was off", () => {
    const off = { ...entry, person_id: null, all_consumers: true, action: "Supplier Off" };
    expect(describeAudit(row({ actor: "maple", after: off }), me)).toBe(
      "The supplier marked the kitchen off on 14-Oct-2026.",
    );
    expect(describeAudit(row({ actor: "maple", action: "DELETE", before: off }), me)).toBe(
      "The supplier removed the kitchen-off day on 14-Oct-2026.",
    );
  });

  it("words a claim from filing to decision to reversal", () => {
    const claim = {
      consumer_id: "jovial",
      amount: 100_000,
      for_month: "2026-10-01",
      method: "UPI",
    };
    expect(describeAudit(row({ table: "claim", after: claim }), me)).toBe(
      "You claimed ₹1,000 for Oct-26 (UPI).",
    );
    expect(describeAudit(row({ table: "claim", actor: "admin", after: claim }), me)).toBe(
      "The admin filed a claim of ₹1,000 for you, for Oct-26 (UPI).",
    );
    expect(
      describeAudit(row({ table: "claim", actor: "admin", action: "DELETE", before: claim }), me),
    ).toBe("The admin withdrew your claim of ₹1,000 for Oct-26.");
    const decided = (decision: string) =>
      row({ table: "claim_decision", rowId: "c1", actor: "maple", after: { decision } });
    expect(describeAudit(decided("Confirmed"), me)).toBe(
      "The supplier confirmed your claim of ₹1,000 for Oct-26.",
    );
    expect(describeAudit(decided("Disputed"), me)).toBe(
      "The supplier disputed your claim of ₹1,000 for Oct-26.",
    );
    expect(
      describeAudit(row({ table: "claim_reversal", rowId: "c1", actor: "admin", after: {} }), me),
    ).toBe(
      "The admin reversed the decision on your claim of ₹1,000 for Oct-26. It no longer counts.",
    );
    expect(
      describeAudit(
        row({ table: "claim_decision", rowId: "gone", after: { decision: "Confirmed" } }),
        me,
      ),
    ).toBe("You confirmed a claim.");
  });

  it("words a settlement and a month close, including one made by the kitchen’s own rules", () => {
    const settle = (type: string, amount: number | null) =>
      row({
        table: "settlement",
        actor: "admin",
        after: { consumer_id: "jovial", for_month: "2026-10-01", type, amount },
      });
    expect(describeAudit(settle("Payment", 50_000), me)).toBe(
      "The admin recorded a payment of ₹500 on your Oct-26 bill.",
    );
    expect(describeAudit(settle("Query", null), me)).toBe(
      "The admin raised a query on your Oct-26 bill.",
    );
    expect(describeAudit(settle("Query Resolved", null), me)).toBe(
      "The admin resolved the query on your Oct-26 bill.",
    );
    const close = { consumer_id: "jovial", for_month: "2026-10-01", billed: 326_000 };
    expect(describeAudit(row({ table: "month_close", actor: "admin", after: close }), me)).toBe(
      "The admin closed your Oct-26 bill at ₹3,260.",
    );
    expect(describeAudit(row({ table: "month_close", actor: null, after: close }), me)).toBe(
      "The kitchen’s rules closed your Oct-26 bill at ₹3,260.",
    );
    expect(
      describeAudit(
        row({ table: "month_close", actor: "admin", action: "DELETE", before: close }),
        me,
      ),
    ).toBe("The admin reopened your Oct-26 bill.");
  });

  it("words changes to a person, and says nothing of a change nobody can see", () => {
    const was = {
      status: "ACTIVE",
      active_from: "2026-10-01",
      active_to: null,
      name_enc: "a",
      contact_enc: "b",
    };
    const upd = (now: object) =>
      row({
        table: "person",
        rowId: "jovial",
        actor: "admin",
        action: "UPDATE",
        before: was,
        after: { ...was, ...now },
      });
    expect(describeAudit(upd({ status: "DISABLED" }), me)).toBe(
      "The admin disabled your place in the kitchen.",
    );
    expect(describeAudit(upd({ active_to: "2026-12-31" }), me)).toBe(
      "The admin changed your billing dates: from 01-Oct-2026 until 31-Dec-2026.",
    );
    expect(describeAudit(upd({ contact_enc: "c" }), me)).toBe("The admin changed your details.");
    expect(describeAudit(upd({}), me)).toBeNull();
    expect(
      describeAudit(
        row({ table: "person", rowId: "jovial", actor: "admin", after: { ...was } }),
        me,
      ),
    ).toBe("The admin added you to the kitchen, billed from 01-Oct-2026.");
    // A kitchen without money does not bill anyone, and does not say it does.
    const plain = { ...me, moneyEnabled: false };
    expect(describeAudit(upd({ active_to: "2026-12-31" }), plain)).toBe(
      "The admin changed your meal dates: from 01-Oct-2026 until 31-Dec-2026.",
    );
    expect(
      describeAudit(
        row({ table: "person", rowId: "jovial", actor: "admin", after: { ...was } }),
        plain,
      ),
    ).toBe("The admin added you to the kitchen, counted from 01-Oct-2026.");
  });

  it("words what everyone is billed by: prices, rules and holidays", () => {
    expect(
      describeAudit(
        row({
          table: "rate_card",
          actor: "admin",
          after: { effective_from: "2026-11-01", monthly_fee: 4_000 },
        }),
        me,
      ),
    ).toBe("The admin added prices from 01-Nov-2026, with ₹40 a month as the monthly fee.");
    // The lines of a card and a menu are rows of their own; the card and the menu are the event.
    for (const table of ["rate_price", "menu_offer", "menu_day"])
      expect(describeAudit(row({ table, after: {} }), me)).toBeNull();
    expect(
      describeAudit(
        row({ table: "policy_version", actor: "admin", after: { effective_from: "2026-11-01" } }),
        me,
      ),
    ).toBe("The admin changed the kitchen’s rules, from 01-Nov-2026.");
    const h = { name: "Diwali", on_date: "2026-11-09", confirmed: false };
    expect(describeAudit(row({ table: "holiday", actor: "admin", after: h }), me)).toBe(
      "The admin added the holiday “Diwali” on 09-Nov-2026 (not yet confirmed).",
    );
    expect(
      describeAudit(
        row({
          table: "holiday",
          actor: "admin",
          action: "UPDATE",
          before: h,
          after: { ...h, confirmed: true },
        }),
        me,
      ),
    ).toBe("The admin changed the holiday “Diwali” on 09-Nov-2026.");
    expect(
      describeAudit(row({ table: "holiday", actor: "admin", action: "DELETE", before: h }), me),
    ).toBe("The admin removed the holiday “Diwali” on 09-Nov-2026.");
  });

  describe("with several services", () => {
    const many = as("jovial", ["jovial"], true);
    const one = as("jovial");
    const at = (patch: Record<string, unknown>) => ({ ...entry, ...patch });

    it("names the service only where there are several", () => {
      const extra = at({ action: "Extra", service_id: "dinner", item_id: "curd", qty: 2 });
      expect(describeAudit(row({ after: extra }), many)).toBe(
        "You logged Extra Curd ×2 in Dinner on 14-Oct-2026.",
      );
      expect(describeAudit(row({ after: extra }), one)).toBe(
        "You logged Extra Curd ×2 on 14-Oct-2026.",
      );
      const swap = at({ action: "Switch", service_id: "lunch", item_id: "rice" });
      expect(describeAudit(row({ after: swap }), many)).toBe(
        "You logged Switch to Rice in Lunch on 14-Oct-2026.",
      );
      expect(describeAudit(row({ after: swap }), one)).toBe(
        "You logged Switch to Rice on 14-Oct-2026.",
      );
    });
    it("says a leave is for the whole day, or for one service", () => {
      expect(describeAudit(row({ after: entry }), many)).toBe(
        "You logged Leave (whole day) on 14-Oct-2026.",
      );
      expect(describeAudit(row({ after: at({ service_id: "dinner" }) }), many)).toBe(
        "You logged Leave in Dinner on 14-Oct-2026.",
      );
      expect(describeAudit(row({ after: at({ service_id: "dinner" }) }), one)).toBe(
        "You logged Leave on 14-Oct-2026.",
      );
      expect(
        describeAudit(row({ action: "DELETE", before: at({ service_id: "dinner" }) }), many),
      ).toBe("You removed your Leave in Dinner entry for 14-Oct-2026.");
      expect(
        describeAudit(row({ action: "UPDATE", after: at({ service_id: "dinner" }) }), many),
      ).toBe("You changed your Leave in Dinner entry for 14-Oct-2026.");
    });
    it("says the kitchen was off for a service", () => {
      const off = (service_id: string | null) => ({
        ...entry,
        person_id: null,
        all_consumers: true,
        action: "Supplier Off",
        service_id,
      });
      expect(describeAudit(row({ actor: "maple", after: off("dinner") }), many)).toBe(
        "The supplier marked the kitchen off for Dinner on 14-Oct-2026.",
      );
      expect(describeAudit(row({ actor: "maple", after: off("dinner") }), one)).toBe(
        "The supplier marked the kitchen off on 14-Oct-2026.",
      );
      expect(describeAudit(row({ actor: "maple", after: off(null) }), many)).toBe(
        "The supplier marked the kitchen off on 14-Oct-2026.",
      );
      expect(
        describeAudit(row({ actor: "maple", action: "DELETE", before: off("dinner") }), many),
      ).toBe("The supplier removed the kitchen-off day for Dinner on 14-Oct-2026.");
    });
    it("shows the current name for an item or service it cannot find as a plain noun", () => {
      const lost = at({ action: "Extra", service_id: "gone", item_id: "gone", qty: 1 });
      expect(describeAudit(row({ after: lost }), many)).toBe(
        "You logged Extra an item ×1 in a service on 14-Oct-2026.",
      );
    });
    it("words enrolment, but only where there is a choice", () => {
      const enrolled = {
        person_id: "jovial",
        service_id: "dinner",
        active_from: "2026-10-01",
        active_to: null,
      };
      const ins = row({ table: "person_service", actor: "admin", after: enrolled });
      expect(describeAudit(ins, many)).toBe("The admin set you to take Dinner from 01-Oct-2026.");
      expect(describeAudit(ins, one)).toBeNull();
      const bounded = { ...enrolled, active_to: "2026-12-31" };
      expect(
        describeAudit(row({ table: "person_service", actor: "admin", after: bounded }), many),
      ).toBe("The admin set you to take Dinner from 01-Oct-2026 until 31-Dec-2026.");
      const upd = (before: Record<string, unknown>, after: Record<string, unknown>) =>
        row({ table: "person_service", actor: "admin", action: "UPDATE", before, after });
      expect(describeAudit(upd(enrolled, bounded), many)).toBe(
        "The admin changed your place in Dinner: until 31-Dec-2026.",
      );
      expect(describeAudit(upd(bounded, enrolled), many)).toBe(
        "The admin changed your place in Dinner: until further notice.",
      );
      expect(describeAudit(upd(enrolled, enrolled), many)).toBeNull();
      expect(
        describeAudit(
          row({ table: "person_service", actor: "admin", action: "DELETE", before: enrolled }),
          many,
        ),
      ).toBe("The admin removed your place in Dinner.");
    });
  });

  describe("the catalogue", () => {
    const item = { name: "Thali", archived_on: null };
    const ev = (
      table: string,
      action: string,
      before: Record<string, unknown> | null,
      after: Record<string, unknown> | null,
    ) => row({ table, actor: "admin", action, before, after });
    it("words an item or service added, renamed and retired", () => {
      expect(describeAudit(ev("catalogue_item", "INSERT", null, item), me)).toBe(
        "The admin added “Thali” to what the kitchen serves.",
      );
      expect(describeAudit(ev("service", "INSERT", null, { name: "Dinner" }), me)).toBe(
        "The admin added the service “Dinner”.",
      );
      expect(
        describeAudit(ev("catalogue_item", "UPDATE", item, { ...item, name: "Rice" }), me),
      ).toBe("The admin renamed the item “Thali” to “Rice”.");
      expect(
        describeAudit(
          ev(
            "service",
            "UPDATE",
            { name: "Dinner", archived_on: null },
            { name: "Supper", archived_on: null },
          ),
          me,
        ),
      ).toBe("The admin renamed the service “Dinner” to “Supper”.");
      expect(
        describeAudit(
          ev("catalogue_item", "UPDATE", item, { ...item, archived_on: "2026-12-01" }),
          me,
        ),
      ).toBe("The admin retired the item “Thali” from 01-Dec-2026.");
      expect(
        describeAudit(
          ev(
            "service",
            "UPDATE",
            { name: "Dinner", archived_on: null },
            { name: "Dinner", archived_on: "2026-12-01" },
          ),
          me,
        ),
      ).toBe("The admin retired the service “Dinner” from 01-Dec-2026.");
    });
    it("words a rename and a retirement made together, and ignores a change that is neither", () => {
      expect(
        describeAudit(
          ev("catalogue_item", "UPDATE", item, { name: "Rice", archived_on: "2026-12-01" }),
          me,
        ),
      ).toBe(
        "The admin renamed the item “Thali” to “Rice”. The admin retired the item “Rice” from 01-Dec-2026.",
      );
      expect(describeAudit(ev("catalogue_item", "UPDATE", item, { ...item }), me)).toBeNull();
      expect(describeAudit(ev("catalogue_item", "DELETE", item, null), me)).toBeNull();
    });
  });

  it("skips tables nobody would look for", () => {
    expect(describeAudit(row({ table: "workspace", after: {} }), me)).toBeNull();
  });
});
