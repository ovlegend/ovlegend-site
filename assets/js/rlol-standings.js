async function buildTeamMap() {
  const teams = await fetchCsv(window.OV_CONFIG.rlol.teamsCsv);
  const map = new Map();

  teams.forEach(t => {
    const id = String(t.team_id || "").trim();
    if (!id) return;

    map.set(id, {
      id,
      // Your sheet uses "Team" (not team_name/abbr)
      name: String(t.Team || id).trim(),
      // Your sheet uses "logo_url" (not logo)
      logo: String(t.logo_url || "").trim()
    });
  });

  return map;
}

// /assets/js/rlol-standings.js
(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---------------- CSV parsing (quoted commas safe) ----------------
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
        cur = "";
        if (row.some((x) => String(x).trim() !== "")) rows.push(row);
        row = [];
        continue;
      }

      cur += c;
    }
    row.push(cur);
    if (row.some((x) => String(x).trim() !== "")) rows.push(row);

    const header = rows[0] || [];
    const data = [];
    for (let r = 1; r < rows.length; r++) {
      const obj = {};
      for (let c = 0; c < header.length; c++) {
        obj[String(header[c] || "").trim()] = (rows[r][c] ?? "").trim();
      }
      data.push(obj);
    }
    return data;
  }

  async function fetchCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCSV(await res.text());
  }

  // ---------------- helpers ----------------
  function pick(row, keys, fallback = "") {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
        return String(row[k]).trim();
      }
    }
    return fallback;
  }

  function num(v, fallback = 0) {
    const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeKey(s) {
    return String(s || "").trim().toLowerCase();
  }

  function compare(a, b, dir) {
    return dir === "asc" ? (a > b ? 1 : a < b ? -1 : 0) : (a < b ? 1 : a > b ? -1 : 0);
  }

  // ---------------- render ----------------
  const root = $("#standingsRoot");
  const statusEl = $("#standingsStatus");
  const searchEl = $("#searchTeam");
  const viewModeEl = $("#viewMode");

  const state = {
    rows: [],
    filtered: [],
    sortKey: "rank",
    sortDir: "asc",
    viewMode: "full",
    query: ""
  };

  function toStandingsModel(row) {
    // Expect columns like: rank, team, w, l, gd, gf, ga, gp, points etc.
    // We'll support multiple header variants safely.
    const teamId = pick(row, ["team_id", "Team ID", "id", "ID"], "");
    const team   = pick(row, ["team_name", "team", "Team", "TEAM", "name", "Name"], teamId);
    const abbr   = pick(row, ["abbr", "Abbr", "ABBR", "abbreviation", "Abbreviation"], "");
    const rank = num(pick(row, ["rank", "#", "pos", "position", "Position"], ""), 999);


    const w = num(pick(row, ["w", "W", "wins", "Wins"], "0"));
    const l = num(pick(row, ["l", "L", "losses", "Losses"], "0"));
    const gp = num(pick(row, ["gp", "GP", "games", "Games", "played", "Played"], String(w + l)));

    const gd = num(pick(row, ["gd", "GD", "goal diff", "Goal Diff", "goal_diff", "Goal_Diff"], "0"));
    const gf = num(pick(row, ["gf", "GF", "goals for", "Goals For", "goals_for"], "0"));
    const ga = num(pick(row, ["ga", "GA", "goals against", "Goals Against", "goals_against"], "0"));

    const pts = num(pick(row, ["pts", "PTS", "points", "Points"], "0"));

    const logo = pick(row, ["logo", "Logo", "logo_url", "Logo URL", "logoUrl"], "");

    return { rank, teamId, team, abbr, w, l, gp, gd, gf, ga, pts, logo, _raw: row };
  }

  function applyFilters() {
    const q = normalizeKey(state.query);

    state.filtered = state.rows.filter((r) => {
      if (!q) return true;
      const hay = normalizeKey([r.team, r.abbr].join(" "));
      return hay.includes(q);
    });
  }

  function sortRows() {
    const key = state.sortKey;
    const dir = state.sortDir;

    const getVal = (r) => {
      switch (key) {
        case "team": return normalizeKey(r.team);
        case "record": return r.w; // primary sort by wins
        case "w": return r.w;
        case "l": return r.l;
        case "gp": return r.gp;
        case "gd": return r.gd;
        case "gf": return r.gf;
        case "ga": return r.ga;
        case "pts": return r.pts;
        case "rank":
        default: return r.rank;
      }
    };

    state.filtered.sort((a, b) => {
      // rank always stable if tied
      let res = compare(getVal(a), getVal(b), dir);

      // smart tie-breaks
      if (res === 0 && key !== "gd") res = compare(a.gd, b.gd, "desc");
      if (res === 0 && key !== "gf") res = compare(a.gf, b.gf, "desc");
      if (res === 0) res = compare(a.rank, b.rank, "asc");
      return res;
    });
  }

  function th(label, key) {
    const isActive = state.sortKey === key;
    const dir = isActive ? state.sortDir : "asc";
    const arrow = isActive ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";

    return `<th data-key="${key}" class="${isActive ? "active" : ""}" aria-sort="${dir}">
      ${label}${arrow}
    </th>`;
  }

  function render() {
    applyFilters();
    sortRows();

    const rowsToShow = state.viewMode === "snapshot" ? state.filtered.slice(0, 4) : state.filtered;

    root.innerHTML = `
      <div class="standings-card">
        <table class="standings-table">
          <thead>
            <tr>
              ${th("#", "rank")}
              ${th("Team", "team")}
              ${th("W", "w")}
              ${th("L", "l")}
              ${th("GP", "gp")}
              ${th("GD", "gd")}
              ${th("GF", "gf")}
              ${th("GA", "ga")}
              ${th("PTS", "pts")}
            </tr>
          </thead>
          <tbody>
            ${rowsToShow.map((r) => `
              <tr>
                <td class="num">${r.rank === 999 ? "" : r.rank}</td>
                <td class="teamCell">
                  ${r.logo ? `<img class="logo" src="${r.logo}" alt="${r.team} logo" loading="lazy" />` : `<div class="logo ph"></div>`}
                  <div class="teamText">
                    <div class="teamName">${r.team || r.abbr || "TBD"}</div>
                    ${r.abbr ? `<div class="teamAbbr">${r.abbr}</div>` : ``}
                  </div>
                </td>
                <td class="num">${r.w}</td>
                <td class="num">${r.l}</td>
                <td class="num">${r.gp}</td>
                <td class="num">${r.gd}</td>
                <td class="num">${r.gf}</td>
                <td class="num">${r.ga}</td>
                <td class="num">${r.pts}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    // click-to-sort
    root.querySelectorAll("th[data-key]").forEach((el) => {
      el.addEventListener("click", () => {
        const k = el.getAttribute("data-key");
        if (state.sortKey === k) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = k; state.sortDir = (k === "team" || k === "rank") ? "asc" : "desc"; }
        render();
      });
    });
  }

  async function init() {
    try {
      const cfg = window.OV_CONFIG && window.OV_CONFIG.rlol;
      if (!cfg) throw new Error("OV_CONFIG.rlol missing");

      // default to full standings CSV, but allow switching to the hub snapshot CSV if you want exact match
      const fullUrl = cfg.standingsCsv;
      const snapUrl = cfg.standingsViewCsv || cfg.standingsCsv;

      statusEl.textContent = "Loading standings…";

      let data = await fetchCsv(fullUrl);
      let model = data.map(toStandingsModel);

      // If ranks aren't provided, generate rank by sorting (W desc, GD desc)
      const needsRank = model.every((r) => r.rank === 999);
      if (needsRank) {
        model.sort((a, b) => {
          let res = compare(a.w, b.w, "desc");
          if (res === 0) res = compare(a.gd, b.gd, "desc");
          if (res === 0) res = compare(a.gf, b.gf, "desc");
          return res;
        });
        model.forEach((r, i) => (r.rank = i + 1));
      }

      state.rows = model;
      state.viewMode = "full";

      // UI wiring
      searchEl.addEventListener("input", () => {
        state.query = searchEl.value;
        render();
      });

      viewModeEl.addEventListener("change", async () => {
        state.viewMode = viewModeEl.value;

        // Optional: if you want snapshot to exactly match the hub view sheet, swap data source
        if (state.viewMode === "snapshot" && snapUrl !== fullUrl) {
          statusEl.textContent = "Loading snapshot…";
          const snapData = await fetchCsv(snapUrl);
          state.rows = snapData.map(toStandingsModel);
          // snapshot ranks if missing
          const needsRank2 = state.rows.every((r) => r.rank === 999);
          if (needsRank2) state.rows.forEach((r, i) => (r.rank = i + 1));
        } else if (state.viewMode === "full" && snapUrl !== fullUrl) {
          statusEl.textContent = "Loading standings…";
          const fullData = await fetchCsv(fullUrl);
          state.rows = fullData.map(toStandingsModel);
          const needsRank3 = state.rows.every((r) => r.rank === 999);
          if (needsRank3) state.rows.forEach((r, i) => (r.rank = i + 1));
        }

        render();
        statusEl.textContent = `Loaded ${state.rows.length} teams`;
      });

      render();
      statusEl.textContent = `Loaded ${state.rows.length} teams`;
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Failed to load standings`;
      root.innerHTML = `<div class="error">Error: ${String(err.message || err)}</div>`;
    }
  }

  init();
})();
