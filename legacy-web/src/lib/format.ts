const LOCALE = 'en-GB';
const MINUS = '−';

const integer = new Intl.NumberFormat(LOCALE);
const onePlace = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signedInteger = new Intl.NumberFormat(LOCALE, { signDisplay: 'exceptZero' });
const signedOnePlace = new Intl.NumberFormat(LOCALE, {
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...options });
const longDate = dateFormat({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayMonth = dateFormat({ day: 'numeric', month: 'short' });
const monthYear = dateFormat({ month: 'short', year: 'numeric' });
const time = dateFormat({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const formatInt = (value: number) => integer.format(value);
export const formatPercent = (value: number) => `${onePlace.format(value)}%`;
export const formatSigned = (value: number) => signedInteger.format(value).replace('-', MINUS);
export const formatSignedOne = (value: number) => signedOnePlace.format(value).replace('-', MINUS);
export const formatLongDate = (iso: string) => longDate.format(new Date(iso));
export const formatDayMonth = (iso: string) => dayMonth.format(new Date(iso));
export const formatMonthYear = (iso: string) => monthYear.format(new Date(iso));
export const formatTime = (iso: string) => time.format(new Date(iso));
