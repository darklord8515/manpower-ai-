import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatDayMonth, formatPercent } from '../../lib/format';
import type { UtilizationPoint } from '../../data/types';
import styles from './TrendChart.module.css';

interface TrendChartProps {
  label: string;
  points: UtilizationPoint[];
  target: number;
  domain: [number, number];
  ticks: number[];
  targetLabel?: string;
  formatValue?: (value: number) => string;
  formatTick?: (value: number) => string;
  formatAxisDate?: (iso: string) => string;
  formatPointDate?: (iso: string) => string;
  xLabelEvery?: number;
  leftPad?: number;
  fullHeight?: number;
  phoneHeight?: number;
}

const PAD = { top: 12, right: 44, bottom: 24 };
/** Below this width, date labels skip every other point so they can't collide. */
const NARROW_CHART = 420;

export function TrendChart({
  label,
  points,
  target,
  domain,
  ticks,
  targetLabel = 'Target',
  formatValue = formatPercent,
  formatTick = (value) => `${value}%`,
  formatAxisDate = formatDayMonth,
  formatPointDate = (iso) => `Week of ${formatDayMonth(iso)}`,
  xLabelEvery = 3,
  leftPad = 34,
  fullHeight = 420,
  phoneHeight = 240,
}: TrendChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const isPhone = useMediaQuery('(max-width: 639px)');
  const HEIGHT = isPhone ? phoneHeight : fullHeight;
  const PADDING = { ...PAD, left: leftPad };

  // A touch reading stays after the finger lifts, so it needs its own way to close.
  useEffect(() => {
    if (active === null) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active, containerRef]);

  const plotWidth = Math.max(width - PADDING.left - PAD.right, 1);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PADDING.left + (index / (points.length - 1)) * plotWidth;
  const y = (value: number) => PAD.top + (1 - (value - domain[0]) / (domain[1] - domain[0])) * plotHeight;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`).join(' ');
  const last = points.length - 1;

  const readPointer = (event: PointerEvent<SVGSVGElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    const ratio = (event.clientX - left - PADDING.left) / plotWidth;
    setActive(Math.min(last, Math.max(0, Math.round(ratio * last))));
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    setActive((current) => Math.min(last, Math.max(0, (current ?? last) + step)));
  };

  const activePoint = active === null ? null : points[active];
  const readout = activePoint ? `${formatPointDate(activePoint.week)}: ${formatValue(activePoint.value)}` : '';

  return (
    <div ref={containerRef} className={styles.chart} style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          tabIndex={0}
          role="group"
          aria-label={`${label}. Use the left and right arrow keys to read each point.`}
          className={styles.svg}
          onPointerDown={readPointer}
          onPointerMove={readPointer}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setActive(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PADDING.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className={styles.grid} />
              <text x={PADDING.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className={styles.axis}>
                {formatTick(tick)}
              </text>
            </g>
          ))}

          <line x1={PADDING.left} x2={width - PAD.right} y1={y(target)} y2={y(target)} className={styles.target} />
          <text x={width - PAD.right + 6} y={y(target)} dy="0.32em" className={styles.targetLabel}>
            {targetLabel}
          </text>

          {points.map(
            (point, index) =>
              (last - index) % (width < NARROW_CHART ? Math.max(xLabelEvery, 2) : xLabelEvery) === 0 && (
                <text key={point.week} x={x(index)} y={HEIGHT - 6} textAnchor="middle" className={styles.axis}>
                  {formatAxisDate(point.week)}
                </text>
              ),
          )}

          <path d={path} className={styles.line} />
          <circle cx={x(last)} cy={y(points[last].value)} r={3.5} className={styles.point} />
          <text x={x(last) + 8} y={y(points[last].value)} dy="0.32em" className={styles.endLabel}>
            {formatValue(points[last].value)}
          </text>

          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className={styles.cursor} />
              <circle cx={x(active)} cy={y(points[active].value)} r={4.5} className={styles.point} />
            </g>
          )}
        </svg>
      )}

      {activePoint && active !== null && (
        <div
          className={styles.tooltip}
          style={{
            insetInlineStart: Math.min(Math.max(x(active), 62), width - 62),
            insetBlockStart: Math.max(y(activePoint.value) - 46, 0),
          }}
        >
          <strong>{formatValue(activePoint.value)}</strong>
          <span>{formatPointDate(activePoint.week)}</span>
        </div>
      )}

      <span className="sr-only" aria-live="polite">
        {readout}
      </span>
    </div>
  );
}
