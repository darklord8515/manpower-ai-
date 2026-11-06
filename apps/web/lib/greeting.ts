export type DayPeriod = "morning" | "afternoon" | "evening";

/**
 * The company works on Gulf Standard Time (UTC+4, no daylight saving), so the greeting and the
 * picture follow Dubai time whatever the visitor's computer is set to.
 *   05:00-11:59 morning, 12:00-16:59 afternoon, 17:00-04:59 evening
 * (Ras Al Khaimah sunset is about 17:25 in November, which matches the evening picture.)
 */
export const COMPANY_TIME_ZONE = "Asia/Dubai";

export function companyHour(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: COMPANY_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

export function periodFor(now: Date): DayPeriod {
  const hour = companyHour(now);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function greeting(period: DayPeriod, fullName: string): string {
  return `Good ${period}, ${firstName(fullName)}`;
}

export function companyDate(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: COMPANY_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}
