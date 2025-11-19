# Offline Project & Task Worklog

A single-page HTML application for tracking projects, tasks, timers, and worklogs completely offline.

## Structure

```
index.html              # Application shell
assets/css/styles.css   # Visual design tokens and layout
assets/js/app.js        # Timer logic, data binding, export helpers
data/*.json             # Settings, configuration, prompts, mock API data
```

## Features

- Differentiate between projects (manual reference numbers) and tasks (auto 3-digit IDs)
- Mark work as critical/normal and filter the dashboard
- Start/stop timers with enforced progress logs before time is saved
- Export per-task logs to Excel-ready CSV files
- Persist everything locally via `localStorage` to stay offline

## Usage

Open `index.html` directly in your browser. No build tools, servers, or dependencies are required.

## Development

To preview with live reload or capture screenshots from this environment:

```
python -m http.server 8000
```

Then browse to `http://localhost:8000`.
