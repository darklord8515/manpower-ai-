import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { ProgressTrack } from '../../components/charts/ProgressTrack';
import { TrackLegend } from '../../components/charts/TrackLegend';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { Segmented } from '../../components/ui/Segmented';
import { StatusMark } from '../../components/ui/StatusMark';
import { projects } from '../../data/demo';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { gapLabel, isSeverelyShort, severelyShortCount } from '../../data/labourSelectors';
import { planVariance, statusCounts, workforceGap } from '../../data/selectors';
import type { Project, ProjectStatus } from '../../data/types';
import { formatInt, formatMonthYear, formatSigned } from '../../lib/format';
import { LabourSummary } from './LabourSummary';
import { ProjectLabourDetail } from './ProjectLabourDetail';
import styles from './ProjectProgressPanel.module.css';

type Filter = 'all' | 'short' | ProjectStatus;
type SortKey = 'name' | 'variance' | 'gap' | 'handover' | 'status';
type SortState = { key: SortKey; direction: 'asc' | 'desc' };

export interface RevealRequest {
  code: string;
  /** Changes on each request, so selecting the same project twice still reveals it. */
  id: number;
}

const COLLAPSED_ROWS = 10;
const COLLAPSED_ROWS_PHONE = 5;
const HIGHLIGHT_MS = 2200;
const STATUS_RANK: Record<ProjectStatus, number> = { delayed: 0, 'at-risk': 1, 'on-track': 2 };

const SORT_VALUE: Record<SortKey, (project: Project) => number | string> = {
  name: (project) => project.name,
  variance: planVariance,
  gap: workforceGap,
  handover: (project) => project.handover,
  status: (project) => STATUS_RANK[project.status],
};

const COLUMNS: { key: SortKey; label: string; firstDirection: SortState['direction']; className?: string }[] = [
  { key: 'name', label: 'Project', firstDirection: 'asc' },
  { key: 'variance', label: 'Progress vs plan', firstDirection: 'asc' },
  { key: 'gap', label: 'Workforce', firstDirection: 'desc' },
  { key: 'handover', label: 'Handover', firstDirection: 'asc', className: styles.handoverCell },
  { key: 'status', label: 'Status', firstDirection: 'asc' },
];

const FILTERS: { value: Filter; label: string; count: number }[] = [
  { value: 'all', label: 'All', count: projects.length },
  { value: 'delayed', label: 'Delayed', count: statusCounts.delayed },
  { value: 'at-risk', label: 'At risk', count: statusCounts['at-risk'] },
  { value: 'on-track', label: 'On track', count: statusCounts['on-track'] },
  { value: 'short', label: '10%+ short', count: severelyShortCount },
];

const matchesFilter = (project: Project, filter: Filter) => {
  if (filter === 'all') return true;
  return filter === 'short' ? isSeverelyShort(project) : project.status === filter;
};

function varianceText(project: Project) {
  const variance = planVariance(project);
  if (variance === 0) return 'On plan';
  return `${formatSigned(variance)} ${Math.abs(variance) === 1 ? 'pt' : 'pts'}`;
}

function ProjectName({ project, open, onToggle }: { project: Project; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={styles.expand}
      aria-label={`${project.name}, labour by trade`}
      aria-expanded={open}
      aria-controls={open ? `labour-${project.code}` : undefined}
      onClick={onToggle}
    >
      <ChevronRight size={14} className={styles.chevron} data-open={open} aria-hidden="true" />
      <span className={styles.name}>{project.name}</span>
    </button>
  );
}

function ProgressCell({ project }: { project: Project }) {
  return (
    <div className={styles.progress}>
      <div className={styles.progressNumbers}>
        <span className={styles.percent}>{project.progress}%</span>
        <span className={styles.variance} data-behind={planVariance(project) < 0}>
          {varianceText(project)}
          <span className="sr-only"> against {project.planned}% planned</span>
        </span>
      </div>
      <ProgressTrack value={project.progress} mark={project.planned} />
    </div>
  );
}

function WorkforceCell({ project }: { project: Project }) {
  return (
    <>
      <span className={styles.staffing}>
        {formatInt(project.deployed)}
        <span className={styles.required}> of {formatInt(project.required)}</span>
      </span>
      <span className={styles.gap} data-severe={isSeverelyShort(project)}>
        {gapLabel(workforceGap(project))}
      </span>
    </>
  );
}

export function ProjectProgressPanel({ reveal }: { reveal: RevealRequest | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortState>({ key: 'variance', direction: 'asc' });
  const [expanded, setExpanded] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  const isPhone = useMediaQuery('(max-width: 639px)');
  const collapsedRows = isPhone ? COLLAPSED_ROWS_PHONE : COLLAPSED_ROWS;
  const rootRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const value = SORT_VALUE[sort.key];
    const factor = sort.direction === 'asc' ? 1 : -1;
    return projects
      .filter((project) => matchesFilter(project, filter))
      .sort((a, b) => {
        const [left, right] = [value(a), value(b)];
        const order =
          typeof left === 'string' ? left.localeCompare(right as string) : left - (right as number);
        return order * factor || a.name.localeCompare(b.name);
      });
  }, [filter, sort]);

  const visible = expanded ? rows : rows.slice(0, collapsedRows);
  const hiddenCount = rows.length - collapsedRows;

  useEffect(() => {
    if (!reveal) return;
    setFilter('all');
    setExpanded(true);
    setHighlighted(reveal.code);
    const timer = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [reveal]);

  useEffect(() => {
    if (!highlighted) return;
    const matches = rootRef.current?.querySelectorAll<HTMLElement>(`[data-project="${highlighted}"]`) ?? [];
    const target = Array.from(matches).find((element) => element.getClientRects().length > 0);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [highlighted]);

  const toggleRow = (code: string) => {
    setOpenRows((current) => {
      const next = new Set(current);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  };

  const toggleSort = (column: (typeof COLUMNS)[number]) => {
    setSort((current) =>
      current.key === column.key
        ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, direction: column.firstDirection },
    );
  };

  return (
    <Panel
      title="Project progress"
      subtitle="Select a project to see its labour by trade"
      actions={
        <Segmented
          label="Filter projects by status"
          value={filter}
          options={FILTERS}
          onChange={(next) => {
            setFilter(next);
            setExpanded(false);
          }}
        />
      }
    >
      <div className={styles.body} ref={rootRef}>
        <LabourSummary />
        <div className={styles.legend}>
          <TrackLegend actual="Actual" shortfall="Behind plan" mark="Planned for today" />
        </div>
        <div className={styles.tableView}>
          <table className={styles.table}>
            <caption className="sr-only">Project progress, workforce, handover and status</caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const active = sort.key === column.key;
                  const SortIcon = sort.direction === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={column.className}
                      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className={styles.sort} data-active={active} onClick={() => toggleSort(column)}>
                        {column.label}
                        {active && <SortIcon size={12} aria-hidden="true" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((project) => (
                <Fragment key={project.code}>
                <tr data-project={project.code} data-highlight={highlighted === project.code}>
                  <td>
                    <ProjectName project={project} open={openRows.has(project.code)} onToggle={() => toggleRow(project.code)} />
                    <span className={styles.meta}>
                      {project.code}, {project.emirate}. {project.phase}
                    </span>
                    <span className={styles.metaHandover}>Handover {formatMonthYear(project.handover)}</span>
                  </td>
                  <td className={styles.progressCell}>
                    <ProgressCell project={project} />
                  </td>
                  <td className={styles.workforceCell}>
                    <WorkforceCell project={project} />
                  </td>
                  <td className={styles.handoverCell}>{formatMonthYear(project.handover)}</td>
                  <td>
                    <StatusMark status={project.status} />
                  </td>
                </tr>
                {openRows.has(project.code) && (
                  <tr className={styles.detailRow}>
                    <td colSpan={COLUMNS.length}>
                      <ProjectLabourDetail code={project.code} id={`labour-${project.code}`} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <ul className={styles.listView}>
          {visible.map((project) => (
            <li
              key={project.code}
              className={styles.listItem}
              data-project={project.code}
              data-highlight={highlighted === project.code}
            >
              <div className={styles.listTop}>
                <span className={styles.listTitle}>
                  <ProjectName project={project} open={openRows.has(project.code)} onToggle={() => toggleRow(project.code)} />
                  <span className={styles.meta}>
                    {project.code}, {project.emirate}
                  </span>
                </span>
                <StatusMark status={project.status} />
              </div>
              <ProgressCell project={project} />
              <div className={styles.listFacts}>
                <span>
                  <WorkforceCell project={project} />
                </span>
                <span className={styles.listHandover}>Handover {formatMonthYear(project.handover)}</span>
              </div>
              {openRows.has(project.code) && (
                <div className={styles.listDetail}>
                  <ProjectLabourDetail code={project.code} id={`labour-${project.code}-list`} />
                </div>
              )}
            </li>
          ))}
        </ul>

        {hiddenCount > 0 && (
          <div className={styles.more}>
            <Button variant="ghost" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
              {expanded ? 'Show fewer projects' : `Show ${hiddenCount} more projects`}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
