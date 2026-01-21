// /assets/js/rlol-stats.js
(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---- DOM ----
  const viewModeEl = $("#viewMode");
  const seasonEl = $("#seasonSel");
  const weekEl = $("#weekSel");
  const teamEl = $("#teamSel");
  const searchEl = $("#searchPlayer");

  const statusEl = $("#statsStatus");
  const root = $("#statsRoot");

  if (!root) return;

  // ---- CSV parsing (quoted commas safe) ----
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
    if (/^\s*</.test(text)) throw new Error("CSV fetch returned HTML (not a published CSV link)");

    return parseCSV(text);
  }

  // ---- helpers ----
  function num(v, fallback = 0) {
    const s = String(v ?? "").trim();
    if (s === "") return fallback;
    const n = Number(s.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }

  function norm(s) { return String(s || "").trim().toLowerCase(); }

  function uniqSorted(list) {
    return Array.from(new Set(list.filter((x) => String(x).trim() !== "")))
      .sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  }

  function fillSelect(sel, values, allLabel) {
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

    sel.value = "all";
    sel.disabled = values.length === 0;
  }

  // ---- URLs from config (supports BOTH key styles) ----
  function getUrls() {
    const cfg = window.OV_CONFIG && window.OV_CONFIG.rlol;
    if (!cfg) throw new Error("OV_CONFIG.rlol missing (config.js not loaded?)");

    const seasonUrl =
      String(
        cfg.playerSeasonStatsCsv ||
        cfg.statsSeasonCsv ||
        cfg.playerStatsSeasonCsv ||
        cfg.statsCsv ||
        cfg.playerStatsCsv ||
        ""
      ).trim();

    const perGameUrl =
      String(
        cfg.playerGameStatsCsv ||
        cfg.statsGameCsv ||
        ""
      ).trim();

    if (!seasonUrl) throw new Error("Stats CSV URL missing in OV_CONFIG.rlol (need playerSeasonStatsCsv or statsSeasonCsv)");

    // perGame is optional; if missing we reuse seasonUrl
    return { seasonUrl, perGameUrl: perGameUrl || seasonUrl };
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

  // ---- model (matches YOUR CSV headers) ----
  function toModel(row) {
    const player = row.player_name || row.Player || row.player || row.name || "Unknown";
    const team = row.team_name || row.Team || row.team || "";
    const logo = row.logo_url || row.logo || "";

    // season/week are optional but supported
    const season = row.season || row.Season || "";
    const week = row.week || row.Week || row.match_week || row.MatchWeek || "";

    const gp = num(row.GP ?? row.gp ?? row.Games ?? row.games, 0);
    const goals = num(row.Goals ?? row.goals ?? row.G ?? row.g, 0);
    const assists = num(row.Assists ?? row.assists ?? row.A ?? row.a, 0);
    const saves = num(row.Saves ?? row.saves, 0);
    const shots = num(row.Shots ?? row.shots, 0);
    const score = num(row.Score ?? row.score ?? row.Points ?? row.points, 0);
    const ping = num(row["Avg Ping"] ?? row.avg_ping ?? row.Ping ?? row.ping, 0);

    return { player, team, logo, season, week, gp, goals, assists, saves, shots, score, ping, _raw: row };
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

  function compare(a, b, dir) {
    return dir === "asc"
      ? (a > b ? 1 : a < b ? -1 : 0)
      : (a < b ? 1 : a > b ? -1 : 0);
  }

  function sortRows() {
    const key = state.sortKey;
    const dir = state.sortDir;

    const getVal = (r) => {
      switch (key) {
        case "player": return norm(r.player);
        case "team": return norm(r.team);
        case "gp": return r.gp;
        case "goals": return r.goals;
        case "assists": return r.assists;
        case "saves": return r.saves;
        case "shots": return r.shots;
        case "ping": return r.ping;
        case "score":
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
              ${th("G", "goals")}
              ${th("A", "assists")}
              ${th("Saves", "saves")}
              ${th("Shots", "shots")}
              ${th("Ping", "ping")}
            </tr>
          </thead>
          <tbody>
            ${state.filtered.map((r) => `
              <tr>
                <td class="teamCell">
                  ${r.logo ? `<img class="logo" src="${r.logo}" alt="${r.team} logo" loading="lazy" />` : `<div class="logo ph"></div>`}
                  <div class="teamText">
                    <div class="teamName">${r.player}</div>
                    <div class="teamAbbr">${r.team || ""}</div>
                  </div>
                </td>
                <td>${r.team || ""}</td>
                <td class="num">${r.gp}</td>
                <td class="num">${r.score}</td>
                <td class="num">${r.goals}</td>
                <td class="num">${r.assists}</td>
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

    // Dropdowns (season/week may be blank -> disables)
    fillSelect(seasonEl, uniqSorted(state.rows.map((r) => r.season)), "All");
    fillSelect(weekEl, uniqSorted(state.rows.map((r) => r.week)), "All");
    fillSelect(teamEl, uniqSorted(state.rows.map((r) => r.team)), "All Teams");

    state.season = "all";
    state.week = "all";
    state.team = "all";

    render();
  }

  async function init() {
    try {
      // Wire controls
      if (viewModeEl) {
        viewModeEl.addEventListener("change", async () => {
          state.viewMode = viewModeEl.value || "season_totals";
          await loadAndBuild();
        });
      }

      if (seasonEl) seasonEl.addEventListener("change", () => { state.season = seasonEl.value || "all"; render(); });
      if (weekEl) weekEl.addEventListener("change", () => { state.week = weekEl.value || "all"; render(); });
      if (teamEl) teamEl.addEventListener("change", () => { state.team = teamEl.value || "all"; render(); });

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
