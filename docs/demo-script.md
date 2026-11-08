# HAMRA AI: what to show Mr Imtiyaz (HR) and Mr Sanjay (MD/CEO)

Demo date is simulated as **5 Nov 2026** (the data lines up with it). Sign in with the role switcher on the login page.
Marked **[built]** works today; **[next]** is on the plan and should not be demoed yet.

## The one-line pitch
HAMRA AI is the workforce control room for Alhamra: it knows every worker, document, project and request, warns before
something goes wrong, recommends who to deploy, and answers questions in plain words. Numbers always come from the
system's rules, never from the AI; the AI explains and recommends, a person approves.

## Five minutes with Mr Imtiyaz (HR Manager)
1. **Home [built]**: Action Center. "Two things critical, sixteen need action." Click the first: a visa that ended 3 days ago,
   with the project it hurts. Every alert is raised by rules, worded by AI, and checked against the facts.
2. **Workers [built]**: search "steel fixer", open a profile: documents, assignments, risks. The eye icon shows a document
   number to people allowed to see it, and logs who looked.
3. **Projects, then the forecast for RAK-07 (the new project) [built]**: needed vs who can join, who finishes another project in
   time, who could join late, who to recruit and by when. Press **Explain**: a plain-words summary, labelled as AI, kept only if
   every number matches.
4. **Allocation [built]**: open a request, press **Ask Workforce agent**. Watch its steps, then its recommended people with a
   reason each, and the ones the rules dropped (and why). "Use these" chooses them; a second person approves; mobilization starts.
5. **Virtual HR (Ctrl+K) [built]**: ask "any free steel fixers?", "which documents expire in 30 days?", "can we staff RAK-07
   next month?". Ask "what is Anil Kumar's salary?" to show it refuses (no salary data, no phone or passport numbers in chat).
6. **To-do [built]**: take an alert, snooze one, dismiss one with a reason.
7. **[next]** Worker profile editing, project overview pages, the calendar of leaves, Excel exports, the "Tell the worker"
   message, and the Excel import.

## Five minutes with Mr Sanjay (MD / CEO)
1. **Home [built]**: the executive view: people short, projects at risk, documents, what HR is waiting on. Read-only by design.
2. **To-do [built]**: the same alerts, no buttons that change anything.
3. **Virtual HR (Ctrl+K) [built]**: "what needs attention?", "how are the projects staffed?", "can we staff RAK-07?".
4. **[next]** A simpler CEO Home with project progress, an HR-department monitor, a weekly briefing written by the AI from
   the numbers, and an executive assistant that answers "how is RAK-03 doing?" and "what is HR waiting on?".

## What is real and what is simulated
- Real: the rules, the forecast, alerts, allocation, approvals, audit log, permissions, the chat and agents (with a model key).
- Simulated for the demo: the date (5 Nov 2026), the people and documents (fictional), email and WhatsApp sending until an
  email account and a Meta-approved WhatsApp template are connected.

## What we can automate next (to tell the MD)
- **Chasing**: renewal reminders for visas, labour cards, medical and safety certificates to the worker (HR presses one
  button) and to HR as a daily digest; escalation to the HR Manager and Operations if nobody acts.
- **Planning**: when a project ends or starts, the system proposes who moves where and what to recruit and when
  (MOHRE quota, offer, entry permit, medical, residency), with owners and due dates.
- **Readiness**: days before a mobilization, check people, documents, bed, transport and induction, and tell the right
  department.
- **Reporting**: a weekly manpower brief and a monthly board pack, generated from the numbers; Excel in and out for payroll,
  attendance and recruitment agencies.
- **Compliance**: midday-ban site schedules, absconder and long-leave detection, expiring safety certificates.
- **Self-service**: workers confirm arrival and upload renewed documents on WhatsApp; HR only reviews.
- **Later**: payroll, leave and attendance in the same place, a mobile app for site supervisors.

## Questions the MD will probably ask
- *Can the AI approve or change anything?* No. It reads and recommends. Every change is a button a permitted person presses,
  and it is logged.
- *What if the AI is wrong or the model is down?* Numbers never come from it; its sentence is dropped if it states a fact the
  system did not give it; the plain questions still answer without a model.
- *Where does our data go?* Phone and document numbers never leave the system. For real data we use a paid provider that
  does not train on prompts; free models are for the fictional demo only.
