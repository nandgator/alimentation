import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { monthShort } from "./figures.ts";

export interface ChartSeries {
  key: string;
  label: string;
  /** A chart token: `var(--chart-1)`. */
  color: string;
  /** One value per month. */
  values: readonly number[];
}

/** A rupee figure for an axis: ₹5k, ₹1.2L. */
function compact(paise: number): string {
  const r = paise / 100;
  if (r >= 100000) return `₹${+(r / 100000).toFixed(1)}L`;
  if (r >= 1000) return `₹${+(r / 1000).toFixed(1)}k`;
  return `₹${r}`;
}

/**
 * Months of one or two series as bars (DAT-07): a tooltip on hover and on keyboard focus, a key, "* projected"
 * for a month that is not over, and the same figures as a table for anyone who would rather read them.
 */
export function MonthlyChart({
  months,
  projected,
  series,
  format,
  axis = compact,
  label,
  testId,
}: {
  months: readonly string[];
  projected: readonly boolean[];
  series: readonly ChartSeries[];
  /** A figure in the tooltip and the table: money or a count. */
  format: (n: number) => string;
  /** A figure on the vertical axis. */
  axis?: (n: number) => string;
  /** What the chart shows, for assistive technology and the table's caption. */
  label: string;
  testId?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  const anyProjected = projected.some(Boolean);
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  );
  const data = months.map((m, i) => ({
    month: m,
    label: `${monthShort(m).slice(0, 3)}${projected[i] ? "*" : ""}`,
    ...Object.fromEntries(series.map((s) => [s.key, s.values[i] ?? 0])),
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {anyProjected ? "* projected: the month is not over yet." : "Each month, as billed."}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={asTable}
          aria-controls={tableId}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? "Show as chart" : "Show as table"}
        </Button>
      </div>
      <div id={tableId}>
        {asTable ? (
          <Table aria-label={label}>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                {series.map((s) => (
                  <TableHead key={s.key} className="text-right">
                    {s.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((m, i) => (
                <TableRow key={m}>
                  <TableCell>
                    {monthShort(m)}
                    {projected[i] ? " (projected)" : ""}
                  </TableCell>
                  {series.map((s) => (
                    <TableCell key={s.key} className="text-right tabular-nums">
                      {format(s.values[i] ?? 0)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-56 w-full md:h-64"
            data-testid={testId}
            role="group"
            aria-label={label}
          >
            <BarChart data={data} accessibilityLayer margin={{ left: 0, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis
                width={52}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => axis(v)}
                allowDecimals={false}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => {
                      const m = (p?.[0]?.payload as { month?: string } | undefined)?.month;
                      return m ? monthShort(m) : "";
                    }}
                    formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">{config[String(name)]?.label}</span>
                        <span className="font-medium tabular-nums">{format(Number(value))}</span>
                      </div>
                    )}
                  />
                }
              />
              {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
              {series.map((s) => (
                <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={3}>
                  {data.map((d, i) => (
                    <Cell
                      key={d.month}
                      fillOpacity={projected[i] ? 0.55 : 1}
                      stroke={projected[i] ? `var(--color-${s.key})` : "none"}
                      strokeDasharray={projected[i] ? "3 2" : undefined}
                    />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </div>
    </div>
  );
}
