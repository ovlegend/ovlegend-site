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
    return dir === "asc"
      ? (a > b ? 1 : a < b ? -1 : 0)
      : (a < b ? 1 : a > b ? -1 : 0);
  }

  // ---------------- teams map ----------------
  async function buildTeamMap() {
    const cfg = window.OV_CONFIG && window.OV_CONFIG.rlol;
    if (!cfg || !cfg.teamsCsv) return new Map();

    const teams = await fetchCsv(cfg.teamsCsv);
    const map = new Map();

    teams.forEach((t) => {
      const id = String(t.team_id || t.Team_ID || t.id || "").trim();
      if (!id) return;

      map.set(id, {
        id,
        // Your Teams sheet headers: Team, team_id, logo_url
        name: String(t.Team || t.team_name || t.name || id).trim(),
        logo: String(t.logo_url || t.logo || "").trim()
      });
    });

    return map;
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

  // filled during init()
  let TEAM_MAP = new Map();

  function toStandingsModel(row) {
    // Standings CSV headers (from your console):
    // team_id,team_name,GP,W,L,GF,GA,GD,PTS
    const teamId = pick(row, ["team_id", "Team ID", "id", "ID"], "");
    const meta = (teamId && TEAM_MAP.get(teamId)) ? TEAM_MAP.get(teamId) : null;

    // Prefer the Teams sheet display name if available (meta.name),
    // otherwise fall back to standings team_name/team/team etc.
    const team =
      (meta && meta.name) ||
      pick(row, ["team_name", "team", "Team", "TEAM", "name", "Name"], teamId);

    const abbr = pick(row, ["abbr", "Abbr", "ABBR", "abbreviation", "Abbreviation"], "");

    // Rank is optional; if missing we’ll generate later.
    const rank = num(pick(row, ["rank", "#", "pos", "position", "Position"], ""), 999);

    const w = num(pick(row, ["W", "w", "wins", "Wins"], "0"));
    const l = num(pick(row, ["L", "l", "losses", "Losses"], "0"));
    const gp = num(pick(row, ["GP", "gp", "games", "Games", "played", "Played"], String(w + l)));

    const gd = num(pick(row, ["GD", "gd", "goal diff", "Goal Diff", "goal_diff", "Goal_Diff"], "0"));
    const gf = num(pick(row, ["GF", "gf", "goals for", "Goals For", "goals_for"], "0"));
    const ga = num(pick(row, ["GA", "ga", "goals against", "Goals Against", "goals_against"], "0"));

    const pts = num(pick(row, ["PTS", "pts", "points", "Points"], "0"));

    // Prefer Teams sheet logo; fallback to any logo columns in standings (if you ever add them)
    const logo =
      (meta && meta.logo) ||
      pick(row, ["logo", "Logo", "logo_url", "Logo URL", "logoUrl"], "");

    return { rank, teamId, team, abbr, w, l, gp, gd, gf, ga, pts, logo, _raw: row };
  }

  function applyFilters() {
    const q = normalizeKey(state.query);

    state.filtered = state.rows.filter((r) => {
      if (!q) return true;
      const hay = normalizeKey([r.team, r.abbr, r.teamId].join(" "));
      return hay.includes(q);
    });
  }

  function sortRows() {
    const key = state.sortKey;
    const dir = state.sortDir;

    const getVal = (r) => {
      switch (key) {
        case "team": return normalizeKey(r.team);
        case "record": return r.w;
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
      let res = compare(getVal(a), getVal(b), dir);

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
                  ${r.logo
                    ? `<img class="logo" src="${r.logo}" alt="${r.team} logo" loading="lazy" />`
                    : `<div class="logo ph"></div>`}
                  <div class="teamText">
                    <div class="teamName">${r.team || r.abbr || r.teamId || "TBD"}</div>
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

      const fullUrl = cfg.standingsCsv;
      const snapUrl = cfg.standingsViewCsv || cfg.standingsCsv;

      statusEl.textContent = "Loading standings…";

      // ✅ load team logos/names FIRST
      TEAM_MAP = await buildTeamMap();

      let data = await fetchCsv(fullUrl);
      let model = data.map(toStandingsModel);

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

      searchEl.addEventListener("input", () => {
        state.query = searchEl.value;
        render();
      });

      viewModeEl.addEventListener("change", async () => {
        state.viewMode = viewModeEl.value;

        if (state.viewMode === "snapshot" && snapUrl !== fullUrl) {
          statusEl.textContent = "Loading snapshot…";
          const snapData = await fetchCsv(snapUrl);
          state.rows = snapData.map(toStandingsModel);

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
