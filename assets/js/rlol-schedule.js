// /assets/js/rlol-schedule.js
(function () {
  const root = document.getElementById("scheduleRoot");
  const weekFilter = document.getElementById("weekFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");
  const statusText = document.getElementById("schedStatusText");

  if (!root) return;

  // ---- Guard: config must exist ----
  const CSV_URL = window.OV_CONFIG?.rlol?.scheduleCsv;

  if (!CSV_URL) {
    console.error("Missing OV_CONFIG.rlol.scheduleCsv. Check /assets/js/config.js");
    if (statusText) statusText.textContent = "Missing scheduleCsv in config.js";
    return;
  }

  let matches = [];

  /* ---------------- CSV PARSER (quoted commas safe) ---------------- */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (c === '"' && inQuotes && next === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQuotes = !inQuotes; continue; }

      if (c === "," && !inQuotes) { row.push(cur); cur = ""; continue; }

      if ((c === "\n" || c === "\r") && !inQuotes) {
        if (c === "\r" && next === "\n") i++;
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
        continue;
      }

      cur += c;
    }

    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  // Normalize header names like "home_team_id" -> "hometeamid"
  function keyify(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  // Try to read columns even if you change header wording later
  function get(m, keys, fallback = "") {
    for (const k of keys) {
      if (m[k] != null && String(m[k]).trim() !== "") return String(m[k]).trim();
    }
    return fallback;
  }

  function statusOf(m) {
    const raw = get(m, ["status", "matchstatus", "gamestatus", "state", "result"], "scheduled");
    return String(raw).trim().toLowerCase();
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* ---------------- LOAD ---------------- */
  fetch(CSV_URL)
    .then(r => r.text())
    .then(text => {
      const rows = parseCSV(text);
      const rawHeaders = rows.shift() || [];
      const headers = rawHeaders.map(keyify);

      matches = rows
        .filter(r => r.some(cell => String(cell || "").trim() !== "")) // drop empty lines
        .map(r => {
          const obj = {};
          headers.forEach((h, i) => obj[h] = (r[i] || "").trim());
          return obj;
        });

      buildWeekFilter();
      updateStatusPill();
      render();

      if (weekFilter) weekFilter.addEventListener("change", render);
      if (statusFilter) statusFilter.addEventListener("change", render);
      if (searchInput) searchInput.addEventListener("input", render);
    })
    .catch(err => {
      console.error("Schedule load failed", err);
      if (statusText) statusText.textContent = "Failed to load schedule";
    });

  /* ---------------- UI BUILD ---------------- */
  function buildWeekFilter() {
    if (!weekFilter) return;

    const weeks = [...new Set(matches.map(m => get(m, ["week"], "")).filter(Boolean))];

    weeks.sort((a, b) => {
      const na = parseInt(String(a).replace(/\D/g, "")) || 0;
      const nb = parseInt(String(b).replace(/\D/g, "")) || 0;
      return na - nb;
    });

    weekFilter.innerHTML = `<option value="all">All weeks</option>`;
    weeks.forEach(w => {
      const opt = document.createElement("option");
      opt.value = w;
      opt.textContent = `Week ${w}`;
      weekFilter.appendChild(opt);
    });
  }

  function updateStatusPill() {
    if (!statusText) return;
    const live = matches.filter(m => statusOf(m) === "live").length;
    statusText.textContent = live > 0
      ? `${live} match${live > 1 ? "es" : ""} live now`
      : `${matches.length} total matches`;
  }

  /* ---------------- RENDER ---------------- */
  function render() {
    const weekVal = weekFilter ? weekFilter.value : "all";
    const statusVal = statusFilter ? statusFilter.value : "all";
    const q = (searchInput ? (searchInput.value || "") : "").toLowerCase();

    const filtered = matches.filter(m => {
      const week = get(m, ["week"], "");
      const st = statusOf(m);

      // ✅ matches your sheet headers
      const t1 = get(m, ["hometeamid", "hometeam", "team1", "home"], "");
      const t2 = get(m, ["awayteamid", "awayteam", "team2", "away", "opponent"], "");

      const date = get(m, ["scheduleddate", "date", "matchdate"], "");
      const time = get(m, ["scheduledtime", "time", "starttime", "start"], "");
      const tz = get(m, ["timezone", "tz"], "");

      if (weekVal !== "all" && String(week) !== String(weekVal)) return false;
      if (statusVal !== "all" && st !== statusVal) return false;

      if (q) {
        const blob = `${week} ${st} ${t1} ${t2} ${date} ${time} ${tz}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }

      // Don’t show totally blank rows
      return Boolean(t1 || t2 || date || time);
    });

    root.innerHTML = "";

    if (!filtered.length) {
      root.innerHTML = `<div class="empty">No matches found</div>`;
      return;
    }

    filtered.forEach(m => {
      const week = get(m, ["week"], "");
      const t1 = get(m, ["hometeamid", "hometeam", "team1", "home"], "");
      const t2 = get(m, ["awayteamid", "awayteam", "team2", "away", "opponent"], "");
      const date = get(m, ["scheduleddate", "date", "matchdate"], "");
      const time = get(m, ["scheduledtime", "time", "starttime", "start"], "");
      const tz = get(m, ["timezone", "tz"], "");

      const rawStatus = get(m, ["status", "matchstatus", "gamestatus", "state", "result"], "Scheduled");
      const st = statusOf(m);

      const row = document.createElement("div");
      row.className = "match-row";

      row.innerHTML = `
        <div class="match-left">
          <div class="week">Week ${esc(week)}</div>
          <div class="time">${esc(date)} ${esc(time)} ${esc(tz)}</div>
        </div>

        <div class="match-center">
          <div class="teams">
            <span class="team">${esc(t1)}</span>
            <span class="vs">vs</span>
            <span class="team">${esc(t2)}</span>
          </div>
        </div>

        <div class="match-right">
          <span class="status ${esc(st)}">${esc(rawStatus)}</span>
        </div>
      `;

      root.appendChild(row);
    });
  }
})();
