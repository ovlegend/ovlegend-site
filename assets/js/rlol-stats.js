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

  // ---- Leaders DOM (optional; works only if present) ----
  // Update these IDs if your HTML uses different ones.
  const leaderNameEl = $("#leaderName");
  const leaderMetaEl = $("#leaderMeta");
  const leaderBadgeEl = $("#leaderBadge");

  const leaderBtnReset = $("#leaderReset");
  const leaderBtnScore = $("#leaderTopScore");   // "TOP PTS"
  const leaderBtnGoals = $("#leaderTopGoals");   // "TOP GOALS"
  const leaderBtnAssists = $("#leaderTopAssists"); // NEW
  const leaderBtnSaves = $("#leaderTopSaves");     // NEW
  const leaderBtnShots = $("#leaderTopShots");     // NEW

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

  function getAny(row, keys) {
    for (const k of keys) {
      if (row[k] != null && String(row[k]).trim() !== "") return row[k];
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

  function firstNonUrl(row, keys) {
    for (const k of keys) {
      const v = norm(getAny(row, [k]));
      if (v && !isImageUrl(v)) return v;
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
    activeStatKey: "score", // orange highlight target
    query: "",
    season: "all",
    week: "all",
    team: "all",
    viewMode: (viewModeEl && viewModeEl.value) ? viewModeEl.value : "season_totals"
  };

  // ---- model (strong header mapping) ----
  function toModel(row) {
    const player = firstNonUrl(row, ["player_name", "Player", "player", "name", "Player Name", "player_id"]) || "Unknown";
    const team   = firstNonUrl(row, ["team_name", "Team Name", "team", "Team", "team_id"]) || "";

    // support both player + team logos if you have them
    const playerLogo = norm(getAny(row, ["player_logo", "Player Logo", "PlayerLogo", "player_logo_url", "Player Logo URL", "player_pfp", "PFP", "Avatar", "player_avatar"]));
    const teamLogo = norm(getAny(row, ["team_logo", "Team Logo", "TeamLogo", "team_logo_url", "Team Logo URL", "logo_url", "Logo", "logo"]));

    // season/week are optional but supported
    const season = norm(getAny(row, ["season", "Season"]));
    const week = norm(getAny(row, ["week", "Week", "match_week", "MatchWeek", "Match Week"]));

    // Your sheet uses score/goals/assists/saves/shots/ping — these fallbacks keep it flexible
    const gp = num(getAny(row, ["GP", "gp", "Games", "games"]), 0);
    const goals = num(getAny(row, ["Goals", "goals", "G", "g"]), 0);
    const assists = num(getAny(row, ["Assists", "assists", "A", "a"]), 0);
    const saves = num(getAny(row, ["Saves", "saves", "S", "s"]), 0);
    const shots = num(getAny(row, ["Shots", "shots", "Sh", "sh"]), 0);
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

  function getValByKey(r, key) {
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
  }

  function sortRows() {
    const key = state.sortKey;
    const dir = state.sortDir;

    state.filtered.sort((a, b) => {
      let res = compare(getValByKey(a, key), getValByKey(b, key), dir);
      if (res === 0 && key !== "score") res = compare(a.score, b.score, "desc");
      return res;
    });
  }

  // ---- Highlight active column after each render ----
  function applyActiveStatHighlight() {
    const key = state.activeStatKey;
    if (!key) return;

    // clear any old highlight
    root.querySelectorAll(".active-stat").forEach(el => el.classList.remove("active-stat"));

    const ths = Array.from(root.querySelectorAll("thead th[data-key]"));
    const idx = ths.findIndex(th => th.getAttribute("data-key") === key);
    if (idx < 0) return;

    // header
    ths[idx].classList.add("active-stat");

    // cells
    root.querySelectorAll("tbody tr").forEach(tr => {
      const cell = tr.children[idx];
      if (cell) cell.classList.add("active-stat");
    });
  }

  function scrollToTable() {
    const card = root.querySelector(".stats-card");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Leaders: compute leader + update UI ----
  const LEADER_KEYS = ["score", "goals", "assists", "saves", "shots"]; // NO ping
  const LEADER_LABELS = {
    score: "SCORE",
    goals: "GOALS",
    assists: "ASSISTS",
    saves: "SAVES",
    shots: "SHOTS"
  };

  function findLeader(key) {
    if (!state.rows.length) return null;
    let best = null;
    for (const r of state.rows) {
      const v = getValByKey(r, key);
      if (best == null || v > getValByKey(best, key)) best = r;
    }
    return best;
  }

  function setLeaderStat(key) {
    if (!LEADER_KEYS.includes(key)) return;

    // set active highlight + sorting
    state.activeStatKey = key;
    state.sortKey = key;
    state.sortDir = (key === "player" || key === "team") ? "asc" : "desc";

    // update leader card text if present
    const leader = findLeader(key);
    if (leaderNameEl && leader) leaderNameEl.textContent = (leader.player || "").toUpperCase();
    if (leaderMetaEl && leader) {
      const statLabel = LEADER_LABELS[key] || key.toUpperCase();
      const value = getValByKey(leader, key);
      leaderMetaEl.textContent = `${leader.team || ""} • ${statLabel}: ${value}`;
    }
    if (leaderBadgeEl) leaderBadgeEl.textContent = `#1 ${LEADER_LABELS[key] || key.toUpperCase()}`;

    // toggle button active class if present
    [
      leaderBtnScore, leaderBtnGoals, leaderBtnAssists, leaderBtnSaves, leaderBtnShots
    ].forEach(btn => btn && btn.classList.remove("active"));

    const btnMap = {
      score: leaderBtnScore,
      goals: leaderBtnGoals,
      assists: leaderBtnAssists,
      saves: leaderBtnSaves,
      shots: leaderBtnShots
    };
    const activeBtn = btnMap[key];
    if (activeBtn) activeBtn.classList.add("active");

    render();
    scrollToTable();
  }

  function th(label, key) {
    const isSortActive = state.sortKey === key;
    const arrow = isSortActive ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-key="${key}" class="${isSortActive ? "active" : ""}">${label}${arrow}</th>`;
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

    // header sorting + set highlight key when clicking a header
    root.querySelectorAll("th[data-key]").forEach((el) => {
      el.addEventListener("click", () => {
        const k = el.getAttribute("data-key");
        if (state.sortKey === k) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else {
          state.sortKey = k;
          state.sortDir = (k === "player" || k === "team") ? "asc" : "desc";
        }
        state.activeStatKey = k; // highlight follows header clicks too
        render();
        if (statusEl) statusEl.textContent = `Loaded ${state.filtered.length} rows`;
      });
    });

    applyActiveStatHighlight();

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

    // set default leader/stat on first load
    if (!state.activeStatKey) state.activeStatKey = "score";
    setLeaderStat(state.activeStatKey || "score");
  }

  function wireLeaderButtons() {
    // Only attach if the buttons exist (so this never breaks anything)
    if (leaderBtnReset) {
      leaderBtnReset.addEventListener("click", () => setLeaderStat("score"));
    }
    if (leaderBtnScore) leaderBtnScore.addEventListener("click", () => setLeaderStat("score"));
    if (leaderBtnGoals) leaderBtnGoals.addEventListener("click", () => setLeaderStat("goals"));
    if (leaderBtnAssists) leaderBtnAssists.addEventListener("click", () => setLeaderStat("assists"));
    if (leaderBtnSaves) leaderBtnSaves.addEventListener("click", () => setLeaderStat("saves"));
    if (leaderBtnShots) leaderBtnShots.addEventListener("click", () => setLeaderStat("shots"));
  }

  async function init() {
    try {
      wireLeaderButtons();

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
