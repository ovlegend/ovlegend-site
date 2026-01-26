// /assets/js/rlol-stats.js
(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---- DOM (existing ids used across your V2 pages) ----
  const viewModeEl = $("#viewMode");
  const seasonEl = $("#seasonSel");
  const weekEl = $("#weekSel");
  const teamEl = $("#teamSel");
  const searchEl = $("#searchPlayer");
  const btnReset     = $("#btnReset");
  const btnTopPts    = $("#btnTopPts");
  const btnTopGoals  = $("#btnTopGoals");
  const btnTopAssists= $("#btnTopAssists");
  const btnTopSaves  = $("#btnTopSaves");
  const btnTopShots  = $("#btnTopShots");
  const btnTopGP     = $("#btnTopGP");
  const statusEl = $("#statsStatus");
  const root = $("#statsRoot");
  if (!root) return;

  // ---- Optional "Leaders" UI hooks (won't break if missing) ----
  const leaderNameEl =
    $("#leaderName") ||
    $("[data-leader-name]") ||
    $(".leader-name");

  const leaderMetaEl =
    $("#leaderMeta") ||
    $("[data-leader-meta]") ||
    $(".leader-meta");

  const leaderBadgeEl =
    $("#leaderBadge") ||
    $("[data-leader-badge]") ||
    $(".leader-badge");

  const leaderBtnsWrap =
    $("#leaderBtns") ||
    $("#leaderButtons") ||
    $("[data-leader-buttons]") ||
    $(".leader-actions") ||
    $(".leader-btns");

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

      if (c === '"' && inQuotes && next === '"') {
        cur += '"'; i++; continue;
      }
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

  // Read a value by trying multiple possible headers (case sensitive + insensitive)
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
    leaderKey: "score",
    query: "",
    season: "all",
    week: "all",
    team: "all",
    viewMode: (viewModeEl && viewModeEl.value) ? viewModeEl.value : "season_totals"
  };

  // Leaders: one button per stat (no ping)
  const LEADER_METRICS = [
    { key: "score",   label: "TOP PTS",     badge: "#1 SCORE",  valueLabel: "Score" },
    { key: "goals",   label: "TOP GOALS",   badge: "#1 GOALS",  valueLabel: "Goals" },
    { key: "assists", label: "TOP AST",     badge: "#1 AST",    valueLabel: "Assists" },
    { key: "saves",   label: "TOP SAVES",   badge: "#1 SAVES",  valueLabel: "Saves" },
    { key: "shots",   label: "TOP SHOTS",   badge: "#1 SHOTS",  valueLabel: "Shots" },
    { key: "gp",      label: "MOST GP",     badge: "#1 GP",     valueLabel: "GP" }
  ];

  function metricInfo(key) {
    return LEADER_METRICS.find(m => m.key === key) || LEADER_METRICS[0];
  }

  // ---- model (strong header mapping for your sheet) ----
  function toModel(row) {
    // Your sheet headers: player_id, team_id, score, goals, assists, saves, shots, ping, season, week, game_id...
    const player =
      firstNonUrl(row, ["player_name", "player_id", "Player", "player", "name", "Player Name"]) ||
      "Unknown";

    const team =
      firstNonUrl(row, ["team_name", "team_id", "Team Name", "team", "Team"]) ||
      "";

    const playerLogo = norm(getAny(row, [
      "player_logo", "Player Logo", "PlayerLogo",
      "player_logo_url", "Player Logo URL",
      "player_pfp", "PFP", "Avatar", "player_avatar"
    ]));

    const teamLogo = norm(getAny(row, [
      "team_logo", "Team Logo", "TeamLogo",
      "team_logo_url", "Team Logo URL",
      "logo_url", "Logo", "logo"
    ]));

    const season = norm(getAny(row, ["season", "Season"]));
    const week = norm(getAny(row, ["week", "Week", "match_week", "MatchWeek", "Match Week"]));

    const gameId = norm(getAny(row, ["game_id", "Game ID", "GameId"]));
    const gp = num(getAny(row, ["GP", "gp", "Games", "games", "Games Played", "games_played"]), 0);

    const goals = num(getAny(row, ["goals", "Goals", "G", "g"]), 0);
    const assists = num(getAny(row, ["assists", "Assists", "A", "a"]), 0);
    const saves = num(getAny(row, ["saves", "Saves", "SV", "sv"]), 0);
    const shots = num(getAny(row, ["shots", "Shots", "Sh", "sh"]), 0);
    const score = num(getAny(row, ["score", "Score", "Points", "points", "PTS", "pts"]), 0);
    const ping = num(getAny(row, ["ping", "Ping", "Avg Ping", "avg_ping"]), 0);

    return {
      player: player || "Unknown",
      team: team || "",
      playerLogo,
      teamLogo,
      season,
      week,
      gameId,
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

  // If GP isn't provided but game_id exists, infer GP per player from unique game_id count
  function inferGPIfMissing(models) {
    const needs = models.some(r => (!r.gp || r.gp === 0) && r.gameId);
    if (!needs) return models;

    const map = new Map(); // key -> Set(gameId)
    for (const r of models) {
      const key = `${normLower(r.player)}||${normLower(r.team)}`;
      if (!map.has(key)) map.set(key, new Set());
      if (r.gameId) map.get(key).add(r.gameId);
    }

    return models.map(r => {
      if ((!r.gp || r.gp === 0) && r.gameId) {
        const key = `${normLower(r.player)}||${normLower(r.team)}`;
        const set = map.get(key);
        const inferred = set ? set.size : 0;
        return { ...r, gp: inferred };
      }
      return r;
    });
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
    return `<th data-key="${key}" class="${isActive ? "active-stat" : ""}">${label}${arrow}</th>`;
  }

  function tdNum(val, key) {
    const cls = `num${state.sortKey === key ? " active-stat" : ""}`;
    return `<td class="${cls}">${val}</td>`;
  }

  function ensureLeaderButtons() {
    if (!leaderBtnsWrap) return;

    // Build once, then we just toggle .active
    leaderBtnsWrap.innerHTML = "";

    const mkBtn = (txt, key, extraClass) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = txt;
      b.className = extraClass || "";
      b.dataset.metric = key || "";
      return b;
    };

    // reset
    const resetBtn = mkBtn("RESET", "reset", "btn pill");
    resetBtn.addEventListener("click", () => {
      setLeaderMetric("score");
    });
    leaderBtnsWrap.appendChild(resetBtn);

    // one per metric (no ping)
    LEADER_METRICS.forEach(m => {
      const b = mkBtn(m.label, m.key, "btn pill");
      b.addEventListener("click", () => setLeaderMetric(m.key));
      leaderBtnsWrap.appendChild(b);
    });

    syncLeaderButtonsActive();
  }

  function syncLeaderButtonsActive() {
    if (!leaderBtnsWrap) return;
    leaderBtnsWrap.querySelectorAll("button[data-metric]").forEach(btn => {
      const k = btn.dataset.metric;
      const active = (k === state.leaderKey) || (k === state.sortKey && k !== "reset");
      btn.classList.toggle("active", active && k !== "reset");
    });
  }

  function updateLeaderCard() {
    // Leaders are based on CURRENT filtered list
    if (!leaderNameEl && !leaderMetaEl && !leaderBadgeEl) return;

    if (!state.filtered.length) {
      if (leaderNameEl) leaderNameEl.textContent = "—";
      if (leaderMetaEl) leaderMetaEl.textContent = "No results";
      if (leaderBadgeEl) leaderBadgeEl.textContent = "";
      return;
    }

    const m = metricInfo(state.leaderKey);
    const key = state.leaderKey;

    // Copy + sort by selected metric desc; tie-break on score desc
    const sorted = [...state.filtered].sort((a, b) => {
      const va = a[key] ?? 0;
      const vb = b[key] ?? 0;
      if (vb !== va) return vb - va;
      return (b.score ?? 0) - (a.score ?? 0);
    });

    const top = sorted[0];
    const val = top[key] ?? 0;

    if (leaderNameEl) leaderNameEl.textContent = String(top.player || "Unknown").toUpperCase();

    if (leaderMetaEl) {
      const teamTxt = top.team ? `${top.team} · ` : "";
      leaderMetaEl.textContent = `${teamTxt}${m.valueLabel}: ${val}`;
    }

    if (leaderBadgeEl) leaderBadgeEl.textContent = m.badge;

    syncLeaderButtonsActive();
  }

  function setLeaderMetric(key) {
    state.leaderKey = key;

    // Also sort table by that metric (desc), because that’s the vibe you’re building
    state.sortKey = key;
    state.sortDir = (key === "player" || key === "team") ? "asc" : "desc";

    render();
  }

  function render() {
    applyFilters();
    sortRows();

    // build leaders UI (if present)
    ensureLeaderButtons();

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
                <td class="playerCell ${state.sortKey === "player" ? "active-stat" : ""}">
                  <div class="cellFlex">
                    ${r.playerLogo ? imgHTML(r.playerLogo, r.player) : `<div class="logo ph"></div>`}
                    <div class="cellText">
                      <div class="cellMain">${r.player}</div>
                    </div>
                  </div>
                </td>

                <td class="teamCell ${state.sortKey === "team" ? "active-stat" : ""}">
                  <div class="cellFlex">
                    ${r.teamLogo ? imgHTML(r.teamLogo, r.team) : `<div class="logo ph"></div>`}
                    <div class="cellText">
                      <div class="cellMain">${r.team || ""}</div>
                    </div>
                  </div>
                </td>

                ${tdNum(r.gp, "gp")}
                ${tdNum(r.score, "score")}
                ${tdNum(r.goals, "goals")}
                ${tdNum(r.assists, "assists")}
                ${tdNum(r.saves, "saves")}
                ${tdNum(r.shots, "shots")}
                <td class="num ${state.sortKey === "ping" ? "active-stat" : ""}">${r.ping || ""}</td>
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

        // keep leaders in sync with what you’re highlighting (but do NOT force ping)
        if (k !== "ping") state.leaderKey = k;

        render();
        if (statusEl) statusEl.textContent = `Loaded ${state.filtered.length} rows`;
      });
    });

    if (statusEl) statusEl.textContent = `Loaded ${state.filtered.length} rows`;

    // update leader card with current filtered rows
    updateLeaderCard();
  }

  async function loadAndBuild() {
    const { seasonUrl, perGameUrl } = getUrls();
    const url = (state.viewMode === "per_game") ? perGameUrl : seasonUrl;

    if (statusEl) statusEl.textContent = "Loading stats…";
    root.innerHTML = `<div class="stats-loading">Loading stats…</div>`;

    const csv = await fetchCsv(url);

    // Map + (optional) infer GP from game_id
    state.rows = inferGPIfMissing(csv.map(toModel));

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
      if (weekEl) seasonEl && weekEl.addEventListener("change", () => { state.week = weekEl.value || "all"; render(); });
      if (teamEl) teamEl.addEventListener("change", () => { state.team = teamEl.value || "all"; render(); });

      if (searchEl) {
        searchEl.addEventListener("input", () => {
          state.query = searchEl.value || "";
          render();
        });
      }

      // Build leader buttons on load (if the container exists)
      ensureLeaderButtons();

      await loadAndBuild();
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = "Failed to load stats";
      root.innerHTML = `<div class="error">Error: ${String(err.message || err)}</div>`;
    }
  }

  init();
})();
