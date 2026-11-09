# HR test kit

Purpose: find out where real HR staff hesitate or misunderstand, and fix it before the CEO review.
Run 3 to 5 sessions, 20 to 30 minutes each, one person at a time, on the prototype
(`prototype/index.html`, open it in Chrome or Edge, no install). Sign in as **HR Manager** from the
demo role switcher. Fictional data only.

## Before each session
- Open the prototype fresh (refresh resets everything).
- Light theme, 1440px wide or a laptop screen. Have a second device ready if you also want to try a phone.
- Tell them: "We are testing the software, not you. Say what you are thinking out loud. I will not help
  unless you are completely stuck for a minute."
- Ask first, before they touch anything: "What software and tools do you use today for workers, visas
  and sending people to projects?" and "What do you call it when you send workers to a project?"
  (This decides the word for Requests / Mobilization. Their word wins.)

## The five tasks (read each one aloud; do not name screens or buttons)
1. **Start of the day.** "You just arrived. What needs your attention today? Deal with the most urgent
   thing." *(Expect: To-do on Home, opens the item, uses a suggested action or "I'll handle this".)*
2. **Fill a request.** "The project manager for the Aila Homes asked for 4 electricians and
   2 plumbers from 1 December. Get this sorted." *(Requests, Suggest workers, review, approve. Watch the
   confirm box.)*
3. **Look ahead.** "Will any trade be short when the new Shamal project starts in February? What would you do?"
   *(Forecast, Mason shortage, Hold people or Ask recruitment to hire.)*
4. **Documents.** "Whose visa or documents are running out soon? Find Sanjeev Rana and note his phone number."
   *(Documents tab, profile, copy phone.)*
5. **Find a person.** "Is there a steel fixer free right now with a visa valid until next summer?"
   *(Workers, filter Available, profile Documents.)*

Not tested this round: Excel import (not in the prototype), WhatsApp or email notices, payroll, leave.
Tell testers these are not built if they ask.

## What to write down (one row per observation)
Sheet columns: **Tester · Task · What happened · Screen · Severity (1 small, 2 slowed them, 3 stuck or wrong)**.
Watch for:
- Hesitation longer than 10 seconds before a click.
- Words they ask about ("what is mobilization?", "what does Held mean?").
- Thinking something failed when it worked (a to-do that stays until the problem is fixed).
- Reaching for Excel, WhatsApp or the old system ("how do I export this?").
- Looking for a button that is not there (a "Done" tick on to-dos, a global search, print).
- Anything they say they like.

## After the task
Ask: "On a scale of 1 to 5, how easy was that?" and "What would you change first?"
At the end: "Could you use this every day instead of what you use now? What is missing?"

## Pass bar
- At least 4 of 5 testers finish tasks 1, 2 and 4 without help.
- Any word two testers misunderstand is changed in the vocabulary (`docs/design-direction.md` → Wording).
- Report to the CEO with quotes and counts ("3 of 4 looked for a Done button"), not percentages.

## After the sessions
Fix severity 3 first, then everything two or more testers hit. Keep a list of "what HR asked for that we
did not build" for the CEO summary (payroll, leave, attendance, import, WhatsApp notices).
