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

let entries = []; // sorted ascending by date, from the server
let editingId = null;
let editingDate = null;
const charts = {};

const $ = (id) => document.getElementById(id);

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

async function handleDelete(id) {
  if (!confirm("Delete this entry? This cannot be undone.")) return;
  await fetch(`/api/entries/${id}`, { method: "DELETE" });
  if (editingId === id) resetForm();
  await refresh();
}

async function handleSubmit(evt) {
  evt.preventDefault();
  const date = $("f-date").value;
  if (!date) return;

  const payload = { date };
  COLUMNS.forEach((col) => {
    const raw = $(`f-${col}`).value;
    payload[col] = raw === "" ? null : Number(raw);
  });

  if (editingId !== null && editingDate !== null && editingDate !== date) {
    await fetch(`/api/entries/${editingId}`, { method: "DELETE" });
  }

  await fetch("/api/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  resetForm();
  await refresh();
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

  const formData = new FormData();
  formData.append("file", file);

  resultBox.hidden = false;
  resultBox.className = "import-result";
  resultBox.textContent = "Importing…";

  try {
    const res = await fetch("/api/import", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      resultBox.className = "import-result error";
      resultBox.textContent = data.error || "Import failed.";
      return;
    }
    resultBox.className = "import-result success";
    let msg = `Imported ${data.inserted} new and updated ${data.updated} existing entries.`;
    if (data.skipped && data.skipped.length) {
      msg += ` Skipped ${data.skipped.length} row(s) missing a date.`;
    }
    resultBox.textContent = msg;
    fileInput.value = "";
    await refresh();
  } catch (err) {
    resultBox.className = "import-result error";
    resultBox.textContent = "Something went wrong reading that file.";
  }
}

/* ---------------- Bootstrap ---------------- */

async function refresh() {
  const res = await fetch("/api/entries");
  entries = await res.json();
  renderStats();
  renderCharts();
  renderTable();
}

function init() {
  resetForm();
  $("entry-form").addEventListener("submit", handleSubmit);
  $("cancel-edit-btn").addEventListener("click", resetForm);
  $("upload-btn").addEventListener("click", handleUpload);
  refresh();

  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", renderCharts);
  }
}

init();
