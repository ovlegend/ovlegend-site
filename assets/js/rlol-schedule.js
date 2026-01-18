// /assets/js/rlol/schedule.js
(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---------- CSV parsing (quoted commas safe) ----------
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (c === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (c === '"') { inQuotes = !inQuotes; continue; }

      if (c === "," && !inQuotes) { row.push(cur); cur = ""; continue; }

      if ((c === "\n" || c === "\r") && !inQuotes) {
        if (c === "\r" && next === "\n") i++;
        row.push(cur);
        cur = "";
        if (row.some((x) => x !== "")) rows.push(row);
        row = [];
        continue;
      }
      cur += c;
    }
    row.push(cur);
    if (row.some((x) => x !== "")) rows.push(row);

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
    const text = await res.text();
    return parseCSV(text);
  }

  // ---------- helpers ----------
  function pick(row, keys, fallback = "") {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return String(row[k]).trim();
    }
    return fallback;
  }

  function normalizeStatus(s) {
    const v = String(s || "").toLowerCase().trim();
    if (!v) return "";
    if (v.includes("live")) return "live";
    if (v.includes("played") || v.includes("complete") || v.includes("final")) return "played";
    if (v.includes("sched")) return "scheduled";
    return v;
  }

  function statusBadge(status) {
    const cls =
      status === "live" ? "badge live" :
      status === "played" ? "badge played" :
      "badge sched";
    const label = status || "scheduled";
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildTeamMap(teamRows) {
    const map = new Map();

    for (const r of teamRows) {
      const id = pick(r, ["team_id", "id", "Team ID", "ID", "team", "Team"], "").trim();
      const name = pick(r, ["name", "team_name", "Team Name", "Team"], id);
      const abbr = pick(r, ["abbr", "abbreviation", "Abbr", "ABBR"], "");
      const logo = pick(r, ["logo", "logo_url", "Logo", "Logo URL", "image", "Image"], "");

      // store by id + by name + by abbr (so schedule can match any)
      const payload = { id: id || name, name, abbr, logo };
      if (id) map.set(id, payload);
      if (name) map.set(name, payload);
      if (abbr) map.set(abbr, payload);
    }

    return map;
  }

  function prettyWeekLabel(raw) {
    const v = String(raw || "").trim();
    if (!v) return "Week ?";
    // If already "Week 1" etc
    if (/week/i.test(v)) return v.replace(/\s+/g, " ").trim();
    // If "w2" or "W2"
    const m = v.match(/^w(\d+)$/i);
    if (m) return `Week ${m[1]}`;
    return v;
  }

  function inferWeek(row) {
    // Try explicit week columns first
    const wk = pick(row, ["week", "Week", "week_num", "Week #", "week_number"], "");
    if (wk) return prettyWeekLabel(wk);

    // Try series_id like s2_w2_m01
    const series = pick(row, ["series_id", "series", "Series", "Series ID"], "");
    const m1 = series.match(/_w(\d+)_/i);
    if (m1) return `Week ${m1[1]}`;

    // Try match_id
    const mid = pick(row, ["match_id", "Match ID", "id"], "");
    const m2 = mid.match(/_w(\d+)_/i);
    if (m2) return `Week ${m2[1]}`;

    return "Week ?";
  }

  function inferDate(row) {
    // you can add keys if your sheet uses different names
    return pick(row, ["date", "Date", "match_date", "Match Date", "day"], "");
  }

  function inferTime(row) {
    return pick(row, ["time", "Time", "match_time", "Match Time"], "");
  }

  function inferHomeAway(row) {
    const homeId = pick(row, ["home_team_id", "home", "home_team", "Home", "Home Team"], "");
    const awayId = pick(row, ["away_team_id", "away", "away_team", "Away", "Away Team"], "");
    return { homeId, awayId };
  }

  function inferScore(row) {
    const hs = pick(row, ["home_score", "Home Score", "home_goals", "Home Goals"], "");
    const as = pick(row, ["away_score", "Away Score", "away_goals", "Away Goals"], "");
    const has = hs !== "" && as !== "";
    return { hs, as, has };
  }

  // ---------- rendering ----------
  function render(groups, opts) {
    const root = $("#scheduleRoot");
    if (!root) return;

    if (!groups.length) {
      root.innerHTML = `<div class="sub">No matches found for current filters.</div>`;
      return;
    }

    root.innerHTML = groups.map(g => {
      const rowsHtml = g.matches.map(m => {
        const home = m.home;
        const away = m.away;

        const logoHome = home.logo
          ? `<img class="logo" src="${escapeHtml(home.logo)}" alt="${escapeHtml(home.name)} logo" loading="lazy" decoding="async">`
          : `<span class="logo"></span>`;

        const logoAway = away.logo
          ? `<img class="logo" src="${escapeHtml(away.logo)}" alt="${escapeHtml(away.name)} logo" loading="lazy" decoding="async">`
          : `<span class="logo"></span>`;

        const score = m.score.has
          ? `<span class="badge played"><span class="num">${escapeHtml(m.score.hs)}–${escapeHtml(m.score.as)}</span></span>`
          : "";

        return `
          <tr>
            <td class="hideMobile">${escapeHtml(m.date || "")}</td>
            <td class="hideMobile">${escapeHtml(m.time || "")}</td>
            <td>
              <div class="matchCell">
                <div class="teamChip">
                  ${logoHome}
                  <span class="teamName">${escapeHtml(home.name)}</span>
                </div>
                <span class="vs">vs</span>
                <div class="teamChip">
                  ${logoAway}
                  <span class="teamName">${escapeHtml(away.name)}</span>
                </div>
              </div>
            </td>
            <td class="right">
              ${statusBadge(m.status)}
              ${score}
            </td>
          </tr>
        `;
      }).join("");

      return `
        <div class="card">
          <div class="weekTitle">
            <h2>${escapeHtml(g.week)}</h2>
            <div class="small">${g.matches.length} match${g.matches.length === 1 ? "" : "es"}</div>
          </div>

          <table>
            <thead>
              <tr>
                <th class="hideMobile">Date</th>
                <th class="hideMobile">Time</th>
                <th>Matchup</th>
                <th class="right">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }).join("");
  }

  function groupAndFilter(allMatches, weekValue, statusValue, searchValue) {
    const weekFilter = String(weekValue || "all");
    const statusFilter = String(statusValue || "all");
    const q = String(searchValue || "").toLowerCase().trim();

    const filtered = allMatches.filter(m => {
      if (weekFilter !== "all" && m.week !== weekFilter) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;

      if (q) {
        const hay = [
          m.home.name, m.home.id, m.home.abbr,
          m.away.name, m.away.id, m.away.abbr,
          m.week, m.status
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    // group by week in original order
    const order = [];
    const map = new Map();
    for (const m of filtered) {
      if (!map.has(m.week)) { map.set(m.week, []); order.push(m.week); }
      map.get(m.week).push(m);
    }

    return order.map(w => ({ week: w, matches: map.get(w) || [] }));
  }

  function setStatusText(msg) {
    const el = $("#schedStatusText");
    if (el) el.textContent = msg;
  }

  function fillWeekDropdown(weeks) {
    const sel = $("#weekFilter");
    if (!sel) return;

    const current = sel.value || "all";
    sel.innerHTML = `<option value="all">All weeks</option>` + weeks
      .map(w => `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`)
      .join("");

    // keep selection if possible
    sel.value = weeks.includes(current) ? current : "all";
  }

  // ---------- main ----------
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      if (!window.OV_CONFIG?.rlol?.teamsCsv || !window.OV_CONFIG?.rlol?.scheduleCsv) {
        throw new Error("Missing OV_CONFIG rlol CSV links (config.js not loaded?)");
      }

      setStatusText("Loading teams + schedule…");

      const [teamRows, scheduleRows] = await Promise.all([
        fetchCsv(window.OV_CONFIG.rlol.teamsCsv),
        fetchCsv(window.OV_CONFIG.rlol.scheduleCsv)
      ]);

      const teamMap = buildTeamMap(teamRows);

      // Normalize schedule rows into matches
      const matches = scheduleRows.map(r => {
        const { homeId, awayId } = inferHomeAway(r);

        const home = teamMap.get(homeId) || teamMap.get(pick(r, ["home_team", "Home Team"], "")) || { id: homeId || "TBD", name: homeId || "TBD", abbr: "", logo: "" };
        const away = teamMap.get(awayId) || teamMap.get(pick(r, ["away_team", "Away Team"], "")) || { id: awayId || "TBD", name: awayId || "TBD", abbr: "", logo: "" };

        const week = inferWeek(r);
        const status = normalizeStatus(pick(r, ["status", "Status"], "scheduled")) || "scheduled";
        const date = inferDate(r);
        const time = inferTime(r);
        const score = inferScore(r);

        return {
          raw: r,
          week,
          status,
          date,
          time,
          home,
          away,
          score
        };
      });

      // Build Week dropdown list (preserve order)
      const weekOrder = [];
      const seen = new Set();
      for (const m of matches) {
        if (!seen.has(m.week)) { seen.add(m.week); weekOrder.push(m.week); }
      }
      fillWeekDropdown(weekOrder);

      setStatusText(`Loaded ${matches.length} matches`);

      // Initial render
      const doRender = () => {
        const groups = groupAndFilter(
          matches,
          $("#weekFilter")?.value,
          $("#statusFilter")?.value,
          $("#searchInput")?.value
        );
        render(groups);
      };

      // Wire controls
      $("#weekFilter")?.addEventListener("change", doRender);
      $("#statusFilter")?.addEventListener("change", doRender);
      $("#searchInput")?.addEventListener("input", doRender);

      doRender();

    } catch (err) {
      console.error(err);
      setStatusText(`Error: ${err.message}`);
      const root = $("#scheduleRoot");
      if (root) root.innerHTML = `<div class="sub">Could not load schedule. Check console for details.</div>`;
    }
  });
})();
