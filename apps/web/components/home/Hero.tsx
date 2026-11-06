"use client";

import { HeroImage } from "@/components/brand/HeroImage";
import { companyDate, greeting } from "@/lib/greeting";
import { useDayPeriod } from "@/lib/use-day-period";

type Props = {
  fullName: string;
  /** "HR Manager", "MD / CEO": the small label above the greeting. */
  roleLabel: string;
  /** One sentence written from real numbers. Omitted while they load. */
  insight?: string;
};

/**
 * The banner at the top of Home: the picture for this time of day (Dubai time), the greeting by
 * first name, and one line about what matters today. Text sits on a dark overlay on the left.
 */
export function Hero({ fullName, roleLabel, insight }: Props) {
  const period = useDayPeriod();
  return (
    <HeroImage
      period={period}
      priority
      overlay="left"
      sizes="(min-width: 1440px) 1300px, 100vw"
      className="min-h-44 rounded-card border border-border md:min-h-52"
    >
      <div className="flex h-full min-h-44 flex-col justify-end gap-1 p-5 text-(--on-photo) md:min-h-52 md:p-8">
        <p className="text-xs font-medium tracking-[0.08em] text-(--photo-caption) uppercase">
          {roleLabel}
        </p>
        {/* The greeting is empty until the browser knows the time, so it never flashes the wrong one. */}
        <h1 className="min-h-8 text-xl leading-8 font-semibold md:text-2xl md:leading-9">
          {period ? greeting(period, fullName) : ""}
        </h1>
        <p className="max-w-xl min-h-5 text-sm text-(--photo-caption)">
          {insight ?? " "}
          {insight && <span className="sr-only"> </span>}
        </p>
        <p className="text-xs text-(--photo-caption)">{period ? companyDate(new Date()) : " "}</p>
      </div>
    </HeroImage>
  );
}
