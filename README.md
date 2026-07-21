# Portfolio Pulse

Tracks portfolio-company metrics (ARR, customers, churn, etc.) pulled from founder update
emails, extracted by Claude, and written to a Google Sheet.

The system runs entirely as a Google Apps Script project bound to that Sheet — no local
install, no Python, no credential files on any one person's machine. See
[`appscript/SETUP.md`](appscript/SETUP.md) for the full setup, architecture, and menu reference.

## History

This was originally a local Python pipeline (venv, OAuth credential files, manual/cron runs).
It was fully retired in favor of the Apps Script version once that version was verified running
correctly against the same Sheet. The Python source is no longer in this repo — check `git log`
on this file's history if you ever need to reference the old implementation.

## Possible future work

`GMAIL_LOOKUP_SKILL_SPEC.md` in the repo root is a design spec (not built) for a smaller,
on-demand companion tool — answering ad hoc questions like "show me updates from Carpool for
the last 4 months" directly in chat, without the scheduling or persistent-Sheet parts of this
pipeline. Not started; read that file before building it.
