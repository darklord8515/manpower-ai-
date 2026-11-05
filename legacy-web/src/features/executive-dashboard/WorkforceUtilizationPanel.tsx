import { ProgressTrack } from '../../components/charts/ProgressTrack';
import { SegmentBar } from '../../components/charts/SegmentBar';
import { TrendChart } from '../../components/charts/TrendChart';
import { TrackLegend } from '../../components/charts/TrackLegend';
import { Panel } from '../../components/ui/Panel';
import { UTILIZATION_TARGET } from '../../config/workforce';
import { trades, utilizationTrend, workforceSegments } from '../../data/demo';
import { companyLabourSummary, peopleToReachTarget, projectsShort, tradeBalance, tradeBalances } from '../../data/labourSelectors';
import { deployedWorkforce, onHold, onLeave, totalWorkforce, utilization, workforceStates } from '../../data/selectors';
import type { WorkforceSegment } from '../../data/types';
import { formatInt, formatPercent, formatSignedOne } from '../../lib/format';
import styles from './WorkforceUtilizationPanel.module.css';

const SEGMENT_COLOR: Record<WorkforceSegment['key'], string> = {
  deployed: 'var(--chart-1)',
  mobilizing: 'var(--pattern-mobilizing)',
  available: 'var(--chart-2)',
  leave: 'var(--track)',
  hold: 'var(--color-brand)',
};

const barLabel = `Workforce status: ${workforceStates
  .map((state) => `${formatInt(state.count)} ${state.label.toLowerCase()}`)
  .join(', ')}, of ${formatInt(totalWorkforce)} employees`;

const previous = utilizationTrend[utilizationTrend.length - 2].value;
const current = utilizationTrend[utilizationTrend.length - 1].value;

const largestPool = [...trades].sort((a, b) => b.available - a.available)[0];
const unfilledTrades = tradeBalances.filter((balance) => balance.unfilled > 0);
const availableTotal = workforceStates.find((state) => state.key === 'available')!.count;
const unfilledSentence = unfilledTrades
  .map((balance) => `${trades.find((trade) => trade.key === balance.key)!.trade.toLowerCase()} would still be ${formatInt(balance.unfilled)} short`)
  .join(' and ');
const insight = `Projects are ${formatInt(companyLabourSummary.short)} short across ${projectsShort} sites, and ${formatInt(availableTotal)} people are available. But ${formatInt(largestPool.available)} of them are ${largestPool.trade.toLowerCase()}, and even with everyone mobilizing, ${unfilledSentence}.`;

const tradeRows = trades
  .map((trade) => ({ ...trade, percent: (trade.deployed / trade.total) * 100 }))
  .sort((a, b) => b.percent - a.percent);

const trendSummary = `Weekly utilization over 12 weeks, rising from ${formatPercent(utilizationTrend[0].value)} to ${formatPercent(current)}, against an illustrative target of ${UTILIZATION_TARGET}%`;

export function WorkforceUtilizationPanel() {
  return (
    <Panel title="Workforce utilization" subtitle={`Share of ${formatInt(totalWorkforce)} employees deployed on projects`}>
      <div className={styles.body}>
        <div className={styles.summary}>
          <p className={styles.headline}>
            <span className={styles.value}>{formatPercent(utilization)}</span>
            <span className={styles.note}>
              {formatInt(peopleToReachTarget(deployedWorkforce, totalWorkforce))} more people on site would reach the illustrative{' '}
              {UTILIZATION_TARGET}% target, which is not an approved company target. Up{' '}
              {formatSignedOne(current - previous).replace('+', '')} points this week.
            </span>
          </p>
          <SegmentBar
            size="lg"
            label={barLabel}
            segments={workforceSegments.map((segment) => ({
              key: segment.key,
              value: segment.count,
              color: SEGMENT_COLOR[segment.key],
              outlined: segment.key === 'leave',
            }))}
          />
          <ul className={styles.states} aria-label="Workforce by status">
            {workforceStates.map((state) => (
              <li key={state.key} className={styles.state}>
                <span className={styles.stateLabel}>
                  {state.key === 'unavailable' ? (
                    <>
                      <span className={styles.swatch} data-outlined="true" style={{ background: SEGMENT_COLOR.leave }} aria-hidden="true" />
                      <span className={styles.swatch} style={{ background: SEGMENT_COLOR.hold }} aria-hidden="true" />
                    </>
                  ) : (
                    <span className={styles.swatch} style={{ background: SEGMENT_COLOR[state.key] }} aria-hidden="true" />
                  )}
                  {state.label}
                </span>
                <span className={styles.stateFigures}>
                  <span className={styles.stateCount}>{formatInt(state.count)}</span>
                  <span className={styles.stateShare}>{formatPercent((state.count / totalWorkforce) * 100)}</span>
                </span>
                <span className={styles.stateMeaning}>
                  {state.key === 'unavailable'
                    ? `${formatInt(onLeave)} on leave, ${formatInt(onHold)} on visa or medical hold`
                    : state.meaning}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.insight}>{insight}</p>
        </div>

        <div className={styles.split}>
          <div className={styles.block}>
            <h3 className={styles.blockTitle}>Last 12 weeks</h3>
            <p className={styles.blockNote}>Each point is the week starting that date. The axis starts at 70%.</p>
            <TrendChart
              label={trendSummary}
              points={utilizationTrend}
              target={UTILIZATION_TARGET}
              domain={[70, 90]}
              ticks={[70, 75, 80, 85, 90]}
            />
          </div>
          <div className={styles.block}>
            <h3 className={styles.blockTitle}>By trade, against the illustrative {UTILIZATION_TARGET}% target</h3>
            <TrackLegend actual="Deployed" shortfall="Below target" mark="Target" />
            <ul className={styles.trades}>
              {tradeRows.map((trade) => {
                const balance = tradeBalance(trade.key);
                return (
                <li key={trade.trade} className={styles.trade}>
                  <span className={styles.tradeName}>{trade.trade}</span>
                  <span className={styles.tradeValue}>
                    {formatPercent(trade.percent)}
                    <span className="sr-only">
                      , {formatInt(trade.deployed)} of {formatInt(trade.total)} deployed
                    </span>
                  </span>
                  <span className={styles.tradeTrack}>
                    <ProgressTrack value={trade.percent} mark={UTILIZATION_TARGET} />
                  </span>
                  <span className={styles.tradeBalance}>
                    <span className={styles.tradeShort}>{formatInt(balance.short)} short</span>
                    <span>{formatInt(balance.mobilizing)} mobilizing</span>
                    <span>{formatInt(balance.available)} available</span>
                    {balance.unfilled > 0 && (
                      <strong className={styles.tradeUnfilled}>{formatInt(balance.unfilled)} can’t be filled internally</strong>
                    )}
                  </span>
                </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </Panel>
  );
}
