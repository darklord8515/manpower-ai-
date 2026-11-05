/** Display formats from docs/design-direction.md: `5 Nov 2026`, thousands separators, `AED 1,250`. */
const LOCALE = "en-GB";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const onePlace = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const aed = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

export const formatInt = (value: number): string => integer.format(value);
export const formatPercent = (value: number): string => `${onePlace.format(value)}%`;
export const formatAed = (value: number): string => `AED ${aed.format(value)}`;

/** ISO date (`2026-11-05`, or a full timestamp) to `5 Nov 2026`. Uses the date part only, no time zone shift. */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) throw new Error(`Not an ISO date: ${iso}`);
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}
