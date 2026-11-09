const COLUMNS = [
  "weight",
  "sleep_hours",
  "sleep_score",
  "deep_sleep_minutes",
  "protein_g",
  "fat_g",
  "carbs_g",
  "calories_intake",
  "calories_goal",
  "steps",
];

// Column order for CSV import and export.
const CSV_COLUMNS = ["date", ...COLUMNS];

// Accepts a range of human-friendly header spellings when importing a CSV.
const HEADER_ALIASES = {
  date: "date",
  weight: "weight",
  weight_lbs: "weight",
  sleep: "sleep_hours",
  sleep_hours: "sleep_hours",
  sleep_hrs: "sleep_hours",
  sleep_score: "sleep_score",
  deep_sleep: "deep_sleep_minutes",
  deep_sleep_minutes: "deep_sleep_minutes",
  deep_sleep_min: "deep_sleep_minutes",
  protein: "protein_g",
  protein_g: "protein_g",
  fat: "fat_g",
  fats: "fat_g",
  fat_g: "fat_g",
  carbs: "carbs_g",
  carbs_g: "carbs_g",
  carbohydrates: "carbs_g",
  calories_intake: "calories_intake",
  calorie_intake: "calories_intake",
  calories: "calories_intake",
  daily_calories: "calories_intake",
  calories_goal: "calories_goal",
  calorie_goal: "calories_goal",
  calorie_target: "calories_goal",
  goal_calories: "calories_goal",
  steps: "steps",
  daily_steps: "steps",
};

const STORAGE_KEY = "bodycomp.entries.v1";

let entries = []; // sorted ascending by date
let editingId = null;
let editingDate = null;
const charts = {};

const $ = (id) => document.getElementById(id);

/* ---------------- Storage ---------------- */

function readEntries() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function writeEntries(list) {
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// Reads, changes and saves the entries as one step. If stored data can't be
// read, nothing is written, so a storage problem can't overwrite existing data.
function updateEntries(change) {
  try {
    const list = readEntries();
    change(list);
    writeEntries(list);
    $("storage-error").hidden = true;
    return true;
  } catch (err) {
    console.error("Could not save entries:", err);
    $("storage-error").hidden = false;
    return false;
  }
}

// Inserts a new entry, or replaces the values of the entry with the same date.
function upsert(list, date, values) {
  const existing = list.find((e) => e.date === date);
  if (existing) {
    Object.assign(existing, values);
    return false;
  }
  const id = list.reduce((max, e) => Math.max(max, e.id), 0) + 1;
  list.push({ id, date, ...values });
  return true;
}

function removeById(list, id) {
  const index = list.findIndex((e) => e.id === id);
  if (index !== -1) list.splice(index, 1);
}

/* ---------------- Parsing ---------------- */

function normalizeHeader(name) {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[ -]/g, "_")
    .replace(/[()]/g, "");
  return Object.prototype.hasOwnProperty.call(HEADER_ALIASES, key)
    ? HEADER_ALIASES[key]
    : null;
}

function expandTwoDigitYear(year) {
  const n = Number(year);
  return n < 69 ? 2000 + n : 1900 + n;
}

const DATE_FORMATS = [
  [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => [m[1], m[2], m[3]]],
  [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [m[3], m[1], m[2]]],
  [
    /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
    (m) => [expandTwoDigitYear(m[3]), m[1], m[2]],
  ],
  [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (m) => [m[1], m[2], m[3]]],
  [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (m) => [m[3], m[2], m[1]]],
];

function normalizeDate(value) {
  const text = (value || "").trim();
  for (const [pattern, parts] of DATE_FORMATS) {
    const match = text.match(pattern);
    if (!match) continue;
    const [year, month, day] = parts(match).map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    // Rejects dates that roll over, like 02/31/2026.
    if (
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    ) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/* ---------------- CSV ---------------- */

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadTemplate(evt) {
  evt.preventDefault();
  downloadCsv("bodycomp_template.csv", [
    CSV_COLUMNS,
    ["2026-01-05", 189.4, 7.5, 82, 95, 165, 70, 210, 2200, 2100, 8500],
  ]);
}

function exportData(evt) {
  evt.preventDefault();
  downloadCsv("bodycomp_export.csv", [
    CSV_COLUMNS,
    ...entries.map((e) =>
      CSV_COLUMNS.map((col) =>
        e[col] === null || e[col] === undefined ? "" : e[col],
      ),
    ),
  ]);
}

// Returns { error } if the file can't be used, otherwise the import counts.
function importCsv(text) {
  if (typeof Papa === "undefined") {
    return {
      error:
        "The CSV reader didn't load from the CDN. Check your internet connection and reload the page.",
    };
  }

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields || [];
  if (!fields.length) return { error: "The CSV file appears to be empty." };

  const columnMap = {};
  fields.forEach((header) => {
    const canonical = normalizeHeader(header);
    if (canonical) columnMap[header] = canonical;
  });

  if (!Object.values(columnMap).includes("date")) {
    return { error: "The CSV must include a 'date' column (YYYY-MM-DD)." };
  }

  const result = { inserted: 0, updated: 0, skipped: [] };
  const saved = updateEntries((list) => {
    parsed.data.forEach((rawRow, index) => {
      const row = {};
      Object.entries(columnMap).forEach(([header, canonical]) => {
        row[canonical] = rawRow[header];
      });

      const date = normalizeDate(row.date);
      if (!date) {
        result.skipped.push({
          line: index + 2,
          reason: "missing or unrecognized date",
        });
        return;
      }

      const values = {};
      COLUMNS.forEach((col) => {
        values[col] = toNumber(row[col]);
      });
      if (upsert(list, date, values)) result.inserted += 1;
      else result.updated += 1;
    });
  });

  return saved
    ? result
    : { error: "Your entries couldn't be saved — see the notice above." };
}

function palette() {
  const style = getComputedStyle(document.documentElement);
  const v = (name) => style.getPropertyValue(name).trim();
  return {
    series1: v("--series-1"),
    series2: v("--series-2"),
    series3: v("--series-3"),
    text: v("--text-secondary"),
    muted: v("--text-muted"),
    grid: v("--gridline"),
    baseline: v("--baseline"),
    surface: v("--surface"),
  };
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmt(value, decimals = 0) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
}

function fieldSeries(field) {
  return entries.filter((e) => e[field] !== null && e[field] !== undefined);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/* ---------------- Stat tiles ---------------- */

function renderStats() {
  const wSeries = fieldSeries("weight");
  const current = wSeries.length ? wSeries[wSeries.length - 1].weight : null;
  const previous =
    wSeries.length > 1 ? wSeries[wSeries.length - 2].weight : null;
  const weightDelta =
    current !== null && previous !== null ? current - previous : null;

  const sSeries = fieldSeries("sleep_score").slice(-7);
  const avgScore = average(sSeries.map((e) => e.sleep_score));

  const stepsSeries = fieldSeries("steps").slice(-7);
  const avgSteps = average(stepsSeries.map((e) => e.steps));

  const calSeries = entries
    .filter((e) => e.calories_intake !== null && e.calories_goal !== null)
    .slice(-7);
  const avgIntake = average(calSeries.map((e) => e.calories_intake));
  const avgGoal = average(calSeries.map((e) => e.calories_goal));
  const calDiff =
    avgIntake !== null && avgGoal !== null ? avgIntake - avgGoal : null;

  const tiles = [
    {
      label: "Current weight",
      value: current !== null ? `${fmt(current, 1)} lbs` : "—",
      delta:
        weightDelta === null
          ? null
          : {
              text: `${weightDelta <= 0 ? "↓" : "↑"} ${fmt(Math.abs(weightDelta), 1)} lbs vs last entry`,
              cls: weightDelta <= 0 ? "good" : "bad",
            },
    },
    {
      label: "Avg sleep score (7)",
      value: avgScore !== null ? fmt(avgScore, 0) : "—",
      delta: null,
    },
    {
      label: "Avg daily steps (7)",
      value: avgSteps !== null ? fmt(avgSteps, 0) : "—",
      delta: null,
    },
    {
      label: "Calories vs goal (7)",
      value: avgIntake !== null ? `${fmt(avgIntake, 0)} cal` : "—",
      delta:
        calDiff === null
          ? null
          : {
              text:
                Math.abs(calDiff) < 1
                  ? "right on goal"
                  : `${fmt(Math.abs(calDiff), 0)} cal ${calDiff > 0 ? "over" : "under"} goal`,
              cls: calDiff > 0 ? "bad" : "good",
            },
    },
  ];

  $("stats-row").innerHTML = tiles
    .map(
      (t) => `
      <div class="stat-tile">
        <div class="stat-label">${t.label}</div>
        <div class="stat-value">${t.value}</div>
        ${t.delta ? `<div class="stat-delta ${t.delta.cls}">${t.delta.text}</div>` : ""}
      </div>`,
    )
    .join("");
}

/* ---------------- Charts ---------------- */

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function baseOptions(p) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false, labels: { color: p.text } },
      tooltip: {
        backgroundColor: p.surface,
        titleColor: p.text,
        bodyColor: p.text,
        borderColor: p.grid,
        borderWidth: 1,
      },
    },
    scales: {
      x: { grid: { color: p.grid }, ticks: { color: p.muted, maxRotation: 0 } },
      y: { grid: { color: p.grid }, ticks: { color: p.muted } },
    },
  };
}

function lineDataset(label, data, color, dashed = false) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    pointRadius: data.length > 30 ? 0 : 3,
    pointHoverRadius: 5,
    borderWidth: 2,
    borderDash: dashed ? [6, 4] : [],
    spanGaps: true,
    tension: 0.25,
  };
}

function renderCharts() {
  if (typeof Chart === "undefined") {
    $("no-data-msg").hidden = false;
    $("no-data-msg").textContent =
      "Charts couldn't load (the Chart.js library didn't load from the CDN). Check your internet connection and reload the page.";
    return;
  }

  const p = palette();
  const labels = entries.map((e) => formatDateLabel(e.date));

  $("no-data-msg").hidden = entries.length > 0;

  destroyChart("weight");
  charts.weight = new Chart($("chart-weight"), {
    type: "line",
    data: {
      labels,
      datasets: [
        lineDataset(
          "Weight",
          entries.map((e) => e.weight),
          p.series1,
        ),
      ],
    },
    options: baseOptions(p),
  });

  destroyChart("calories");
  charts.calories = new Chart($("chart-calories"), {
    type: "line",
    data: {
      labels,
      datasets: [
        lineDataset(
          "Intake",
          entries.map((e) => e.calories_intake),
          p.series1,
        ),
        lineDataset(
          "Goal",
          entries.map((e) => e.calories_goal),
          p.baseline,
          true,
        ),
      ],
    },
    options: {
      ...baseOptions(p),
      plugins: {
        ...baseOptions(p).plugins,
        legend: { display: true, labels: { color: p.text, boxWidth: 12 } },
      },
    },
  });

  destroyChart("macros");
  const macroOpts = baseOptions(p);
  charts.macros = new Chart($("chart-macros"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Protein",
          data: entries.map((e) => e.protein_g),
          backgroundColor: p.series1,
          stack: "m",
        },
        {
          label: "Fat",
          data: entries.map((e) => e.fat_g),
          backgroundColor: p.series2,
          stack: "m",
        },
        {
          label: "Carbs",
          data: entries.map((e) => e.carbs_g),
          backgroundColor: p.series3,
          stack: "m",
        },
      ],
    },
    options: {
      ...macroOpts,
      plugins: {
        ...macroOpts.plugins,
        legend: { display: true, labels: { color: p.text, boxWidth: 12 } },
      },
      scales: {
        x: { ...macroOpts.scales.x, stacked: true },
        y: { ...macroOpts.scales.y, stacked: true },
      },
    },
  });

  destroyChart("steps");
  charts.steps = new Chart($("chart-steps"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Steps",
          data: entries.map((e) => e.steps),
          backgroundColor: p.series3,
        },
      ],
    },
    options: baseOptions(p),
  });

  destroyChart("sleepHours");
  charts.sleepHours = new Chart($("chart-sleep-hours"), {
    type: "line",
    data: {
      labels,
      datasets: [
        lineDataset(
          "Sleep",
          entries.map((e) => e.sleep_hours),
          p.series1,
        ),
      ],
    },
    options: baseOptions(p),
  });

  destroyChart("sleepScore");
  charts.sleepScore = new Chart($("chart-sleep-score"), {
    type: "line",
    data: {
      labels,
      datasets: [
        lineDataset(
          "Sleep score",
          entries.map((e) => e.sleep_score),
          "#4a3aa7",
        ),
      ],
    },
    options: baseOptions(p),
  });

  destroyChart("deepSleep");
  charts.deepSleep = new Chart($("chart-deep-sleep"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Deep sleep",
          data: entries.map((e) => e.deep_sleep_minutes),
          backgroundColor: p.series3,
        },
      ],
    },
    options: baseOptions(p),
  });
}

/* ---------------- History table ---------------- */

function renderTable() {
  const body = $("history-body");
  const reversed = [...entries].reverse();
  $("history-empty").hidden = reversed.length > 0;

  body.innerHTML = reversed
    .map(
      (e) => `
      <tr>
        <td>${e.date}</td>
        <td>${fmt(e.weight, 1)}</td>
        <td>${fmt(e.sleep_hours, 1)}</td>
        <td>${fmt(e.sleep_score, 0)}</td>
        <td>${fmt(e.deep_sleep_minutes, 0)}</td>
        <td>${fmt(e.protein_g, 0)}</td>
        <td>${fmt(e.fat_g, 0)}</td>
        <td>${fmt(e.carbs_g, 0)}</td>
        <td>${fmt(e.calories_intake, 0)}</td>
        <td>${fmt(e.calories_goal, 0)}</td>
        <td>${fmt(e.steps, 0)}</td>
        <td>
          <button class="btn-link-text" data-edit="${e.id}">Edit</button>
          <button class="btn-danger-text" data-delete="${e.id}">Delete</button>
        </td>
      </tr>`,
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => startEdit(Number(btn.dataset.edit)));
  });
  body.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () =>
      handleDelete(Number(btn.dataset.delete)),
    );
  });
}

/* ---------------- Form ---------------- */

function resetForm() {
  $("entry-form").reset();
  $("f-date").value = new Date().toISOString().slice(0, 10);
  editingId = null;
  editingDate = null;
  $("cancel-edit-btn").hidden = true;
  $("save-btn").textContent = "Save entry";
  $("form-hint").textContent = "";
}

function startEdit(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  editingId = id;
  editingDate = entry.date;
  $("f-date").value = entry.date;
  COLUMNS.forEach((col) => {
    $(`f-${col}`).value =
      entry[col] === null || entry[col] === undefined ? "" : entry[col];
  });
  $("cancel-edit-btn").hidden = false;
  $("save-btn").textContent = "Update entry";
  $("form-hint").textContent = `Editing ${entry.date}`;
  $("entry-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleDelete(id) {
  if (!confirm("Delete this entry? This cannot be undone.")) return;
  if (!updateEntries((list) => removeById(list, id))) return;
  if (editingId === id) resetForm();
  refresh();
}

function handleSubmit(evt) {
  evt.preventDefault();
  const date = $("f-date").value;
  if (!date) return;

  const values = {};
  COLUMNS.forEach((col) => {
    const raw = $(`f-${col}`).value;
    values[col] = raw === "" ? null : Number(raw);
  });

  const saved = updateEntries((list) => {
    if (editingId !== null && editingDate !== null && editingDate !== date) {
      removeById(list, editingId);
    }
    upsert(list, date, values);
  });
  if (!saved) return;

  resetForm();
  refresh();
}

/* ---------------- CSV import ---------------- */

async function handleUpload() {
  const fileInput = $("csv-file");
  const file = fileInput.files[0];
  const resultBox = $("import-result");
  if (!file) {
    resultBox.hidden = false;
    resultBox.className = "import-result error";
    resultBox.textContent = "Choose a CSV file first.";
    return;
  }

  resultBox.hidden = false;
  resultBox.className = "import-result";
  resultBox.textContent = "Importing…";

  let text;
  try {
    const bytes = await file.arrayBuffer();
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    resultBox.className = "import-result error";
    resultBox.textContent =
      "Could not read that file. Please upload a CSV file.";
    return;
  }

  const data = importCsv(text);
  if (data.error) {
    resultBox.className = "import-result error";
    resultBox.textContent = data.error;
    return;
  }

  resultBox.className = "import-result success";
  let msg = `Imported ${data.inserted} new and updated ${data.updated} existing entries.`;
  if (data.skipped.length) {
    msg += ` Skipped ${data.skipped.length} row(s) missing or with an unrecognized date.`;
  }
  resultBox.textContent = msg;
  fileInput.value = "";
  refresh();
}

/* ---------------- Bootstrap ---------------- */

function refresh() {
  try {
    entries = readEntries();
  } catch (err) {
    console.error("Could not read entries:", err);
    $("storage-error").hidden = false;
    return;
  }
  renderStats();
  renderTable();
  try {
    renderCharts();
  } catch (err) {
    console.error("Chart rendering failed:", err);
  }
}

function init() {
  resetForm();
  $("entry-form").addEventListener("submit", handleSubmit);
  $("cancel-edit-btn").addEventListener("click", resetForm);
  $("upload-btn").addEventListener("click", handleUpload);
  $("template-link").addEventListener("click", downloadTemplate);
  $("export-link").addEventListener("click", exportData);
  refresh();

  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", renderCharts);
  }
}

init();
