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

  function normLower(s) { return String(s || "").trim().toLowerCase(); }
  function norm(s) { return String(s || "").trim(); }

  function uniqSorted(list) {
    return Array.from(new Set(list.filter((x) => String(x).trim() !== "")))
      .sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
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

    sel.value = "all";
    sel.disabled = values.length === 0;
  }

  // URL detection + safe image html
function isImageUrl(v) {
  const s = norm(v);
  return /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(s);
}

function imgHTML(url, alt) {
  const u = norm(url);
  if (!isImageUrl(u)) return "";
  return `<img class="logo" src="${u}" alt="${alt || ""}" loading="lazy" />`;
}

function firstNonUrl(row, keys) {
  for (const k of keys) {
    const v = norm(getAny(row, [k]));
    if (v && !isImageUrl(v)) return v;
  }
  return "";
}
  // Read a value by trying multiple possible headers (case sensitive + insensitive)
  function getAny(row, keys) {
    for (const k of keys) {
      if (row[k] != null && String(row[k]).trim() !== "") return row[k];
      // case-insensitive fallback
      const want = String(k).trim().toLowerCase();
      for (const realKey of Object.keys(row)) {
        if (String(realKey).trim().toLowerCase() === want) {
          const v = row[realKey];
          if (v != null && String(v).trim() !== "") return v;
        }
      }
    }
    return "";
  }

  // ---- URLs from config (supports BOTH key styles) ----
  function getUrls() {
    const cfg = window.OV_CONFIG && window.OV_CONFIG.rlol;
    if (!cfg) throw new Error("OV_CONFIG.rlol missing (config.js not loaded?)");

    const seasonUrl = String(
      cfg.playerSeasonStatsCsv ||
      cfg.statsSeasonCsv ||
      cfg.playerStatsSeasonCsv ||
      cfg.statsCsv ||
      cfg.playerStatsCsv ||
      ""
    ).trim();

    const perGameUrl = String(
      cfg.playerGameStatsCsv ||
      cfg.statsGameCsv ||
      ""
    ).trim();

    if (!seasonUrl) throw new Error("Stats CSV URL missing in OV_CONFIG.rlol (need playerSeasonStatsCsv or statsSeasonCsv)");
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

  // ---- model (strong header mapping) ----
  function toModel(row) {
    const player = firstNonUrl(row, ["player_name", "Player", "player", "name", "Player Name"]) || "Unknown";
const team   = firstNonUrl(row, ["team_name", "Team Name", "team", "Team"]) || "";

    // support both player + team logos if you have them
    const playerLogo = norm(getAny(row, ["player_logo", "Player Logo", "PlayerLogo", "player_logo_url", "Player Logo URL", "player_pfp", "PFP", "Avatar", "player_avatar"]));
    const teamLogo = norm(getAny(row, ["team_logo", "Team Logo", "TeamLogo", "team_logo_url", "Team Logo URL", "logo_url", "Logo", "logo"]));

    // season/week are optional but supported
    const season = norm(getAny(row, ["season", "Season"]));
    const week = norm(getAny(row, ["week", "Week", "match_week", "MatchWeek", "Match Week"]));

    const gp = num(getAny(row, ["GP", "gp", "Games", "games"]), 0);
    const goals = num(getAny(row, ["Goals", "goals", "G", "g"]), 0);
    const assists = num(getAny(row, ["Assists", "assists", "A", "a"]), 0);
    const saves = num(getAny(row, ["Saves", "saves"]), 0);
    const shots = num(getAny(row, ["Shots", "shots"]), 0);
    const score = num(getAny(row, ["Score", "score", "Points", "points"]), 0);
    const ping = num(getAny(row, ["Avg Ping", "avg_ping", "Ping", "ping"]), 0);

    return {
      player: player || "Unknown",
      team: team || "",
      playerLogo,
      teamLogo,
      season,
      week,
      gp,
      goals,
      assists,
      saves,
      shots,
      score,
      ping,
      _raw: row
    };
  }

  function applyFilters() {
    const q = normLower(state.query);

    state.filtered = state.rows.filter((r) => {
      if (state.season !== "all" && r.season !== state.season) return false;
      if (state.week !== "all" && r.week !== state.week) return false;
      if (state.team !== "all" && r.team !== state.team) return false;

      if (!q) return true;
      return normLower(`${r.player} ${r.team}`).includes(q);
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
        case "player": return normLower(r.player);
        case "team": return normLower(r.team);
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
      <div class="stats-card ov-card">
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
              <tr class="ov-row">
                <td class="playerCell">
                  <div class="cellFlex">
                    ${r.playerLogo ? imgHTML(r.playerLogo, r.player) : `<div class="logo ph"></div>`}
                    <div class="cellText">
                      <div class="cellMain">${r.player}</div>
                    </div>
                  </div>
                </td>

                <td class="teamCell">
                  <div class="cellFlex">
                    ${r.teamLogo ? imgHTML(r.teamLogo, r.team) : `<div class="logo ph"></div>`}
                    <div class="cellText">
                      <div class="cellMain">${r.team || ""}</div>
                    </div>
                  </div>
                </td>

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
