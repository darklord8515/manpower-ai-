import { MARK, WORDMARK } from "./logo-markup";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Accessible name. Pass an empty string when the logo is decorative beside visible text. */
  label?: string;
};

/**
 * The company logos are white-only artwork, so they are drawn inline with fill=currentColor and
 * take their colour from the surrounding text (light and dark both work). The markup comes from
 * our own generated module, never from user input.
 */
function InlineSvg({
  viewBox,
  inner,
  className,
  label,
}: LogoProps & { viewBox: string; inner: string }) {
  const decorative = label === "";
  return (
    <svg
      viewBox={viewBox}
      className={cn("block shrink-0 fill-current", className)}
      role={decorative ? "presentation" : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

/** Wordmark with "Construction & Development". Login screen only. */
export function AlhamraWordmark({
  className,
  label = "Alhamra Construction & Development",
}: LogoProps) {
  return <InlineSvg {...WORDMARK} className={className} label={label} />;
}

/** Square mark. Sidebar header and the browser-tab icon. */
export function AlhamraMark({ className, label = "Alhamra" }: LogoProps) {
  return <InlineSvg {...MARK} className={className} label={label} />;
}
