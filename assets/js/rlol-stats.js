// /assets/js/rlol-stats.js
(function () {
  const $ = (sel) => document.querySelector(sel);

  // Controls (your HTML already has these)
  const viewModeEl = $("#viewMode");     // values: "season_totals" | "per_game"
  const seasonEl   = $("#seasonSel");
  const weekEl     = $("#weekSel");
  const teamEl     = $("#teamSel");

  const searchEl =
    $("#searchPlayer") ||
    $("#search") ||
    $('input[type="search"]') ||
    $('input[placeholder*="Search"]');

  // Render root: use #statsRoot if present, else inject into .card
  let root = $("#statsRoot");
  const card = $(".card");
  if (!root && card) {
    root = document.createElement("div");
    root.id = "statsRoot";
    card.appendChild(root);
  }

  // Status: use existing "Loaded X rows" element if you have it, else create
  let statusEl = $("#statsStatus") || $(".loaded");
  if (!statusEl && card) {
    statusEl = document.createElement("div");
    statusEl.id = "statsStatus";
    statusEl.className = "loaded";
    statusEl.style.margin = "6px 0 10px";
    card.insertBefore(statusEl, root);
  }

  if (!root) {
    console.error("RLOL Stats: No render root found (#statsRoot or .card).");
    return;
  }

  // ---------------- CSV parsing (quoted commas safe) ----------------
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    text = String(text || "").replace(/\uFEFF/g, "");

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
    if (!url) throw new Error("CSV URL missing");

    const busted = url + (url.includes("?") ? "&" : "?") + "v=" + Date.now();
    const res = await fetch(busted, { cache: "no-store" });

    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching CSV`);

    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error("CSV fetch returned HTML (Sheet not published as CSV)");

    return parseCSV(text);
  }

  function pick(row, keys, fallback = "") {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return fallback;
  }

  function num(v, fallback = 0) {
    const s = String(v ?? "").trim();
    if (s === "") return fallback;
    const n = Number(s.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }

  function norm(s) { return String(s || "").trim().toLowerCase(); }

  function compare(a, b, dir) {
    return dir === "asc"
      ? (a > b ? 1 : a < b ? -1 : 0)
      : (a < b ? 1 : a > b ? -1 : 0);
  }

  // Common column name variants
  const COL = {
    player: ["Player", "player", "Name", "name", "Epic", "epic"],
    team:   ["Team", "team", "Team Name", "team_name"],
    season: ["Season", "season"],
    week:   ["Week", "week"],
    gp:     ["GP", "gp", "Games", "games", "Played", "played"],
    score:  ["Score", "score", "Points", "points"],
    goals:  ["G", "g", "Goals", "goals"],
    assists:["A", "a", "Assists", "assists"],
    saves:  ["Saves", "saves"],
    shots:  ["Shots", "shots"],
    ping:   ["Ping", "ping", "Avg Ping", "avg_ping"],
    logo:   ["logo", "logo_url", "Logo", "Logo URL"]
  };

  // ---- IMPORTANT: matches your config.js keys ----
  function getUrls() {
    const cfg = window.OV_CONFIG && window.OV_CONFIG.rlol;
    if (!cfg) throw new Error("OV_CONFIG.rlol missing (is /assets/js/config.js loaded?)");

    const seasonUrl = String(cfg.playerSeasonStatsCsv || "").trim();
    const perGameUrl = String(cfg.playerGameStatsCsv || "").trim();

    if (!seasonUrl && !perGameUrl) {
      throw new Error("Missing stats CSV URLs. Need playerSeasonStatsCsv and/or playerGameStatsCsv in config.");
    }

    return {
      seasonUrl: seasonUrl || perGameUrl,
      perGameUrl: perGameUrl || seasonUrl
    };
  }

  // ---- state ----
  const state = {
    rows: [],
    filtered: [],
    sortKey: "score",
    sortDir: "desc",
    query: "",
    season: "all",
    week: "all",
    team: "all",
    viewMode: (viewModeEl && viewModeEl.value) ? viewModeEl.value : "season_totals"
  };

  function toModel(row) {
    return {
      player: pick(row, COL.player, "Unknown"),
      team:   pick(row, COL.team, ""),
      season: pick(row, COL.season, ""),
      week:   pick(row, COL.week, ""),
      gp:     num(pick(row, COL.gp, "0")),
      score:  num(pick(row, COL.score, "0")),
      g:      num(pick(row, COL.goals, "0")),
      a:      num(pick(row, COL.assists, "0")),
      saves:  num(pick(row, COL.saves, "0")),
      shots:  num(pick(row, COL.shots, "0")),
      ping:   num(pick(row, COL.ping, "")),
      logo:   pick(row, COL.logo, ""),
      _raw: row
    };
  }

  function uniqSorted(list) {
    return Array.from(new Set(list.filter(Boolean))).sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  }

  function fillSelect(sel, values, allLabel) {
    if (!sel) return;
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = allLabel;
    sel.appendChild(all);

    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  }

  function applyFilters() {
    const q = norm(state.query);

    state.filtered = state.rows.filter((r) => {
      if (state.season !== "all" && r.season !== state.season) return false;
      if (state.week !== "all" && r.week !== state.week) return false;
      if (state.team !== "all" && r.team !== state.team) return false;

      if (!q) return true;
      return norm(`${r.player} ${r.team}`).includes(q);
    });
  }

  function sortRows() {
    const key = state.sortKey;
    const dir = state.sortDir;

    const getVal = (r) => {
      switch (key) {
        case "player": return norm(r.player);
        case "team": return norm(r.team);
        case "gp": return r.gp;
        case "score": return r.score;
        case "g": return r.g;
        case "a": return r.a;
        case "saves": return r.saves;
        case "shots": return r.shots;
        case "ping": return r.ping;
        default: return r.score;
      }
    };

    state.filtered.sort((a, b) => {
      let res = compare(getVal(a), getVal(b), dir);
      if (res === 0 && key !== "score") res = compare(a.score, b.score, "desc");
      return res;
    });
  }

  function th(label, key) {
    const isActive = state.sortKey === key;
    const arrow = isActive ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-key="${key}" class="${isActive ? "active" : ""}">${label}${arrow}</th>`;
  }

  function render() {
    applyFilters();
    sortRows();

    root.innerHTML = `
      <div class="stats-card">
        <table class="stats-table">
          <thead>
            <tr>
              ${th("Player", "player")}
              ${th("Team", "team")}
              ${th("GP", "gp")}
              ${th("Score", "score")}
              ${th("G", "g")}
              ${th("A", "a")}
              ${th("Saves", "saves")}
              ${th("Shots", "shots")}
              ${th("Ping", "ping")}
            </tr>
          </thead>
          <tbody>
            ${state.filtered.map((r) => `
              <tr>
                <td class="playerCell">
                  ${r.logo ? `<img class="logo" src="${r.logo}" alt="" loading="lazy" />` : ``}
                  <span class="playerName">${r.player}</span>
                </td>
                <td class="teamCell">${r.team || ""}</td>
                <td class="num">${r.gp}</td>
                <td class="num">${r.score}</td>
                <td class="num">${r.g}</td>
                <td class="num">${r.a}</td>
                <td class="num">${r.saves}</td>
                <td class="num">${r.shots}</td>
                <td class="num">${r.ping || ""}</td>
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
        else {
          state.sortKey = k;
          state.sortDir = (k === "player" || k === "team") ? "asc" : "desc";
        }
        render();
        if (statusEl) statusEl.textContent = `Loaded ${state.filtered.length} rows`;
      });
    });

    if (statusEl) statusEl.textContent = `Loaded ${state.filtered.length} rows`;
  }

  async function loadAndBuild() {
    const { seasonUrl, perGameUrl } = getUrls();
    const url = (state.viewMode === "per_game") ? perGameUrl : seasonUrl;

    if (statusEl) statusEl.textContent = "Loading stats…";
    root.innerHTML = `<div class="stats-loading">Loading stats…</div>`;

    const csv = await fetchCsv(url);
    state.rows = csv.map(toModel);

    // Fill dropdowns if data exists
    const seasons = uniqSorted(state.rows.map((r) => r.season));
    const weeks   = uniqSorted(state.rows.map((r) => r.week));
    const teams   = uniqSorted(state.rows.map((r) => r.team));

    if (seasonEl) { fillSelect(seasonEl, seasons, "All"); seasonEl.disabled = seasons.length === 0; }
    if (weekEl)   { fillSelect(weekEl, weeks, "All");     weekEl.disabled = weeks.length === 0; }
    if (teamEl)   { fillSelect(teamEl, teams, "All Teams"); teamEl.disabled = teams.length === 0; }

    render();
  }

  async function init() {
    try {
      console.log("RLOL Stats loaded:", document.currentScript?.src || "(inline)");

      if (viewModeEl) {
        viewModeEl.addEventListener("change", async () => {
          state.viewMode = viewModeEl.value || "season_totals";
          await loadAndBuild();
        });
      }
      if (seasonEl) seasonEl.addEventListener("change", () => { state.season = seasonEl.value || "all"; render(); });
      if (weekEl)   weekEl.addEventListener("change", () => { state.week = weekEl.value || "all"; render(); });
      if (teamEl)   teamEl.addEventListener("change", () => { state.team = teamEl.value || "all"; render(); });
      if (searchEl) searchEl.addEventListener("input", () => { state.query = searchEl.value || ""; render(); });

      await loadAndBuild();
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = "Failed to load stats";
      root.innerHTML = `<div class="error">Error: ${String(err.message || err)}</div>`;
    }
  }

  init();
})();
