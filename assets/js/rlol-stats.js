// /assets/js/rlol-stats.js
(function () {
  "use strict";

  const CSV_URL = window.RLOL_STATS_CSV || "";
  const FALLBACK_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQCQnxfwBylnd5H8jHc_g9Gtv7wyhzelCLixlK3-Bi_Uw0pVJga8MPtgYf5740Csm7hbfLTJhHGdWzh/pub?gid=1283136814&single=true&output=csv";

  const $ = (s) => document.querySelector(s);
  const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  const tbody = $("#statsBody");
  const table = $("#statsTable");
  const hint  = $("#loadedHint");

  // Leader UI
  const chip  = $("#leaderChip");
  const title = $("#leaderTitle");
  const meta  = $("#leaderMeta");
  const leaderBtns = $("#leaderBtns");

  let rows = [];
  let view = { key: "Score", dir: "desc", q: "", team: "", top: "all" };

  const LEADER_METRICS = [
    { key: "Score",   label: "TOP PTS"   },
    { key: "Goals",   label: "TOP GOALS" },
    { key: "Assists", label: "TOP AST"   },
    { key: "Saves",   label: "TOP SAVES" },
    { key: "Shots",   label: "TOP SHOTS" }
  ];

  function setLoading(msg) {
    // Never crash if markup is missing
    if (!tbody) {
      console.error("Missing #statsBody. Can't render stats table.");
      return;
    }
    tbody.innerHTML = `<tr><td colspan="9" class="loading">${escapeHtml(msg)}</td></tr>`;
  }

  function escapeHtml(s) {
    return (s ?? "").toString()
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function parseCSV(text) {
    const out = [];
    let row = [], cur = "", inQ = false;
    text = String(text || "").replace(/\uFEFF/g, "");

    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (c === '"' && inQ && n === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { row.push(cur); cur = ""; continue; }
      if ((c === "\n" || c === "\r") && !inQ) {
        if (c === "\r" && n === "\n") i++;
        row.push(cur); cur = "";
        if (row.some(v => String(v).trim() !== "")) out.push(row);
        row = [];
        continue;
      }
      cur += c;
    }
    row.push(cur);
    if (row.some(v => String(v).trim() !== "")) out.push(row);
    return out;
  }

  function num(v) {
    const x = Number((v ?? "").toString().replace(/[^\d.-]/g, ""));
    return Number.isFinite(x) ? x : 0;
  }

  function hydrateTeamFilter() {
    const sel = $("#teamFilter");
    if (!sel) return;

    const teams = Array.from(new Set(rows.map(r => r.Team).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));

    sel.innerHTML =
      `<option value="">All teams</option>` +
      teams.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  }

  function applyFilters(data) {
    const q = view.q.trim().toLowerCase();
    let d = data;

    if (view.team) d = d.filter(r => (r.Team || "") === view.team);

    if (q) {
      d = d.filter(r =>
        (r.Player || "").toLowerCase().includes(q) ||
        (r.Team || "").toLowerCase().includes(q)
      );
    }

    if (view.top === "top") d = d.slice(0, 10);
    return d;
  }

  function sortData(data) {
    const key = view.key;
    const dir = view.dir === "asc" ? 1 : -1;

    const isNumeric = ["GP","Score","Goals","Assists","Saves","Shots","Ping"].includes(key);

    return [...data].sort((a, b) => {
      if (isNumeric) return (num(a[key]) - num(b[key])) * dir;
      return String(a[key] || "").localeCompare(String(b[key] || "")) * dir;
    });
  }

  function paintSortIndicators() {
    if (!table) return;
    table.querySelectorAll("thead th").forEach(th => {
      th.classList.remove("sort-asc", "sort-desc");
      const key = th.getAttribute("data-key");
      if (key && key === view.key) th.classList.add(view.dir === "asc" ? "sort-asc" : "sort-desc");
    });
  }

  function updateLeaderCard(data) {
    const top = data[0];
    if (!top) return;

    if (chip)  chip.textContent  = `#1 ${view.key}`;
    if (title) title.textContent = top.Player || "Top Performer";
    if (meta)  meta.textContent  = `${top.Team || "—"} • ${view.key}: ${top[view.key] ?? "—"}`;
  }

  function syncLeaderButtonsActive() {
    if (!leaderBtns) return;
    leaderBtns.querySelectorAll("button[data-metric]").forEach(b => {
      b.classList.toggle("active", b.dataset.metric === view.key);
    });
  }

  function buildLeaderButtons() {
    if (!leaderBtns) return;

    if (leaderBtns.dataset.built !== "1") {
      leaderBtns.dataset.built = "1";
      leaderBtns.innerHTML = "";

      // RESET
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "btn ghost";
      reset.textContent = "RESET";
      reset.dataset.metric = "Score";
      reset.addEventListener("click", () => {
        view = { key: "Score", dir: "desc", q: "", team: "", top: "all" };
        const q = $("#q"), t = $("#teamFilter"), v = $("#viewFilter");
        if (q) q.value = "";
        if (t) t.value = "";
        if (v) v.value = "all";
        paintSortIndicators();
        render();
      });
      leaderBtns.appendChild(reset);

      // Metrics
      LEADER_METRICS.forEach(m => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn pill";
        b.textContent = m.label;
        b.dataset.metric = m.key;
        b.addEventListener("click", () => {
          view.key = m.key;
          view.dir = ["Player","Team"].includes(m.key) ? "asc" : "desc";
          paintSortIndicators();
          render();
        });
        leaderBtns.appendChild(b);
      });
    }

    syncLeaderButtonsActive();
  }

  function render() {
    if (!tbody) return;

    const filtered = applyFilters(sortData(rows));
    if (hint) hint.textContent = `${rows.length} loaded • Showing ${filtered.length}`;

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="loading">No results.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td class="player">${escapeHtml(r.Player)}</td>
        <td class="team">${escapeHtml(r.Team)}</td>
        <td class="num">${escapeHtml(r.GP)}</td>
        <td class="num">${escapeHtml(r.Score)}</td>
        <td class="num">${escapeHtml(r.Goals)}</td>
        <td class="num">${escapeHtml(r.Assists)}</td>
        <td class="num">${escapeHtml(r.Saves)}</td>
        <td class="num">${escapeHtml(r.Shots)}</td>
        <td class="num">${escapeHtml(r.Ping)}</td>
      </tr>
    `).join("");

    updateLeaderCard(filtered);
    buildLeaderButtons();
  }

  function attachSorting() {
    if (!table) return;

    table.querySelectorAll("thead th[data-key]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-key");
        if (!key) return;

        if (view.key === key) {
          view.dir = (view.dir === "asc") ? "desc" : "asc";
        } else {
          view.key = key;
          view.dir = ["Player","Team"].includes(key) ? "asc" : "desc";
        }

        paintSortIndicators();
        render();
      });
    });
  }

  async function load() {
    try {
      setLoading("Loading stats…");
      if (hint) hint.textContent = "Loading…";

      const url = CSV_URL || FALLBACK_CSV_URL;
      if (!url) {
        setLoading("Missing CSV link");
        if (hint) hint.textContent = "Missing CSV link";
        return;
      }

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("CSV fetch failed: " + res.status);
      const text = await res.text();

      const grid = parseCSV(text);
      const headers = (grid.shift() || []).map(h => (h || "").toString().trim());

      // raw rows from CSV
      const raw = grid.map(cols => {
        const o = {};
        headers.forEach((h, i) => o[h] = (cols[i] ?? "").trim());
        return o;
      });

      // aggregate per player_id
      const map = {};
      raw.forEach(r => {
        const p = r.player_id;
        if (!p) return;

        if (!map[p]) {
          map[p] = { Player: p, Team: r.team_id, GP: 0, Score: 0, Goals: 0, Assists: 0, Saves: 0, Shots: 0, PingTotal: 0 };
        }

        map[p].GP++;
        map[p].Score     += Number(r.score   || 0);
        map[p].Goals     += Number(r.goals   || 0);
        map[p].Assists   += Number(r.assists || 0);
        map[p].Saves     += Number(r.saves   || 0);
        map[p].Shots     += Number(r.shots   || 0);
        map[p].PingTotal += Number(r.ping    || 0);
      });

      rows = Object.values(map).map(r => ({
        Player: r.Player,
        Team: r.Team,
        GP: r.GP,
        Score: r.Score,
        Goals: r.Goals,
        Assists: r.Assists,
        Saves: r.Saves,
        Shots: r.Shots,
        Ping: r.GP ? Math.round(r.PingTotal / r.GP) : 0
      }));

      // default sort
      view.key = "Score";
      view.dir = "desc";

      hydrateTeamFilter();
      paintSortIndicators();
      buildLeaderButtons();
      render();
    } catch (err) {
      console.error(err);
      setLoading("Could not load stats. Check CSV link + console.");
      if (hint) hint.textContent = "Load error";
    }
  }

  function wireUI() {
    on($("#q"), "input", (e) => { view.q = e.target.value; render(); });
    on($("#teamFilter"), "change", (e) => { view.team = e.target.value; render(); });
    on($("#viewFilter"), "change", (e) => { view.top = e.target.value; render(); });
    on($("#btnCSV"), "click", load);
  }

  // Boot
  attachSorting();
  wireUI();
  buildLeaderButtons();
  load();
})();
