// /assets/js/rlol-stats.js
(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---- REQUIRED IDs (already in your HTML) ----
  const viewModeEl = $("#viewMode");   // values: "season_totals" | "per_game"
  const seasonEl   = $("#seasonSel");
  const weekEl     = $("#weekSel");
  const teamEl     = $("#teamSel");

  // Optional (if present in your HTML)
  const searchEl =
    $("#searchPlayer") ||
    $("#search") ||
    $('input[type="search"]') ||
    $('input[placeholder*="Search"]');

  // Where we render:
  // Prefer #statsRoot if you have it; otherwise render inside .card
  let root = $("#statsRoot");
  const card = $(".card");
  if (!root && card) {
    root = document.createElement("div");
    root.id = "statsRoot";
    card.appendChild(root);
  }

  // Status line: prefer #statsStatus; else create inside card
  let statusEl = $("#statsStatus") || $(".loaded");
  if (!statusEl && card) {
    statusEl = document.createElement("div");
    statusEl.id = "statsStatus";
    statusEl.className = "loaded";
    statusEl.style.margin = "6px 0 10px";
    card.insertBefore(statusEl, root);
  }

  // If we can't render, bail loudly
  if (!root) {
    console.error("RLOL Stats: Missing #statsRoot and no .card container found.");
    return;
  }

  // ---- CSV parsing (quoted commas safe) ----
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    text = String(text || "").replace(/\uFEFF/g, ""); // strip BOM

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

  // Adds cache-buster + better errors + HTML guard
  async function fetchCsv(url) {
    if (!url) throw new Error("CSV URL missing");

    const busted = url + (url.includes("?") ? "&" : "?") + "v=" + Date.now();
    const res = await fetch(busted, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching CSV`);

    const text = await res.text();

    // Google returns HTML if it's not a published CSV
    if (/^\s*</.test(text)) {
      throw new Error("CSV fetch returned HTML (check that the Sheet is published to CSV)");
    }

    return parseCSV(text);
  }

  // ---- helpers ----
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

  // Try to infer common column names
  const COL = {
    player: ["Player", "player", "Name", "name", "Epic", "epic", "Steam", "steam"],
    team:   ["Team", "team", "Team Name", "team_name", "teamName"],
    season: ["Season", "season"],
    week:   ["Week", "week", "Match Week", "match_week"],
    gp:     ["GP", "gp", "Games", "games", "Played", "played"],
    score:  ["Score", "score", "Points", "points"],
    goals:  ["G", "g", "Goals", "goals"],
    assists:["A", "a", "Assists", "assists"],
    saves:  ["Saves", "saves"],
    shots:  ["Shots", "shots"],
    ping:   ["Ping", "ping", "Avg Ping", "avg_ping", "avgPing"],
    logo:   ["logo", "logo_url", "Logo", "Logo URL"]
  };

  // ---- config url selection ----
  function getUrls() {
    const cfg = window.OV_CONFIG && window.OV_CONFIG.rlol;
    if (!cfg) throw new Error("OV_CONFIG.rlol missing. Check /assets/js/config.js is loading.");

    // Accept multiple possible keys so you don’t have to rename anything
    const seasonUrl =
      (cfg.statsSeasonCsv || cfg.playerStatsSeasonCsv || cfg.statsCsv || cfg.playerStatsCsv || "").trim();

    const perGameUrl =
      (cfg.statsPerGameCsv || cfg.playerStatsPerGameCsv || cfg.statsPerGame || cfg.playerStatsPerGame || seasonUrl || "").trim();

    if (!seasonUrl) {
      throw new Error(
        "Stats CSV URL missing in OV_CONFIG.rlol. Add one of: statsSeasonCsv / playerStatsSeasonCsv / statsCsv / playerStatsCsv"
      );
    }

    return { seasonUrl, perGameUrl };
  }

  // ---- state ----
  const state = {
    raw: [],
    rows: [],
    filtered: [],
    sortKey: "score",
    sortDir: "desc",
    query: "",
    season: "all",
    week: "all",
    team: "all",
    viewMode: "season_totals"
  };

  function toModel(row) {
    const player = pick(row, COL.player, "Unknown");
    const team   = pick(row, COL.team, "");
    const season = pick(row, COL.season, "");
    const week   = pick(row, COL.week, "");

    const gp     = num(pick(row, COL.gp, "0"));
    const score  = num(pick(row, COL.score, "0"));
    const g      = num(pick(row, COL.goals, "0"));
    const a      = num(pick(row, COL.assists, "0"));
    const saves  = num(pick(row, COL.saves, "0"));
    const shots  = num(pick(row, COL.shots, "0"));
    const ping   = num(pick(row, COL.ping, "0"));

    const logo   = pick(row, COL.logo, "");

    return { player, team, season, week, gp, score, g, a, saves, shots, ping, logo, _raw: row };
  }

  function uniqSorted(list) {
    return Array.from(new Set(list.filter(Boolean))).sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  }

  function fillSelect(sel, values, allLabel) {
    if (!sel) return;
    sel.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = allLabel;
    sel.appendChild(optAll);

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
      const hay = norm([r.player, r.team].join(" "));
      return hay.includes(q);
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
      const va = getVal(a);
      const vb = getVal(b);
      let res = compare(va, vb, dir);
      if (res === 0 && key !== "score") res = compare(a.score, b.score, "desc");
      return res;
    });
  }

  function th(label, key) {
    const isActive = state.sortKey === key;
    const dir = isActive ? state.sortDir : "desc";
    const arrow = isActive ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-key="${key}" class="${isActive ? "active" : ""}" aria-sort="${dir}">${label}${arrow}</th>`;
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

    // header sorting
    root.querySelectorAll("th[data-key]").forEach((thEl) => {
      thEl.addEventListener("click", () => {
        const k = thEl.getAttribute("data-key");
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
    state.raw = csv;
    state.rows = csv.map(toModel);

    // Populate dropdowns if we actually have those columns
    const seasons = uniqSorted(state.rows.map((r) => r.season));
    const weeks   = uniqSorted(state.rows.map((r) => r.week));
    const teams   = uniqSorted(state.rows.map((r) => r.team));

    if (seasonEl) {
      fillSelect(seasonEl, seasons, "All");
      seasonEl.value = state.season;
      seasonEl.disabled = seasons.length === 0;
    }
    if (weekEl) {
      fillSelect(weekEl, weeks, "All");
      weekEl.value = state.week;
      weekEl.disabled = weeks.length === 0;
    }
    if (teamEl) {
      fillSelect(teamEl, teams, "All Teams");
      teamEl.value = state.team;
      teamEl.disabled = teams.length === 0;
    }

    render();
  }

  async function init() {
    try {
      // confirm scripts are loading
      console.log("RLOL Stats loaded:", document.currentScript?.src || "(inline)");

      // read view mode default
      if (viewModeEl) state.viewMode = viewModeEl.value || "season_totals";

      // wire controls
      if (viewModeEl) {
        viewModeEl.addEventListener("change", async () => {
          state.viewMode = viewModeEl.value;
          await loadAndBuild();
        });
      }

      if (seasonEl) {
        seasonEl.addEventListener("change", () => {
          state.season = seasonEl.value || "all";
          render();
        });
      }
      if (weekEl) {
        weekEl.addEventListener("change", () => {
          state.week = weekEl.value || "all";
          render();
        });
      }
      if (teamEl) {
        teamEl.addEventListener("change", () => {
          state.team = teamEl.value || "all";
          render();
        });
      }
      if (searchEl) {
        searchEl.addEventListener("input", () => {
          state.query = searchEl.value || "";
          render();
        });
      }

      await loadAndBuild();
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = "Failed to load stats";
      root.innerHTML = `<div class="error">Error: ${String(err.message || err)}</div>`;
    }
  }

  init();
})();
