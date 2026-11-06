# Import formats: the client's two trackers (structure only)

Source files (kept out of the repository, in `private-data/`): the **Project Labour Tracker** and the **Project Staff
Tracker**. They are the formats the Phase 5 Excel import must read. This file records only **structure**: sheets,
columns, status words and what they mean. No names, IDs, phone numbers, projects or counts of real people appear here.

## Sheets
| Sheet | Labour tracker | Staff tracker | Use |
|---|---|---|---|
| `How_To_Use` | hidden | hidden | The client's own instructions |
| `Management_Dashboard`, `Project_Dashboard`, `Summary_All_Projects` | yes | yes | Formula output: ignore on import |
| `Projects` | yes | yes | One row per project or cost centre (Camp, Store and similar included); has a site code used by the punch machine |
| `Labour_Master` / `Staff_Master` | yes | yes | **The data to import**: one row per position |
| `Lists` | yes | yes | Dropdown lists: statuses to groups, trades to trade groups, categories, project statuses |
| `MEP` | | yes | A side list |

## Master sheet columns (header on row 4)
| Column | Meaning | Maps to |
|---|---|---|
| Labour ID / Staff ID | Worker number; blank for open positions | `employees.employee_code` |
| Labour Name / Employee Name | `TBA` for a future position | `employees.full_name`; TBA means a recruitment request, not an employee |
| Project Name | Where the position is | `projects` |
| Trade (labour) / Designation and Discipline-Dept (staff) | What they do | `trades` (the Lists sheet maps each trade to a trade group) |
| Category | Labour, Subcontractor Labour, Manpower Supply (staff: Staff) | to be decided with HR |
| Employment | Existing, New role, Replacement | new position or replacement (`replaces_employee_id`) |
| Labour Status / Employment Status | See below | `employment_status`, `availability`, recruitment stage |
| Recruitment Local / Overseas (labour) | How the person is hired | `recruitment_requests.source` |
| Date of Joining | First day | `employees.joined_on`, or the planned arrival |
| **Exit Date / Required By** | **One column, two meanings**: the exit date for a leaver, the required-by date for a future position | `employees.exit_on`, or `recruitment_requests.needed_by` |
| Replaced By / For, Transfer From / To | Free text or a date | `replaces_employee_id`, or a planned transfer |
| Remarks / Joining Date (staff) | Free text or a date | notes, or the planned arrival |
| Group, Key, Include, Seq, Match, MoveSeq, MoveFlag, TradeSeq ... | Helper columns for the formulas | ignore |

## Status words and the group the client maps them to
- **Current (CUR):** Active, On Vacation / Leave.
- **Exit (EXIT):** Resigned, Terminated, Absconded, Transferred Out. The row stays; the exit date and replacement are filled in.
- **Transfer (TRF):** Transfer Out - Planned, Transfer In - Planned, Transferred Out, Transferred In. Same worker ID on two rows.
- **Future pipeline (FUT / TIP):** Future Requirement, Under Recruitment, Visa Processing, Arrived - Pending Deployment,
  On Hold. Staff also: Interview Stage, Offer Issued, OP under process.
- **Project statuses:** Pre-Construction, Under Construction, Handover, Completed, On Hold, Ongoing-Overhead.

## How the import should treat it (Phase 5)
1. Read the header row, not fixed column letters; the client adds helper columns.
2. Skip rows where the name is `TBA` and the status is a future one: they become recruitment requests (one per project,
   trade and stage, with the required-by date), not employees.
3. Map statuses as above. Anything unknown is reported row by row, never guessed.
4. Report bad rows with the sheet, row number and reason; import nothing silently.
5. Never write the source file into the repository; the import reads an upload.
