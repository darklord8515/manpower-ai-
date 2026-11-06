/** What the API sends. Mirrors apps/api/app/schemas.py; keep the two in step. */

export type Me = {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
  permissions: string[];
  demo_mode: boolean;
  /** Which Home to show. */
  landing: "hr" | "executive" | string;
};

export type PublicConfig = { demo_mode: boolean };

export type ExpiryCounts = { expired: number; d30: number; d60: number; d90: number };

export type ProjectRow = {
  code: string;
  name: string;
  status: string;
  starts: string | null;
  ends: string | null;
  planned: number;
  deployed: number;
};

export type Summary = {
  today: string;
  workforce: {
    total: number;
    deployed: number;
    mobilizing: number;
    available: number;
    unavailable: number;
  };
  documents: ExpiryCounts;
  expiry_by_week: { week_start: string; count: number }[];
  short_total: number;
  projects: ProjectRow[];
};

export type ExpiringDocument = {
  worker_code: string;
  worker_name: string;
  trade: string;
  project: string | null;
  phone: string | null;
  type: string;
  expiry: string;
  days_left: number;
};

export type ExpiringList = { counts: ExpiryCounts; items: ExpiringDocument[] };

export type DemoRole = "hr_manager" | "hr_executive" | "ceo";
