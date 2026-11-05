import { TrendChart } from '../../components/charts/TrendChart';
import { Panel } from '../../components/ui/Panel';
import { requiredWorkforceByMonth } from '../../data/forecastSelectors';
import { deployedWorkforce } from '../../data/selectors';
import { formatInt, formatMonthYear } from '../../lib/format';
import styles from './ProjectTimelinePanel.module.css';

const first = requiredWorkforceByMonth[0];
const last = requiredWorkforceByMonth[requiredWorkforceByMonth.length - 1];
const summary = `Required workforce by month end, falling from ${formatInt(first.value)} to ${formatInt(last.value)} as projects hand over, against ${formatInt(deployedWorkforce)} deployed today`;

export function ProjectTimelinePanel() {
  return (
    <Panel
      title="Project timeline and workforce demand"
      subtitle="Labour required at each month end, based on planned handovers"
    >
      <div className={styles.body}>
        <ul className={styles.legend} aria-label="Chart key">
          <li>
            <span className={styles.line} aria-hidden="true" />
            Required
          </li>
          <li>
            <span className={styles.dashed} aria-hidden="true" />
            Deployed today ({formatInt(deployedWorkforce)})
          </li>
        </ul>
        <TrendChart
          label={summary}
          points={requiredWorkforceByMonth}
          target={deployedWorkforce}
          targetLabel="Today"
          domain={[2000, 4000]}
          ticks={[2000, 2500, 3000, 3500, 4000]}
          formatTick={formatInt}
          formatValue={formatInt}
          formatAxisDate={formatMonthYear}
          formatPointDate={(iso) => `End of ${formatMonthYear(iso)}`}
          xLabelEvery={1}
          leftPad={44}
          fullHeight={240}
          phoneHeight={210}
        />
        <p className={styles.note}>
          Assumes every project hands over on time and no new projects start. It is a calculation from the fictional demo
          data, not a forecast of company demand.
        </p>
      </div>
    </Panel>
  );
}
