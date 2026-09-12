# BodyComp Tracker

A simple, local web app for tracking weekly body composition and health metrics:
weight, sleep (duration, score, deep sleep), macros, calories vs. goal, and steps.

Everything is stored in a local SQLite database file (`bodycomp.db`) on your own
computer — no login, no account, no cloud service.

## First-time setup

Open Terminal in this folder and run:

```
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

## Running it

```
./venv/bin/python app.py
```

Then open **http://127.0.0.1:5050** in your browser. Leave the Terminal window
open while you use the app; close it (Ctrl+C) when you're done.

## Using it

- **Log an entry** — fill in whatever metrics you have for a date and click
  _Save entry_. Leave anything blank you don't have; it just won't show up
  on that day's charts.
- **Editing** — click _Edit_ on a row in the History table to load it back
  into the form, change values, and save again.
- **Import a CSV** — use _Download CSV template_ to get the expected column
  layout, fill it in (or export from whatever app you're currently using),
  then _Upload CSV_. Rows are matched by date, so importing the same file
  twice just updates existing entries instead of duplicating them.
- **Export** — _Export all data as CSV_ downloads everything currently in
  the database, e.g. for a backup.

## Your data

All data lives in `bodycomp.db` in this folder. It's excluded from git via
`.gitignore`, so it stays local to your machine. Back it up by copying that
file, or by using _Export all data as CSV_.
