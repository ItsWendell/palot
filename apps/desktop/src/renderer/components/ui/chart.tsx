import type { ChartTheme, ChartValue } from "@tanstack/charts";
import {
  Chart as TanStackChart,
  type ChartProps as TanStackChartProps,
} from "@tanstack/charts/react";
import { cn } from "@/lib/cn";

export const chartTheme = {
  foreground: "var(--muted-foreground)",
  muted: "var(--muted)",
  grid: "var(--border)",
  background: "transparent",
  palette: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ],
} satisfies ChartTheme;

export type ChartProps<
  TDatum,
  TXValue extends ChartValue = ChartValue,
  TYValue extends ChartValue = ChartValue,
> = TanStackChartProps<TDatum, TXValue, TYValue>;

function Chart<
  TDatum,
  TXValue extends ChartValue = ChartValue,
  TYValue extends ChartValue = ChartValue,
>({ className, ...props }: ChartProps<TDatum, TXValue, TYValue>) {
  return <TanStackChart {...props} className={cn("palot-chart", className)} />;
}

export { Chart };
