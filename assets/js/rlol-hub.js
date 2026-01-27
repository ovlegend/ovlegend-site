// /assets/js/rlol-hub.js
(function () {
  const nextMatchesEl = document.getElementById("nextMatches");
  const standingsEl = document.getElementById("standingsPreview");
  const leadersEl = document.getElementById("statsLeaders");

  if (!window.OV_CONFIG || !window.OV_CONFIG.rlol) {
    console.error("Missing OV_CONFIG.rlol in /assets/js/config.js");
    return;
  }

  const scheduleURL = window.OV_CONFIG.rlol.scheduleCsv;
  const standingsURL = window.OV_CONFIG.rlol.standingsCsv || window.OV_CONFIG.rlol.standingsViewCsv;
  const statsURL = window.OV_CONFIG.rlol.playerSeasonStatsCsv;

  // ---------- CSV parsing (quoted commas safe) ----------
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const n = text[i + 1];

      if (c === '"' && inQuotes && n === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQuotes = !inQuotes; continue; }

      if (c === "," && !inQuotes) { row.push(cur); cur = ""; continue; }

      if ((c === "\n" || c === "\r") && !inQuotes) {
        if (c === "\r" && n === "\n") i++;
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
        continue;
      }

      cur += c;
    }

    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function normKey(s) {
    // NOTE: strips underscores, so "home_team_id" -> "hometeamid"
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function rowsToObjects(csvText) {
    const rows = parseCSV(csvText);
    const headers = (rows.shift() || []).map(normKey);

    return rows
      .filter(r => r.some(cell => String(cell || "").trim() !== ""))
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = (r[i] || "").trim());
        return obj;
      });
  }

  function pick(obj, keys, fallback = "") {
    for (const k of keys) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return fallback;
  }

  function toNum(v) {
    const n = Number(String(v || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  // ---------- UI helpers ----------
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---------- Render: Next Matches ----------
  function renderNextMatches(scheduleRows) {
    if (!nextMatchesEl) return;
    nextMatchesEl.innerHTML = "";

    // Map to YOUR schedule sheet columns (after normKey)
    const mapped = scheduleRows.map(r => {
      const week   = pick(r, ["week"]);
      const status = pick(r, ["status"], "scheduled");
      const date   = pick(r, ["scheduleddate", "matchdate", "date"]);
      const time   = pick(r, ["scheduledtime", "time", "starttime", "start"]);
      const team1  = pick(r, ["hometeamid", "home", "team1"]);
      const team2  = pick(r, ["awayteamid", "away", "team2"]);
      const note   = pick(r, ["notes", "note"], "");
      return { week, status, date, time, team1, team2, note };
    });

    // Parse for sorting (YYYY-MM-DD + HH:MM)
    function toStamp(m) {
      const d = String(m.date || "").trim();
      const t = String(m.time || "").trim();
      if (!d) return Number.MAX_SAFE_INTEGER;
      const iso = t ? `${d}T${t}:00` : `${d}T23:59:59`;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
    }

    // Upcoming = not played/final/done + has both teams
    const upcoming = mapped
      .filter(m => m.team1 && m.team2)
      .filter(m => {
        const s = String(m.status || "").toLowerCase();
        return !(s.includes("played") || s.includes("final") || s.includes("done"));
      })
      .sort((a, b) => toStamp(a) - toStamp(b))
      .slice(0, 4);

    if (!upcoming.length) {
      nextMatchesEl.innerHTML = `<div class="empty">No upcoming matches</div>`;
      return;
    }

    upcoming.forEach((m, idx) => {
      const dayLabel = m.date ? m.date : "TBD";
      const clock = m.time || "—";
      const meta = m.week
        ? `Week ${m.week}${m.note ? " • " + m.note : ""}`
        : (m.note || "");

      const row = document.createElement("div");
      row.className = `match-row ${idx === 0 ? "playoff-glow" : ""}`;

      row.innerHTML = `
        <div class="match-left">
          <div class="match-time">
            <div class="day">${esc(dayLabel)}</div>
            <div class="clock">${esc(clock)}</div>
          </div>
          <div class="match-info">
            <div class="match-teams">
              <span class="team">${esc(m.team1)}</span>
              <span class="vs">vs</span>
              <span class="team">${esc(m.team2)}</span>
            </div>
            <div class="match-meta">${esc(meta)}</div>
          </div>
        </div>
        <a class="mini-link" href="/rlol/schedule/">Details</a>
      `;

      nextMatchesEl.appendChild(row);
    });
  }

  // ---------- Render: Standings Preview ----------
  function renderStandings(standingRows) {
    if (!standingsEl) return;

    standingsEl.innerHTML = `
      <div class="trow thead">
        <div>#</div><div>Team</div><div class="num">W</div><div class="num">L</div><div class="num">PTS</div>
      </div>
    `;

    const mapped = standingRows.map(r => {
      const rank = pick(r, ["rank", "pos", "position", "place", "#"]);
      const team = pick(r, ["team", "name", "teamname"]);
      const w = pick(r, ["w", "wins"]);
      const l = pick(r, ["l", "losses"]);
      const pts = pick(r, ["pts", "points", "p"]);
      return { rank, team, w, l, pts };
    }).filter(x => x.team);

    mapped.sort((a, b) => (toNum(b.pts) - toNum(a.pts)) || (toNum(b.w) - toNum(a.w)));

    const top = mapped.slice(0, 8);
    const playoffCut = 4;

    top.forEach((t, i) => {
      if (i === playoffCut) {
        const line = document.createElement("div");
        line.className = "playoff-line";
        line.textContent = "PLAYOFF LINE";
        standingsEl.appendChild(line);
      }

      const row = document.createElement("div");
      row.className = `trow ${i < playoffCut ? "playoff-glow" : ""}`;

      row.innerHTML = `
        <div>${esc(String(i + 1))}</div>
        <div class="teamcell"><span class="dot"></span>${esc(t.team)}</div>
        <div class="num">${esc(t.w || "0")}</div>
        <div class="num">${esc(t.l || "0")}</div>
        <div class="num">${esc(t.pts || String((toNum(t.w) * 3) || 0))}</div>
      `;

      standingsEl.appendChild(row);
    });
  }

  // ---------- Render: Stats Leaders ----------
  function renderLeaders(statRows) {
    if (!leadersEl) return;
    leadersEl.innerHTML = "";

    const mapped = statRows.map(r => {
      const player = pick(r, ["player", "name", "playername", "username"]);
      const team = pick(r, ["team", "teamname"]);
      const goals = toNum(pick(r, ["g", "goals"]));
      const assists = toNum(pick(r, ["a", "assists"]));
      const saves = toNum(pick(r, ["saves", "sv"]));
      const score = toNum(pick(r, ["score", "pts", "points"]));
      return { player, team, goals, assists, saves, score };
    }).filter(x => x.player);

    const cats = [
      { key: "goals", label: "Goals" },
      { key: "assists", label: "Assists" },
      { key: "saves", label: "Saves" },
      { key: "score", label: "Score" }
    ];

    cats.forEach((c, idx) => {
      const best = mapped.slice().sort((a, b) => b[c.key] - a[c.key])[0];

      const row = document.createElement("div");
      row.className = `leader-row ${idx === 0 ? "playoff-glow" : ""}`;

      if (!best || best[c.key] <= 0) {
        row.classList.add("dim");
        row.innerHTML = `
          <div class="leader-main">
            <div class="leader-name">—</div>
            <div class="leader-sub">No data • ${esc(c.label)}</div>
          </div>
          <div class="leader-val">—</div>
        `;
      } else {
        row.innerHTML = `
          <div class="leader-main">
            <div class="leader-name">${esc(best.player)}</div>
            <div class="leader-sub">${esc(best.team || "Team")} • ${esc(c.label)}</div>
          </div>
          <div class="leader-val">${esc(best[c.key])}</div>
        `;
      }

      leadersEl.appendChild(row);
    });
  }

  // ---------- Fetch & hydrate ----------
  async function fetchCSV(url) {
    if (!url) throw new Error("Missing CSV url");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
    return res.text();
  }

  (async function init() {
    try {
      const [schedText, standText, statText] = await Promise.all([
        fetchCSV(scheduleURL),
        fetchCSV(standingsURL),
        fetchCSV(statsURL)
      ]);

      const schedRows = rowsToObjects(schedText);
      const standRows = rowsToObjects(standText);
      const statRows = rowsToObjects(statText);

      renderNextMatches(schedRows);
      renderStandings(standRows);
      renderLeaders(statRows);

    } catch (e) {
      console.error(e);
      if (nextMatchesEl) nextMatchesEl.innerHTML = `<div class="empty">Unable to load schedule</div>`;
      if (standingsEl) standingsEl.innerHTML = `<div class="empty">Unable to load standings</div>`;
      if (leadersEl) leadersEl.innerHTML = `<div class="empty">Unable to load stats</div>`;
    }
  })();
})();
