import { projectLabourSummary, projectTradeRows } from '../../data/labourSelectors';
import { formatInt } from '../../lib/format';
import styles from './ProjectLabourDetail.module.css';

function shortCell(gap: number) {
  if (gap < 0) return `${formatInt(-gap)} over`;
  return formatInt(gap);
}

/** The expanded view of one project row: its labour requirement, by trade. */
export function ProjectLabourDetail({ code, id }: { code: string; id: string }) {
  const summary = projectLabourSummary(code);
  const rows = projectTradeRows(code);
  const sources = rows.flatMap((row) => row.sources);

  return (
    <div className={styles.detail} id={id}>
      <div className={styles.inner}>
        <table className={styles.table} role="table">
          <caption className="sr-only">Labour by trade: required, deployed, short, pending and with no request</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                Trade
              </th>
              <th role="columnheader" scope="col">
                Required
              </th>
              <th role="columnheader" scope="col">
                Deployed
              </th>
              <th role="columnheader" scope="col">
                Short
              </th>
              <th role="columnheader" scope="col">
                Pending
              </th>
              <th role="columnheader" scope="col">
                No request
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row) => (
              <tr key={row.key} role="row" data-short={row.gap > 0}>
                <th role="rowheader" scope="row">
                  {row.trade}
                </th>
                <td role="cell">{formatInt(row.required)}</td>
                <td role="cell">{formatInt(row.deployed)}</td>
                <td role="cell" className={styles.shortCell}>
                  {shortCell(row.gap)}
                </td>
                <td role="cell">{formatInt(row.pending)}</td>
                <td role="cell" className={styles.uncoveredCell} data-open={row.uncovered > 0}>
                  {formatInt(row.uncovered)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot role="rowgroup">
            <tr role="row">
              <th role="rowheader" scope="row">
                Total
              </th>
              <td role="cell">{formatInt(summary.required)}</td>
              <td role="cell">{formatInt(summary.deployed)}</td>
              <td role="cell">{summary.over > 0 && summary.short === 0 ? `${formatInt(summary.over)} over` : formatInt(summary.short)}</td>
              <td role="cell">{formatInt(summary.pending)}</td>
              <td role="cell">{formatInt(summary.uncovered)}</td>
            </tr>
          </tfoot>
        </table>
        <p className={styles.note}>
          {sources.length > 0
            ? `Pending: ${sources.map((source) => `${source.label} (${formatInt(source.employees)})`).join(', ')}. Includes requests not yet approved, and doesn’t change with decisions made on this page.`
            : 'No requests are pending for this project.'}
        </p>
      </div>
    </div>
  );
}
