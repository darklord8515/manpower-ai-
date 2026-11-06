"use client";

import { formatInt, formatPercent } from "@/lib/format";
import { useAnimatedNumber } from "@/lib/use-animated-number";

type Props = {
  value: number;
  format?: "int" | "percent";
  className?: string;
};

/**
 * A number that counts to its new value. The moving digits are hidden from assistive technology;
 * screen readers get the final number once instead of every frame.
 */
export function NumberTicker({ value, format = "int", className }: Props) {
  const shown = useAnimatedNumber(value);
  const fmt = (n: number) => (format === "percent" ? formatPercent(n) : formatInt(Math.round(n)));
  return (
    <>
      <b aria-hidden="true" className={className}>
        {fmt(shown)}
      </b>
      <span className="sr-only">{fmt(value)}</span>
    </>
  );
}
