import type { Page, Route } from "@playwright/test";

/**
 * A stateful pretend API for the Mobilization screen: ticking, reopening and confirming arrival
 * change what the next request returns, with the same answers and messages as the real one. The
 * rules themselves are tested in the API; here we test what the screen does with the answers.
 */

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, json: body, headers: {} });

type Stage = "pending_checklist" | "in_progress" | "ready" | "on_site";
type Key = "documents" | "bed" | "transport" | "ppe" | "induction";

const TEMPLATE: { department: string; name: string; key: Key; title: string; before: number }[] = [
  {
    department: "hr",
    name: "Human Resources",
    key: "documents",
    title: "Verify residency visa and medical fitness",
    before: 7,
  },
  {
    department: "operations",
    name: "Operations",
    key: "bed",
    title: "Assign a camp bed",
    before: 3,
  },
  {
    department: "operations",
    name: "Operations",
    key: "transport",
    title: "Arrange transport to site",
    before: 3,
  },
  { department: "site", name: "Site workforce", key: "ppe", title: "Issue PPE", before: 1 },
  {
    department: "site",
    name: "Site workforce",
    key: "induction",
    title: "Site induction",
    before: 0,
  },
];
const ALL: Key[] = ["documents", "bed", "transport", "ppe", "induction"];

type Fake = {
  mob_no: string;
  worker_code: string;
  worker_name: string;
  trade: string;
  project_code: string;
  project_name: string;
  report_on: string;
  done: Map<Key, { by: string; at: string }>;
  arrived_on: string | null;
};

const PEOPLE: [string, string, string, string, string, Key[]][] = [
  ["Aamir Siddiqui", "EMP-0501", "Steel fixer", "RAK-03", "Coral Bay Residences, Block B", ALL],
  ["Basil Thomas", "EMP-0502", "Carpenter", "RAK-06", "Dhayah Warehouse Units", ALL],
  [
    "Chandan Roy",
    "EMP-0503",
    "Mason",
    "RAK-01",
    "Jebel Approach Road, Package 2",
    ["documents", "bed", "transport", "ppe"],
  ],
  [
    "Dawood Karim",
    "EMP-0504",
    "Steel fixer",
    "RAK-03",
    "Coral Bay Residences, Block B",
    ["documents", "bed", "transport"],
  ],
  [
    "Elias Mathew",
    "EMP-0505",
    "General labour",
    "RAK-02",
    "Saqr Business Park",
    ["documents", "bed"],
  ],
  ["Faisal Noor", "EMP-0506", "Electrician", "RAK-05", "Ghalilah School Extension", ["documents"]],
  [
    "Girish Nair",
    "EMP-0507",
    "Mason",
    "RAK-01",
    "Jebel Approach Road, Package 2",
    ["bed", "transport", "ppe"],
  ],
  ["Hassan Javed", "EMP-0508", "Carpenter", "RAK-06", "Dhayah Warehouse Units", ["documents"]],
  ["Ismail Qadir", "EMP-0509", "Steel fixer", "RAK-03", "Coral Bay Residences, Block B", []],
];

function fresh(): Fake[] {
  return PEOPLE.map(([name, code, trade, project, projectName, done], n) => ({
    mob_no: `MOB-2026-${String(101 + n).padStart(4, "0")}`,
    worker_code: code,
    worker_name: name,
    trade,
    project_code: project,
    project_name: projectName,
    report_on: "2026-11-08",
    done: new Map(done.map((k) => [k, { by: "Noura Demo", at: "2026-11-04T09:00:00Z" }])),
    arrived_on: null,
  }));
}

export type MobilizationOptions = {
  /** The simulated date. The report day is 8 Nov, so a test sets this to confirm arrival. */
  today?: string;
  /** The signed-in person may tick tasks and confirm arrival (false for the MD/CEO). */
  canChange?: boolean;
  empty?: boolean;
  failList?: boolean;
  failDetail?: boolean;
  /** Refuse every tick with this message. */
  refuseTicks?: string;
};

const dueOf = (report: string, before: number) => {
  const d = new Date(`${report}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - before);
  return d.toISOString().slice(0, 10);
};

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
};

export async function mockMobilizations(page: Page, options: MobilizationOptions = {}) {
  const today = options.today ?? "2026-11-05";
  const canChange = options.canChange ?? true;
  const people = options.empty ? [] : fresh();
  const seen = {
    ticks: [] as { mob: string; task: string; action: string }[],
    arrivals: [] as string[],
    listReads: 0,
  };

  const stageOf = (p: Fake): Stage =>
    p.arrived_on
      ? "on_site"
      : p.done.size === 5
        ? "ready"
        : p.done.size > 0
          ? "in_progress"
          : "pending_checklist";

  const tasks = (p: Fake) =>
    TEMPLATE.map((t, i) => {
      const done = p.done.get(t.key);
      const due = dueOf(p.report_on, t.before);
      return {
        id: `00000000-0000-4000-8000-${p.mob_no.slice(-4)}0000${i}000`.slice(0, 36),
        department: t.department,
        department_name: t.name,
        title: t.title,
        due_on: due,
        status: done ? "done" : "open",
        overdue: !done && due < today,
        done_by: done?.by ?? null,
        done_at: done?.at ?? null,
      };
    });

  const row = (p: Fake) => {
    const t = tasks(p);
    return {
      mob_no: p.mob_no,
      stage: stageOf(p),
      status: p.arrived_on ? "completed" : p.done.size > 0 ? "in_progress" : "approved",
      worker_code: p.worker_code,
      worker_name: p.worker_name,
      trade: p.trade,
      project_code: p.project_code,
      project_name: p.project_name,
      report_on: p.report_on,
      tasks_done: p.done.size,
      tasks_total: 5,
      overdue: t.filter((x) => x.overdue).length,
      arrived_on: p.arrived_on,
    };
  };

  const detail = (p: Fake) => {
    const t = tasks(p);
    const open = t.filter((x) => x.status !== "done").length;
    let arrivalNote: string | null = null;
    if (!canChange) arrivalNote = "Only HR confirms arrival.";
    else if (p.arrived_on) arrivalNote = `${p.worker_name} arrived on ${day(p.arrived_on)}.`;
    else if (today < p.report_on)
      arrivalNote = `Reports on ${day(p.report_on)}. Arrival can be confirmed from that day.`;
    else if (open > 0)
      arrivalNote = `Finish the checklist first: ${open} ${open === 1 ? "task is" : "tasks are"} still open.`;
    return {
      ...row(p),
      tasks: t,
      can_update: canChange && !p.arrived_on,
      update_note: !canChange
        ? "Only HR ticks tasks off."
        : p.arrived_on
          ? "This person has arrived, so the checklist is closed."
          : null,
      can_confirm_arrival: canChange && !p.arrived_on && arrivalNote === null,
      arrival_note: arrivalNote,
    };
  };

  await page.route(/\/api\/mobilizations(\/|\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const parts = url.pathname
      .replace(/^\/api\/mobilizations\/?/, "")
      .split("/")
      .filter(Boolean);

    if (parts.length === 0) {
      seen.listReads += 1;
      if (options.failList) return json(route, { detail: "The pipeline is unavailable." }, 500);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const project = url.searchParams.get("project");
      const overdueOnly = url.searchParams.get("overdue") === "true";
      const items = people
        .map(row)
        .filter(
          (r) =>
            (!q ||
              `${r.mob_no} ${r.worker_name} ${r.worker_code} ${r.project_code} ${r.project_name}`
                .toLowerCase()
                .includes(q)) &&
            (!project || r.project_code === project) &&
            (!overdueOnly || r.overdue > 0),
        );
      return json(route, { today, items });
    }

    const person = people.find((p) => p.mob_no === parts[0]);
    if (!person) return json(route, { detail: "Mobilization not found" }, 404);

    if (parts.length === 1) {
      if (options.failDetail)
        return json(route, { detail: "The checklist could not be opened." }, 500);
      return json(route, detail(person));
    }

    if (parts[1] === "tasks" && method === "POST") {
      const index = tasks(person).findIndex((t) => t.id === parts[2]);
      if (index < 0) return json(route, { detail: "Task not found" }, 404);
      seen.ticks.push({ mob: person.mob_no, task: TEMPLATE[index].title, action: parts[3] });
      if (options.refuseTicks) return json(route, { detail: options.refuseTicks }, 409);
      if (parts[3] === "done")
        person.done.set(TEMPLATE[index].key, { by: "Noura Demo", at: "2026-11-05T10:00:00Z" });
      else person.done.delete(TEMPLATE[index].key);
      return json(route, detail(person));
    }

    if (parts[1] === "arrival" && method === "POST") {
      const d = detail(person);
      if (!d.can_confirm_arrival) return json(route, { detail: d.arrival_note }, 409);
      seen.arrivals.push(person.mob_no);
      person.arrived_on = today;
      return json(route, detail(person));
    }

    return json(route, { detail: "Not found" }, 404);
  });

  return { seen, people };
}
