import type { StatementDto } from "@alimentation/core";
import { itemName } from "../../catalogue.ts";
import { money } from "../../format.ts";
import { useWorkspace } from "./context.tsx";

/**
 * One person's bill as the lines they can check against their own count: `Thali x 12`, `Curd x 8`, then the
 * leave charge and the monthly fee where there are any. The lines are the statement's own, so they add up to it.
 */
export function BillLines({ statement, name }: { statement: StatementDto; name: string | null }) {
  const { boot } = useWorkspace();
  const extra = [
    ...(statement.leaveAmount !== 0
      ? [
          {
            key: "leave",
            label: `Leave (${statement.counts.leave})`,
            amount: statement.leaveAmount,
          },
        ]
      : []),
    ...(statement.feeAmount !== 0
      ? [{ key: "fee", label: "Monthly fee", amount: statement.feeAmount }]
      : []),
  ];
  return (
    <div
      className="tablewrap"
      tabIndex={0}
      role="region"
      aria-label={`${name ? `${name}: ` : ""}Bill lines; scrolls sideways when it is wider than the screen`}
    >
      <table>
        {name ? <caption>{name}</caption> : null}
        <thead>
          <tr>
            <th>Item</th>
            <th className="r">How many</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {statement.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{itemName(boot, l.itemId)}</td>
              <td className="r">{l.qty}</td>
              <td className="r">{money(l.amount)}</td>
            </tr>
          ))}
          {extra.map((e) => (
            <tr key={e.key}>
              <td>{e.label}</td>
              <td />
              <td className="r">{money(e.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Bill</th>
            <th />
            <th className="r">{money(statement.liveTotal)}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
