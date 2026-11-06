import type { CSSProperties } from "react";

const LINES = 30;

/**
 * Slow, thin lines that drift across a dark panel: the sign-in page's only decoration.
 * Pure CSS animation (see `flow-line` in globals.css), so nothing runs in JavaScript, and it
 * stops for people who ask for reduced motion. Mostly white; every fifth line is brand red.
 * The same picture is produced every time, so server and browser always agree.
 */
export function FlowingLines({ mirrored = false }: { mirrored?: boolean }) {
  const lines = Array.from({ length: LINES }, (_, i) => {
    const y = 40 + i * 9;
    const sway = 60 + ((i * 37) % 90);
    return {
      key: i,
      d: `M-40 ${y} C 180 ${y - sway} 340 ${y + sway} 760 ${y - 30 + (i % 7) * 6}`,
      red: i % 5 === 0,
      width: 0.6 + (i % 4) * 0.25,
      alpha: (0.1 + (i % 6) * 0.035).toFixed(3),
      seconds: 22 + (i % 6) * 3,
      delay: -(i * 1.3),
    };
  });
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 720 360"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
    >
      {lines.map((line) => (
        <path
          key={line.key}
          d={line.d}
          pathLength={1}
          strokeDasharray="1 1"
          stroke={line.red ? "var(--sb-accent)" : "white"}
          strokeWidth={line.width}
          strokeOpacity={line.alpha}
          className="flow-line"
          style={
            {
              "--flow-duration": `${line.seconds}s`,
              "--flow-alpha": line.alpha,
              animationDelay: `${line.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </svg>
  );
}
