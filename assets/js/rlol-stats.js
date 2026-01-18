// /assets/js/rlol-stats.js
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
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
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

  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  function compare(a, b, dir) {
    return dir === "asc" ? (a > b ? 1 : a < b ? -1 : 0) : (a < b ? 1 : a > b ? -1 : 0);
  }

  function uniqSorted(arr, asNumber = false) {
    const set = new Set(arr.filter(v => v !== "" && v != null));
    const out = Array.from(set);
    out.sort((a, b) => {
      if (asNumber) return Number(a) - Number(b);
      return String(a).localeCompare(String(b));
    });
    return out;
  }

  function safeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ---------------- team map (logos + names) ----------------
  async function buildTeamMap(teamsCsvUrl) {
    if (!teamsCsvUrl) return new Map();
    const teams = await fetchCsv(teamsCsvUrl);
    const map = new Map();

    teams.forEach(t => {
      const id = String(t.team_id || "").trim();
      if (!id) return;

      map.set(id, {
        id,
        name: String(t.Team || id).trim(),
        logo: String(t.logo_url || "").trim()
      });
    });

    return map;
  }

  // ---------------- UI elements ----------------
  const root = $("#statsRoot");
  const statusEl = $("#statsStatus");

  const seasonSel = $("#seasonSel");
  const weekSel = $("#weekSel");
  const teamSel = $("#teamSel");
  const searchEl = $("#searchPlayer");
  const viewModeEl = $("#viewMode");

  // ---------------- config / urls ----------------
  function getCfg() {
    const cfg = window.OV_CONFIG && window.OV_CONFIG.rlol;
    if (!cfg) throw new Error("OV_CONFIG.rlol missing");

    // Prefer config.js values if you add them later, otherwise fall back to your links
    const fallbackGame =
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vQCnxfwBylnd5H8jHc_g9Gtv7wyhzelCLixlK3-Bi_Uw0pVJga8MPtgYf5740Csm7hbfLTJhHGdWzh/pub?gid=1283136814&single=true&output=csv";

    const fallbackSeason =
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vQCnxfwBylnd5H8jHc_g9Gtv7wyhzelCLixlK3-Bi_Uw0pVJga8MPtgYf5740Csm7hbfLTJhHGdWzh/pub?gid=939885276&single=true&output=csv";

    return {
      teamsCsv: cfg.teamsCsv,
      playerGameStatsCsv: cfg.playerGameStatsCsv || fallbackGame,
      playerSeasonStatsCsv: cfg.playerSeasonStatsCsv || fallbackSeason
    };
  }

  // ---------------- state ----------------
  const state = {
    view: "season_totals", // season_totals | per_game
    sortKey: "goals",
    sortDir: "desc",
    season: "all",
    week: "all",
    team: "all",
    query: "",
    teamMap: new Map(),

    // raw datasets
    rowsSeason: [],
    rowsGame: [],
    loadedSeason: false,
    loadedGame: false,

    // current rows rendered
    rows: []
  };

  // ---------------- model transforms ----------------
  // Per-game rows (Player_Game_Stats)
  function toGameModel(row) {
    const season = pick(row, ["season", "Season"], "");
    const week = pick(row, ["week", "Week"], "");
    const matchId = pick(row, ["match_id", "Match ID"], "");
    const gameId = pick(row, ["game_id", "Game ID"], "");

    const playerId = pick(row, ["player_id", "player", "Player", "Player ID"], "");
    const teamId = pick(row, ["team_id", "Team ID"], "");
    const teamSide = pick(row, ["team_side", "side", "Side"], "");

    const score = num(pick(row, ["score", "Score"], "0"));
    const goals = num(pick(row, ["goals", "Goals"], "0"));
    const assists = num(pick(row, ["assists", "Assists"], "0"));
    const saves = num(pick(row, ["saves", "Saves"], "0"));
    const shots = num(pick(row, ["shots", "Shots"], "0"));
    const ping = num(pick(row, ["ping", "Ping"], "0"));

    const teamMeta = state.teamMap.get(teamId);
    const teamName = teamMeta ? teamMeta.name : teamId;
    const logo = teamMeta ? teamMeta.logo : "";

    return {
      _type: "game",
      season, week, matchId, gameId,
      playerId,
      teamId, teamName, teamSide,
      score, goals, assists, saves, shots, ping,
      logo,
      _raw: row
    };
  }

  // Season totals (Player_Season_Stats)
  // NOTE: Your sheet columns might differ. This supports common variants + falls back to summing game stats if missing.
  function toSeasonModel(row) {
    const season = pick(row, ["season", "Season"], "");
    const week = pick(row, ["week", "Week"], ""); // if your season sheet doesn’t have week, it stays ""

    const playerId = pick(row, ["player_id", "player", "Player", "Player ID"], "");
    const teamId = pick(row, ["team_id", "Team ID"], "");

    const games = num(pick(row, ["games", "GP", "gp", "Games Played"], "0"));
    const score = num(pick(row, ["score", "Score"], "0"));
    const goals = num(pick(row, ["goals", "Goals"], "0"));
    const assists = num(pick(row, ["assists", "Assists"], "0"));
    const saves = num(pick(row, ["saves", "Saves"], "0"));
    const shots = num(pick(row, ["shots", "Shots"], "0"));
    const ping = num(pick(row, ["ping", "Ping", "avg_ping", "Avg Ping"], "0"));

    const teamMeta = state.teamMap.get(teamId);
    const teamName = teamMeta ? teamMeta.name : teamId;
    const logo = teamMeta ? teamMeta.logo : "";

    return {
      _type: "season",
      season, week,
      playerId,
      teamId, teamName,
      games, score, goals, assists, saves, shots, ping,
      logo,
      _raw: row
    };
  }

  // If Player_Season_Stats is missing or weak, we can build totals from game rows
  function buildSeasonTotalsFromGames(gameRows) {
    const map = new Map();

    for (const r of gameRows) {
      const season = r.season || "";
      const key = `${season}__${r.teamId}__${r.playerId}`;
      const cur = map.get(key) || {
        _type: "season",
        season,
        week: "",
        playerId: r.playerId,
        teamId: r.teamId,
        teamName: r.teamName,
        logo: r.logo,
        games: 0,
        score: 0,
        goals: 0,
        assists: 0,
        saves: 0,
        shots: 0,
        pingSum: 0,
        pingCount: 0
      };

      cur.games += 1;
      cur.score += r.score;
      cur.goals += r.goals;
      cur.assists += r.assists;
      cur.saves += r.saves;
      cur.shots += r.shots;

      if (Number.isFinite(r.ping) && r.ping > 0) {
        cur.pingSum += r.ping;
        cur.pingCount += 1;
      }

      map.set(key, cur);
    }

    // finalize avg ping
    const out = Array.from(map.values()).map(x => ({
      ...x,
      ping: x.pingCount ? Math.round(x.pingSum / x.pingCount) : 0
    }));

    return out;
  }

  // ---------------- filtering + sorting ----------------
  function getFilteredRows(rows) {
    const q = norm(state.query);
    return rows.filter(r => {
      if (state.season !== "all" && String(r.season) !== String(state.season)) return false;
      if (state.team !== "all" && String(r.teamId) !== String(state.team)) return false;

      // Week filter only applies when the data has a week (per-game always has it; season sheet might not)
      if (state.week !== "all") {
        const hasWeek = String(r.week || "").trim() !== "";
        if (hasWeek && String(r.week) !== String(state.week)) return false;
        if (!hasWeek && state.view === "season_totals") {
          // ignore week filter if season sheet doesn’t have week
        } else if (!hasWeek) {
          return false;
        }
      }

      if (!q) return true;
      const hay = norm([r.playerId, r.teamName, r.teamId].join(" "));
      return hay.includes(q);
    });
  }

  function sortRows(rows) {
    const key = state.sortKey;
    const dir = state.sortDir;

    const val = (r) => {
      switch (key) {
        case "player": return norm(r.playerId);
        case "team": return norm(r.teamName || r.teamId);
        case "games": return r.games ?? 0;
        case "score": return r.score ?? 0;
        case "goals": return r.goals ?? 0;
        case "assists": return r.assists ?? 0;
        case "saves": return r.saves ?? 0;
        case "shots": return r.shots ?? 0;
        case "ping": return r.ping ?? 0;
        case "season": return Number(r.season) || 0;
        case "week": return Number(r.week) || 0;
        default: return r.goals ?? 0;
      }
    };

    rows.sort((a, b) => {
      let res = compare(val(a), val(b), dir);

      // tie-breaks
      if (res === 0 && key !== "score") res = compare(a.score ?? 0, b.score ?? 0, "desc");
      if (res === 0 && key !== "goals") res = compare(a.goals ?? 0, b.goals ?? 0, "desc");
      if (res === 0) res = compare(norm(a.playerId), norm(b.playerId), "asc");
      return res;
    });

    return rows;
  }

  // ---------------- render ----------------
  function th(label, key) {
    const isActive = state.sortKey === key;
    const dir = isActive ? state.sortDir : "asc";
    const arrow = isActive ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-key="${key}" class="${isActive ? "active" : ""}" aria-sort="${dir}">${label}${arrow}</th>`;
  }

  function render() {
    const filtered = getFilteredRows(state.rows);
    sortRows(filtered);

    const isSeason = state.view === "season_totals";

    const cols = isSeason
      ? [
          ["Player", "player"],
          ["Team", "team"],
          ["GP", "games"],
          ["Score", "score"],
          ["G", "goals"],
          ["A", "assists"],
          ["Saves", "saves"],
          ["Shots", "shots"],
          ["Ping", "ping"]
        ]
      : [
          ["Season", "season"],
          ["Week", "week"],
          ["Player", "player"],
          ["Team", "team"],
          ["Side", "side"],
          ["Score", "score"],
          ["G", "goals"],
          ["A", "assists"],
          ["Saves", "saves"],
          ["Shots", "shots"],
          ["Ping", "ping"]
        ];

    const headHtml = cols.map(([label, key]) => th(label, key)).join("");

    const bodyHtml = filtered.map(r => {
      const teamCell = `
        <td class="teamCell">
          ${r.logo ? `<img class="logo" src="${r.logo}" alt="${safeHtml(r.teamName || r.teamId)} logo" loading="lazy" />` : `<div class="logo ph"></div>`}
          <div class="teamText">
            <div class="teamName">${safeHtml(r.teamName || r.teamId || "TBD")}</div>
            <div class="teamAbbr">${safeHtml(r.teamId || "")}</div>
          </div>
        </td>
      `;

      if (isSeason) {
        return `
          <tr>
            <td class="playerCell">
              <div class="playerName">${safeHtml(r.playerId || "")}</div>
            </td>
            ${teamCell}
            <td class="num">${r.games ?? 0}</td>
            <td class="num">${r.score ?? 0}</td>
            <td class="num">${r.goals ?? 0}</td>
            <td class="num">${r.assists ?? 0}</td>
            <td class="num">${r.saves ?? 0}</td>
            <td class="num">${r.shots ?? 0}</td>
            <td class="num">${r.ping ?? 0}</td>
          </tr>
        `;
      }

      return `
        <tr>
          <td class="num">${safeHtml(r.season)}</td>
          <td class="num">${safeHtml(r.week)}</td>
          <td class="playerCell"><div class="playerName">${safeHtml(r.playerId || "")}</div></td>
          ${teamCell}
          <td class="caps">${safeHtml(r.teamSide || "")}</td>
          <td class="num">${r.score ?? 0}</td>
          <td class="num">${r.goals ?? 0}</td>
          <td class="num">${r.assists ?? 0}</td>
          <td class="num">${r.saves ?? 0}</td>
          <td class="num">${r.shots ?? 0}</td>
          <td class="num">${r.ping ?? 0}</td>
        </tr>
      `;
    }).join("");

    root.innerHTML = `
      <div class="standings-card">
        <table class="standings-table">
          <thead><tr>${headHtml}</tr></thead>
          <tbody>${bodyHtml || `<tr><td colspan="${cols.length}" class="empty">No results</td></tr>`}</tbody>
        </table>
      </div>
    `;

    // click-to-sort
    root.querySelectorAll("th[data-key]").forEach((el) => {
      el.addEventListener("click", () => {
        const k = el.getAttribute("data-key");

        // map keys that exist only in per-game
        if (k === "side") {
          state.sortKey = "side";
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          render();
          return;
        }

        if (state.sortKey === k) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else {
          state.sortKey = k;
          // text columns default asc; stats default desc
          state.sortDir = (k === "player" || k === "team" || k === "season" || k === "week") ? "asc" : "desc";
        }
        render();
      });
    });

    statusEl.textContent = `Loaded ${filtered.length} row${filtered.length === 1 ? "" : "s"}`;
  }

  // ---------------- dropdowns ----------------
  function fillSelect(selectEl, values, { includeAll = true, allLabel = "All", allValue = "all" } = {}) {
    const current = selectEl.value;
    const opts = [];

    if (includeAll) opts.push({ v: allValue, t: allLabel });
    values.forEach(v => opts.push({ v: String(v), t: String(v) }));

    selectEl.innerHTML = opts.map(o => `<option value="${safeHtml(o.v)}">${safeHtml(o.t)}</option>`).join("");
    // keep selection if possible
    const stillExists = opts.some(o => o.v === current);
    selectEl.value = stillExists ? current : (includeAll ? allValue : (opts[0]?.v || ""));
  }

  function rebuildFiltersFromRows(rows) {
    const seasons = uniqSorted(rows.map(r => r.season), true);
    fillSelect(seasonSel, seasons, { includeAll: true, allLabel: "All", allValue: "all" });

    const teams = uniqSorted(rows.map(r => r.teamId), false);
    // Team dropdown shows IDs but we can show names in option label
    const teamOptions = teams.map(id => {
      const meta = state.teamMap.get(id);
      return { id, label: meta ? meta.name : id };
    }).sort((a, b) => a.label.localeCompare(b.label));

    // custom fill
    const current = teamSel.value;
    const opts = [{ v: "all", t: "All Teams" }]
      .concat(teamOptions.map(x => ({ v: x.id, t: x.label })));

    teamSel.innerHTML = opts.map(o => `<option value="${safeHtml(o.v)}">${safeHtml(o.t)}</option>`).join("");
    teamSel.value = opts.some(o => o.v === current) ? current : "all";

    // Week: only if rows have week populated
    const weeks = uniqSorted(rows.map(r => r.week).filter(w => String(w).trim() !== ""), true);
    if (weeks.length) {
      weekSel.disabled = false;
      fillSelect(weekSel, weeks, { includeAll: true, allLabel: "All", allValue: "all" });
    } else {
      weekSel.disabled = true;
      weekSel.innerHTML = `<option value="all">All</option>`;
      weekSel.value = "all";
      state.week = "all";
    }
  }

  // ---------------- loading ----------------
  async function ensureSeasonLoaded(cfg) {
    if (state.loadedSeason) return;
    statusEl.textContent = "Loading season totals…";
    const data = await fetchCsv(cfg.playerSeasonStatsCsv);
    state.rowsSeason = data.map(toSeasonModel);
    state.loadedSeason = true;
  }

  async function ensureGameLoaded(cfg) {
    if (state.loadedGame) return;
    statusEl.textContent = "Loading per-game stats…";
    const data = await fetchCsv(cfg.playerGameStatsCsv);
    state.rowsGame = data.map(toGameModel);
    state.loadedGame = true;
  }

  function seasonSheetLooksEmpty(rowsSeason) {
    // If it has basically no numeric stats but does have players, we’ll rebuild from games
    if (!rowsSeason.length) return true;
    const anyStats = rowsSeason.some(r => (r.goals || r.assists || r.saves || r.shots || r.score || r.games));
    return !anyStats;
  }

  async function setView(view, cfg) {
    state.view = view;

    if (view === "season_totals") {
      await ensureSeasonLoaded(cfg);

      // If the season sheet isn't ready yet, build totals from game sheet
      if (seasonSheetLooksEmpty(state.rowsSeason)) {
        await ensureGameLoaded(cfg);
        const totals = buildSeasonTotalsFromGames(state.rowsGame);
        state.rows = totals;
      } else {
        state.rows = state.rowsSeason;
      }

      // default sort
      state.sortKey = "goals";
      state.sortDir = "desc";
    } else {
      await ensureGameLoaded(cfg);
      state.rows = state.rowsGame;

      state.sortKey = "score";
      state.sortDir = "desc";
    }

    rebuildFiltersFromRows(state.rows);
    render();
  }

  // ---------------- init ----------------
  async function init() {
    try {
      const cfg = getCfg();

      // team logos map
      statusEl.textContent = "Loading teams…";
      state.teamMap = await buildTeamMap(cfg.teamsCsv);

      // wire UI
      searchEl.addEventListener("input", () => { state.query = searchEl.value; render(); });

      seasonSel.addEventListener("change", () => { state.season = seasonSel.value; render(); });
      weekSel.addEventListener("change", () => { state.week = weekSel.value; render(); });
      teamSel.addEventListener("change", () => { state.team = teamSel.value; render(); });

      viewModeEl.addEventListener("change", async () => {
        // reset filters that may not apply
        state.query = searchEl.value || "";
        state.season = seasonSel.value || "all";
        state.week = "all";
        state.team = teamSel.value || "all";

        await setView(viewModeEl.value, cfg);
      });

      // default view
      await setView(viewModeEl.value || "season_totals", cfg);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Failed to load stats";
      root.innerHTML = `<div class="error">Error: ${String(err.message || err)}</div>`;
    }
  }

  init();
})();
