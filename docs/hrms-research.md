# HRMS landscape research

Accessed 2026-11-06 by web search. Purpose: see what current HR and workforce products do well and
badly, so CONSTRUCTIQ can be better at the parts a construction contractor in the UAE cares about.

## How to read this (limits)
Every claim carries a tag:
- **[V]** from the vendor's own page, help centre or press release (marketing: not independently checked).
- **[R]** from a review site, aggregator, comparison or third-party article.
- **[U]** unverified, conflicting or missing evidence.

What this research is **not**:
- Nothing here was tested in a live demo or trial. Feature lists are what vendors and reviewers say.
- **Social media was not covered.** Reddit is blocked to the search tool; LinkedIn and X returned nothing usable.
  Please send links or screenshots of posts you have seen and they will be added.
- Pricing figures are indicative at best. Keka mobile details and Bayzat independent reviews were not found.
- `docs/product-reference.md` does not exist, so nothing was skipped as already covered. Visual references
  (Linear, Vercel, Stripe, Attio, shadcn) stay in `docs/design-direction.md` and are not repeated.

## Products kept and dropped
| Group | Kept | Why it matters |
|---|---|---|
| Enterprise suites | Workday, SAP SuccessFactors, Oracle Fusion HCM | Inbox, approvals and agent patterns a CEO already knows; also the cost and complexity to avoid |
| Mid-market | BambooHR, Rippling, Personio, Zoho People, Keka, Darwinbox; Deel (brief) | Everyday HR screens, workflows, onboarding |
| GCC and construction HR | Bayzat, TrueBays StackHX, Emirates Compliance, ZenHR (guides) | Visa, labour card and Emirates ID tracking, WPS, site attendance, accommodation and transport |
| Construction workforce planning | Procore Resource Planning (was Workforce Planning / LaborChart), Bridgit (competitor view), Oracle Primavera P6 and Unifier (adjacent) | Crew planning, credentials, demand against capacity |
| Generic resource planning | Float, Resource Guru, Runn | Heatmaps, tentative allocations, utilisation |
| Camp management (not GCC) | CampWare, iLogistics Accommodation Management | Bed and arrival tracking, adjacent only |
| **Dropped** | "Eddy" (no such HR product found); ExpirySafe, DocuTrack HR and Odoo modules (generic, no independent reviews); Gusto (US payroll-led) | Not relevant or not verifiable |

## Product by product
Format: UI pattern, workflows, automation and AI, then what it does poorly for construction labour.

### Enterprise suites
**Workday**
- UI: home page of worklets, configurable by role; **Inbox split into Actions and Archive (about 30 days)**; a Workday Assistant chatbot opens from the home screen and suggests actions. [R: [Louisville guide](https://service.louisville.edu/TDClient/277/Portal/KB/Article/20808/Using-Your-Workday-Inbox), [Geisinger guide](https://workdaytraining.geisinger.org/PDFContent/J165_WorkdayInbox.pdf), [Wellesley guide](https://www.wellesley.edu/workday/navigating)]
- Automation and AI: approvals route to managers through the inbox; autonomous agents for HR, IT and travel reported in May 2026. [R: [Pulse](https://www.pulse.bot/hrtech/news/workday-debuts-three-autonomous-ai-agents-for-hr-it-and-travel-c2a1750b-b408-4987-a0f6-622121cfe82d/)]
- Poorly: complex setup and admin-dependent; one source says 12 to 18 months for mid-enterprise rollouts at roughly the first year's licence again. [R, indicative: [OutSail](https://www.outsail.co/post/workday-vs-oracle-hcm-vs-sap-successfactors)] Nothing found on visas, camps or crews. [U]

**SAP SuccessFactors**
- AI and workflow: the 1H 2026 release adds agents to core HR and payroll and a **Pending Workflow Agent** that shows live workflow status and surfaces approvals; Joule Studio builds custom agents. [R: [Pulse](https://www.pulse.bot/hrtech/news/first-half-2026-release-whats-new-in-sap-successfactors-hcm-30f3d1a8-3cee-4540-a3ef-677742bfca75/), [Pulse](https://www.pulse.bot/hrtech/news/sap-adds-agentic-ai-to-successfactors-in-1h-2026-release-9647c39e-54ae-43ad-96b9-11892a751ab6/)]
- Poorly: ease of use and implementation are top complaints; each module costs extra. [R: [Capterra](https://www.capterra.com/p/144575/SuccessFactors-Perform-and-Reward/reviews/?rating=1), [OutSail](https://www.outsail.co/post/workday-vs-oracle-hcm-vs-sap-successfactors)]

**Oracle Fusion Cloud HCM**
- AI: HCM-native agents announced Feb 2025 (for example help with time-off requests). [R: [HR Brew](https://www.hr-brew.com/stories/2025/02/07/oracle-releases-new-agentic-ai-features-for-hr)]
- Poorly: deeply configurable, needs skilled implementers; enterprise pricing for mid-market buyers. [R: [OutSail](https://www.outsail.co/post/workday-vs-oracle-hcm-vs-sap-successfactors)]

### Mid-market
**BambooHR**
- UI: home shows vacation, inbox and who is out; **employee profile in tabs that can be reordered, with tabs and fields hidden by access level**; mobile inbox approves or denies requests, a People tab finds colleagues, the job tab is read-only on mobile. [V: [Home](https://bamboohr.screenstepslive.com/m/53917/l/587797-bamboohr-home), [Profile](https://bamboohr.screenstepslive.com/m/53907/l/587295-the-employee-profile), [Mobile](https://bamboohr.screenstepslive.com/m/53916/l/1152030-employee-information-in-the-mobile-app)]
- Workflows: self-service onboarding with pre-start paperwork. [R: [G2 comparison](https://www.g2.com/compare/bamboohr-vs-deel-hr-vs-rippling)]
- AI: weakest of the group on generative features. [R: same G2 page]
- Poorly: not built for field labour, visa dates or site assignment. [U, no source says otherwise]

**Rippling**
- Workflows: **Workflow Studio** with real-time and scheduled triggers, multi-step conditional logic and approvals; custom triggers from employee data; conditions on scheduled runs added October 2025. [V: [Jan 2025](https://www.rippling.com/blog/january-2025-product-updates), [Oct 2025](https://www.rippling.com/blog/october-2025-product-updates), [Workflows](https://www.rippling.com/platform/workflows)]
- AI: natural-language queries across HR, IT and finance, with actions. [R: [Sacra](https://sacra.com/chat/h/4b80d121-47f8-4d51-8724-7a2dfda50edd/)]
- Offboarding: one flow can cut app, payroll and device access. [R: [Engagedly](https://engagedly.com/blog/bamboohr-vs-rippling/)]
- Poorly: US-centric, no visa, camp or GCC compliance. [R]

**Personio**
- Documents and workflows: **employee file and documents hub** with templates, custom categories, e-signatures and role-based reminders; onboarding and offboarding checklists and workflows, some only on the higher plan. [V: [Support](https://support.personio.de/hc/en-us/articles/115003849569-Implement-onboarding-and-offboarding-workflows), [Plan](https://personio.com/core-pro-plan)]
- Poorly: European focus; useful features gated by plan. [V/R]

**Zoho People**
- Attendance: IP and geofence restriction, optional GPS tracking, mobile regularization and permission approvals. [V: [Help guide](https://help.zoho.com/portal/en/kb/people/mobile/mobile-app-guide/articles/zoho-people-mobile-application-help-guide), [Attendance](https://www.zoho.com/people/attendance-management-system.html)]
- Poorly: reviewers cite reporting limits and mobile app gaps. [R: [Capterra](https://www.capterra.com/p/110931/Zoho-People/reviews)]

**Keka**
- Documents and onboarding: document workflows from templates, acknowledgement of org documents, onboarding automation, e-sign in the higher tier; geofenced clock-in; configurable approvals. [V: [Admin help](https://help.keka.com/admin/core-hr), [Pricing](https://www.keka.com/ph/pricing)]
- Poorly: G2 cons list limited customization (156 reviews) and poor support (145). [R: [G2](https://www.g2.com/compare/keka-vs-zoho-people)] Mobile specifics not found. [U]

**Darwinbox**
- AI: 30+ HR agents, a Super Agent as one interface, and an **MCP server** that exposes HR functions (leave, lookups, requisitions) to AI agents. [V: [HR Dive release](https://www.hrdive.com/press-release/20250915-darwinbox-launches-super-agent-an-ai-teammate-for-every-employee-that-gets-1/), [People Matters](https://www.peoplematters.in/news/hr-technology/darwinbox-becomes-first-hr-tech-platform-to-launch-its-own-mcp-server-for-ai-integration-45528)]
- Workflows: Studio low-code integrations with 300+ connectors; **custom approval chains with automatic escalation when an SLA is missed**; geofence, geotag and face-recognition attendance. [V: [Darwinbox](https://darwinbox.com/blog/track-better-act-smarter-with-our-leave-and-attendance-module), [diginomica](https://diginomica.com/evolution-action-darwinbox-rapidly-develops-agentic-ai-mass)]
- Poorly: enterprise scope; no construction-specific features seen. [U]

**Deel** (brief): global contracts and employer-of-record onboarding, compliance chatbot; onboarding described as "functional, not delightful". [R: [EOR guide](https://eorhq.com/guides/best-onboarding-software-global/)] Little relevance to a single-country contractor.

### GCC and construction HR
**Bayzat**
- Visa, Emirates ID and Iqama expiry tracking with alerts; OCR for visa and passport copies; WPS and SIF payroll files; gratuity, attendance, leave; claims 4,000+ companies. [R: [Capterra](https://www.capterra.ae/software/166098/Bayzat), [Bayzat page](https://get.bayzat.com/best-hr-software-uae/)]
- Poorly: general-purpose HR; no manpower planning, mobilization or camp found. [U] Independent review data is thin. [R: [G2 compare](https://www.g2.com/compare/bamboohr-vs-bayzat-bayzat)]

**TrueBays StackHX**
- UAE construction HR: **alerts 60 days before** passport, visa, Emirates ID or labour card expiry (sent to HR); geofenced attendance; face-recognition devices at sites (a McLaren Group deployment of 4,000+ staff); **per-worker accommodation, bus route and allowances**; payroll file. [V: [Construction page](https://www.truebays.com/hr-software-for-construction-companies-dubai/), [McLaren case study](https://www.truebays.com/mclaren-case-study/)]
- Poorly: alerts go to HR only and name a date, not the project it hurts; no forward manpower gap shown; no independent reviews or pricing found. [U]

**Emirates Compliance (Blackcat Group)**
- Visa, labour card, Emirates ID and passport tracking, **expiry alerts by email and WhatsApp**, OCR onboarding, WPS file, audit reports; press release dated 21 July 2026. [V: [CustomerThink](https://customerthink.com/?p=1082454), [vendor site](https://sites.google.com/view/emiratescompliance)]
- **Unverified:** no independent reviews, ratings or demo evidence; WhatsApp and AI claims are marketing. [U: [SaaSworthy](https://www.saasworthy.com/product/emirates-compliance), [SourceForge](https://sourceforge.net/software/product/Emirates-Compliance/)]

**ZenHR guides**: list visa tracking, work-permit renewal, WPS and end-of-service as the basics of Gulf HR. [V: [Construction guide](https://blog.zenhr.com/en/construction-workforce-management-software-complete-guide-for-gcc-businesses), [Expat guide](https://blog.zenhr.com/en/best-hr-software-for-managing-expat-employees-in-the-gcc-2026-guide)]

### Construction workforce planning
**Procore Resource Planning** (renamed from Workforce Planning in January 2025)
- UI and scope: people, planning and scheduling, forecasting, analytics, communication; Gantt view in beta. [V: [Release notes](https://support.procore.com/products/online/user-guide/company-level/resource-planning/release-notes), [Product page](https://procore.com/resource-planning)]
- Automation: scheduled people flow into timesheets (March 2025); an Insight compares **required credentials against assigned workers and flags lapsed certifications (May 2026)**; another shows **planned labour hours against confirmed crew capacity by week (August 2026)**. [V: [What's new](https://www.procore.com/whats-new), [Release notes](https://support.procore.com/products/online/user-guide/company-level/resource-planning/release-notes)]
- Poorly: credentials are US-style (OSHA, NCCCO), not visas; no camp, transport or GCC rules found. Competitor Bridgit says long-term forecasting is weak while Procore claims it as core, so that point is **[U]**. [R: [Bridgit comparison](https://gobridgit.com/bridgit-vs-procore/)]

**Oracle Primavera P6 and Unifier** (adjacent): manpower is usually **resource-loaded in P6** with actuals from daily site reports; Unifier is cost, cash-flow and controls. **Craft-labour forecasting in Unifier could not be confirmed.** [R: [ScheduleReader](https://www.schedulereader.com/5-reasons-to-use-oracle-primavera-p6-software-for-construction-projects/), [Oracle](https://www.oracle.com/uk/construction-engineering/unifier-project-controls-asset-management/)] [U]

### Generic resource planning
**Float, Resource Guru, Runn**: schedule view, utilisation as scheduled against available hours, tentative allocations, filterable heatmap calendars, multi-month forecasts. [V/R: [Float help](https://support.float.com/en/articles/13847946-capacity-planning-and-resource-scheduling), [Digital PM comparison](https://thedigitalprojectmanager.com/es/tools/float-vs-runn-2/)]
Poorly: no skill level, visa or trade rules; no construction-specific features found. [R]

### Camp management (adjacent)
**CampWare** and **iLogistics Accommodation Management** track beds, arrivals and departures for mining, energy and oil and gas camps. [R: [CampWare](https://softwarefinder.com/facility-management-software/campware), [iLogistics](https://platform.softwareone.com/product/ilogistics-accommodation-management/PCP-7864-3142)]
**No product was found that combines camp beds, bus transport and GCC visa tracking.** [R: search results, not proof of absence]

## Patterns worth copying
1. **Role-aware Home with an inbox** (BambooHR, Workday). We have Home and To-do. Add a "Cleared" view, like Workday's Archive.
2. **Profile in tabs with field masking by role** (BambooHR). Done on Workers.
3. **Trigger, condition, action with SLA escalation** (Rippling, Darwinbox). Our detectors plus n8n escalation do this. Keep the rules in code, not user-built.
4. **Required against held credentials** (Procore). Same idea as our "documents valid through the end of cover".
5. **Tentative allocations** (Float). Our "Held for this project".
6. **Checklist templates for onboarding and offboarding** (Personio, Keka). Later, not MVP.
7. **Agents inside the same roles and approvals as staff** (Darwinbox MCP; governance framing in [Darwinbox's own agent comparison](https://darwinbox.com/blog/10-best-ai-agent-platforms-hr-teams), vendor-written [V]). Matches our "agents act only through permission-checked tools".

## Contracts, exits, transfers and overseas recruitment (added after reading the client's trackers)
How the client works today: two Excel trackers, one row per position, dropdown lists that map statuses and trades to
groups, and a formula dashboard. See `docs/import-formats.md` for the structure (no data). The research below is
what other tools do and what UAE rules say, tagged as in the rest of this file.

**Contract end dates and alerts**
- Remote emails the account owner and admins 60 and 45 days before a fixed-term contract ends, and offers renew,
  terminate or convert; EazeHR alerts HR with a lead time set in settings and exports lapsed contracts; Viindoo shows
  a contract red within 7 days and can set it to expired on the end date; Cobblestone alerts by a "Notify Days"
  value; Workday only shows the date in reports. [V: [Remote](https://support.remote.com/hc/en-us/articles/4425007485581-How-will-I-know-when-an-employee-s-fixed-term-contract-is-coming-to-an-end), [EazeHR](https://help.eazework.com/portal/en/kb/articles/managing-contract-dates), [Viindoo](https://viindoo.com/documentation/17.0/applications/human-resources/employee/register-departure/contract-expiry.html), [Cobblestone](https://wiki.cobblestonesoftware.com/docs/contracts-record-alerts), [Workday](https://doc.workday.com/admin-guide/en-us/human-capital-management/staffing/contracts-and-agreements/employee-contracts/dan1370797336154.html)]
- What none of them do: say **which project** is hurt. CONSTRUCTIQ words it "Contract ends 20 Jan 2027, before the job on
  RAK-01 ends" and keeps the person out of a forecast they cannot cover.

**Internal transfers**
- Good tools store a future-dated pending record that becomes current on the effective date, ask both the sending and
  receiving side to approve, and keep a history. [V: [Sage](https://www.cleverence.com/amp/articles/sage-documentation/setting-up-future-dating-for-team-member-transfers-4827/), [Kissflow](https://kissflow.com/appstore/internal-job-transfer-management-system), [Emgage](https://docs.emgage.work/docs/transfer/single-transfer)]
- The client's sheets use two rows with one worker ID ("Transfer Out - Planned" / "Transfer In - Planned"). We keep one
  planned assignment linked to the one it depends on, so nobody is counted twice.

**UAE rules to design around** (secondary sources; confirm on u.ae and MOHRE before relying on a figure)
- The 2021 labour law (in force 2 Feb 2022) moved private-sector workers to fixed-term contracts. Guides disagree on a
  3-year cap and a 2022 directive reportedly lifted it, so no cap is hard-coded. Work continuing after expiry without a
  renewal is treated as renewed on the same terms. [R: [u.ae](https://u.ae/en/information-and-services/jobs/employment-in-the-private-sector/job-offers-and-work-permits-and-contracts/employment-contracts-duration-and-models-in-the-private-sector), [The National](https://www.thenationalnews.com/uae/government/2022/10/07/uae-lifts-three-year-cap-on-private-sector-employment-contracts), [Ogletree](https://ogletree.com/insights/the-new-uae-labor-law-implications-for-employers)]
- Absconding: an open absence complaint with MOHRE can stop a new work permit and a one-year ban may follow; withdrawal is
  reviewed, not automatic (the Wego guide cites about 14 working days). We record the status and keep the person out of
  planning; filing and withdrawing stay with HR. [R: [MOHRE](https://www.mohre.gov.ae/en/our-services/cancellation-of-an-absence-from-work-complaint-absconding-report-2022.aspx), [Emirates247](https://www.emirates247.com/uae-guide/uae-absconding-reports-explained-when-they-can-be-filed-and-how-to-contest-one/4715), [Wego](https://blog.wego.com/cancel-absconding-report-uae/)]
- Hiring from abroad: MOHRE quota, offer letter, then an entry permit valid about two months; sources give 4 to 8 weeks
  end to end, but those are commercial estimates. This is why overseas recruitment gets a longer default lead time
  (60 days) than local (30), both configurable and **to be confirmed with HR**. [R: [Gulf News](https://gulfnews.com/uae/government/uae-ministry-outlines-simple-steps-to-secure-work-permits-for-workers-from-outside-the-country-1.500096345), [Khaleej Times](https://www.khaleejtimes.com/apply-work-permit-overseas-workers)]

**Construction manpower tools:** MSite (requisitions with approvals and skill checks), Bridgit Bench (forecasting and
pipeline planning) and Lumberfi (union dispatch) cover requests and scheduling; none found tracks visa-processing or
arrival stages, or checks that a transfer's source job finishes in time. [R/U: [MSite](https://www.msite.com/software/labour-requisitioning), [Bridgit Bench](https://softwareconnect.com/construction-management/bridgit-software), [Lumberfi](https://www.lumberfi.com/neca-labor-central)]
## What others do poorly (the opening)
- Expiry alerts go to HR and name a date, not **which project and which request is hurt**. [V: TrueBays; R: Bayzat]
- Forward manpower gaps measure hours against crew. None found that also checks **document validity and transfer dependencies**. [V/R: Procore, Float]
- Nothing found ties **bed, bus and site pass to the same worker record and the same approval**. [R]
- Enterprise suites are expensive, slow to roll out and admin-heavy. Mid-market tools have good screens and weak Gulf compliance. [R]
- AI: large agent catalogues, but no evidence of "numbers come from code, the model only explains". [U]
- **Fines (for the CEO, not to be quoted yet):** sources conflict. Gulf News reports Dh200 a month capped at Dh2,000 per work permit, Fragomen describes AED 200 per employee for renewals held back beyond 60 days, and a vendor guide cites Cabinet Resolution 21 of 2020. [R/U: [Gulf News](https://gulfnews.com/living-in-uae/ask-us/uae-labour-law-work-permit-not-renewed-the-company-faces-a-fine-of-dh200-per-month-1.1650033160744), [Fragomen](https://www.fragomen.com/insights/how-the-new-work-permit-rules-impact-uae-employers.html), [CIPD](https://www.cipd.org/en/about/news/uae-work-permit-law/)] **Check the amounts on the MOHRE site before putting any number in front of the CEO.**

## What CONSTRUCTIQ should do differently and better
Ranked by impact on the CEO.

1. **Turn every expiring document into a named project risk and one action.** "2 of the 8 steel fixers for RAK-03 have visas that end before the job", with who, which request, and a one-click message to the worker. Competitors alert HR about dates.
2. **Show the forward gap by trade and date, including documents and transfer dependencies.** Numbers come from code; AI only explains ("4 masons short on 12 Feb"). No product found combines these.
3. **One approval owner, a consequence preview and a full audit trail.** HR decides, the CEO sees the result and who did what. Enterprise suites spread approvals across inboxes.
4. **Compliance built into allocation.** Hard rules (visa valid through cover, no double booking, skill level) stop a bad assignment before approval. Generic planners cannot.
5. **A CEO page that answers "are we exposed?"** Exposure (documents), gap (manpower) and waiting (approvals) on one screen, each linked to its fix.
6. **Auditable AI.** Models never compute numbers, restricted fields are redacted before any model call, agents only draft. A selling point against agent sprawl.
7. **Easy for non-technical HR on day one.** Plain words, three-click tasks, tested with real HR staff. Enterprise suites fail on ease and cost; mid-market tools fail on Gulf compliance.
8. **Be honest about the edges.** Payroll and WPS, leave and attendance already exist in Bayzat and TrueBays. Plan to export to or integrate with them, not rebuild them in the MVP. Show camp and transport as status on the mobilization, not as a camp-management product.
