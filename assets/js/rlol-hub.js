(function () {
  // ---------- small helpers ----------
  function splitCSVLine(line) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    text = String(text || "").replace(/\uFEFF/g, "");
    var lines = text.trim().split(/\r?\n/).filter(function (x) { return x && x.trim(); });
    if (!lines.length) return [];

    var headers = splitCSVLine(lines[0]).map(function (h) { return h.trim(); });
    var rows = [];

    for (var i = 1; i < lines.length; i++) {
      var cols = splitCSVLine(lines[i]);
      var row = {};
      for (var j = 0; j < headers.length; j++) row[headers[j]] = (cols[j] || "").trim();
      rows.push(row);
    }
    return rows;
  }

  function fetchCSV(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (res) { if (!res.ok) throw new Error("Fetch failed: " + res.status); return res.text(); })
      .then(parseCSV);
  }

  function normalizeStatus(s) { return String(s || "").toLowerCase().trim(); }

  function toISODateKey(s) { return (s || "").slice(0, 10); }

  function prettyDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function todayISO() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    var d = String(now.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function buildTeamMap(teamsRows) {
    var map = new Map();
    for (var i = 0; i < teamsRows.length; i++) {
      var r = teamsRows[i];
      var id = r.team_id || r.id || r.TeamID || r.team || "";
      if (!id) continue;
      var name = r.team_name || r.Team || r.team || id;
      var logo = r.logo_url || r.logo || "";
      map.set(id, { id: id, name: name, logo: logo });
    }
    return map;
  }

  function el(id) { return document.getElementById(id); }

  function safeText(node, text) {
    if (!node) return;
    node.textContent = text;
  }

  // ---------- HUB: Next Match Night ----------
  function findNextMatchDate(scheduleRows) {
    // Choose earliest scheduled_date >= today where status is not played/cancelled (fallback: any future)
    var today = todayISO();
    var best = null;

    for (var i = 0; i < scheduleRows.length; i++) {
      var r = scheduleRows[i];
      var dateKey = toISODateKey(r.scheduled_date || r.date || "");
      if (!dateKey) continue;

      var st = normalizeStatus(r.status);
      if (dateKey < today) continue;

      // Prefer rows that are scheduled/postponed (not played/cancelled)
      var ok = (st !== "played" && st !== "cancelled");
      if (!ok) continue;

      if (best === null || dateKey < best) best = dateKey;
    }

    // Fallback: any future date
    if (best === null) {
      for (var j = 0; j < scheduleRows.length; j++) {
        var rr = scheduleRows[j];
        var dk = toISODateKey(rr.scheduled_date || rr.date || "");
        if (!dk) continue;
        if (dk < today) continue;
        if (best === null || dk < best) best = dk;
      }
    }

    return best;
  }

  function renderNextMatchNight(teamMap, scheduleRows) {
    var nextMeta = el("nextMeta");
    var nextMatches = el("nextMatches");
    if (nextMatches) nextMatches.innerHTML = "";

    if (!scheduleRows.length) {
      safeText(nextMeta, "No schedule rows found.");
      return;
    }

    var nextDate = findNextMatchDate(scheduleRows);
    if (!nextDate) {
      safeText(nextMeta, "No upcoming match night found.");
      return;
    }

    // Matches for that date
    var matches = scheduleRows.filter(function (r) {
      return toISODateKey(r.scheduled_date || r.date || "") === nextDate;
    });

    // Sort by match_id (string)
    matches.sort(function (a, b) {
      return String(a.match_id || "").localeCompare(String(b.match_id || ""));
    });

    // meta line
    var time = (matches[0] && (matches[0].scheduled_time || matches[0].time)) || "18:00";
    var tz = (matches[0] && (matches[0].timezone || matches[0].tz)) || "ET";

    safeText(
      nextMeta,
      "Next Match Night: " + prettyDate(nextDate) + " • stream starts " + time + " " + tz
    );

    if (!nextMatches) return;

    // Render list
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];

      var homeId = m.home_team_id || m.home || m.home_team || "";
      var awayId = m.away_team_id || m.away || m.away_team || "";

      var home = teamMap.get(homeId) || { name: homeId || "TBD", logo: "" };
      var away = teamMap.get(awayId) || { name: awayId || "TBD", logo: "" };   
      var series = (m.series_id || m.series || "").trim();
      var status = normalizeStatus(m.status);

      var item = document.createElement("div");
      item.className = "match-item next-match";

      item.innerHTML =
        '<div class="match-left">' +
          (home.logo ? ('<img class="team-logo" src="' + home.logo + '" alt="' + home.name + ' logo" loading="lazy">') : '<div class="team-logo ph"></div>') +
          '<div class="match-names">' +
            '<div class="match-team"><span class="team-name">' + home.name + '</span></div>' +
            '<div class="match-vs">vs</div>' +
            '<div class="match-team"><span class="team-name">' + away.name + '</span></div>' +
          '</div>' +
          (away.logo ? ('<img class="team-logo" src="' + away.logo + '" alt="' + away.name + ' logo" loading="lazy">') : '<div class="team-logo ph"></div>') +
        '</div>' +
        '<div class="match-right">' +
          (series ? ('<div class="pill soft">Series ' + series + '</div>') : '') +
          (status ? ('<div class="pill status">' + status + '</div>') : '') +
        '</div>';

      nextMatches.appendChild(item);
    }
  }

  // ---------- HUB: Standings Snapshot (Top 4) ----------
  function numberOrZero(x) {
    var n = Number(String(x || "").replace(/[^\d\.\-]/g, ""));
    return isFinite(n) ? n : 0;
  }

  function renderTop4(teamMap, standingsRows) {
    var standMeta = el("standMeta");
    var tbody = el("top4");
    if (tbody) tbody.innerHTML = "";

    if (!standingsRows.length) {
      safeText(standMeta, "No standings rows found.");
      return;
    }

    // Try to normalize common columns
    // Accepts: W/L, wins/losses, GD/goal_diff
    var normalized = standingsRows.map(function (r) {
      var teamId = r.team_id || r.team || r.teamId || r.TeamID || "";
      var teamName = r.team_name || r.Team || r.team || teamId;

      var w = r.W || r.wins || r.win || r.w || 0;
      var l = r.L || r.losses || r.loss || r.l || 0;

      var gd = r.GD || r.goal_diff || r.goaldiff || r.gd || r["Goal Diff"] || 0;

      return {
        team_id: teamId,
        team_name: teamName,
        W: numberOrZero(w),
        L: numberOrZero(l),
        GD: numberOrZero(gd)
      };
    });

    // Sort by W desc, then GD desc (fallback behavior)
    normalized.sort(function (a, b) {
      return (b.W - a.W) || (b.GD - a.GD) || String(a.team_name).localeCompare(String(b.team_name));
    });

    // meta updated
    var now = new Date();
    safeText(standMeta, "Auto-updates from match results • Updated " + now.toLocaleDateString(undefined, { month: "short", day: "numeric" }));

    if (!tbody) return;

    var top = normalized.slice(0, 4);
    for (var i = 0; i < top.length; i++) {
      var row = top[i];
      var team = teamMap.get(row.team_id) || { name: row.team_name, logo: "" };

      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td>' +
          '<div class="team-cell">' +
            (team.logo ? ('<img class="mini-logo" src="' + team.logo + '" alt="' + (team.name || row.team_name) + ' logo" loading="lazy">') : '<span class="mini-logo ph"></span>') +
            '<span class="team-label">' + (team.name || row.team_name) + '</span>' +
          '</div>' +
        '</td>' +
        '<td class="right nowrap">' + row.W + '-' + row.L + '</td>' +
        '<td class="right nowrap">' + row.GD + '</td>';

      tbody.appendChild(tr);
    }
  }

  // ---------- main ----------
  function main() {
    // year footer
    var y = document.getElementById("year");
    if (y) y.textContent = String(new Date().getFullYear());

    if (!window.OV_CONFIG || !window.OV_CONFIG.rlol) {
      console.error("OV_CONFIG not found");
      safeText(el("nextMeta"), "Missing config.");
      safeText(el("standMeta"), "Missing config.");
      return;
    }

    var cfg = window.OV_CONFIG.rlol;

    var teamsUrl = cfg.teamsCsv;
    var scheduleUrl = cfg.scheduleCsv;
    // For hub snapshot, prefer standingsViewCsv (usually has nicer view columns)
    var standingsUrl = cfg.standingsViewCsv || cfg.standingsCsv;

    Promise.all([fetchCSV(teamsUrl), fetchCSV(scheduleUrl), fetchCSV(standingsUrl)])
      .then(function (res) {
        var teamsRows = res[0];
        var scheduleRows = res[1];
        var standingsRows = res[2];

        var teamMap = buildTeamMap(teamsRows);

        // schedule sort: date asc, then match_id
        scheduleRows.sort(function (a, b) {
          var ad = toISODateKey(a.scheduled_date || a.date || "");
          var bd = toISODateKey(b.scheduled_date || b.date || "");
          return String(ad).localeCompare(String(bd)) ||
                 String(a.match_id || "").localeCompare(String(b.match_id || ""));
        });

        renderNextMatchNight(teamMap, scheduleRows);
        renderTop4(teamMap, standingsRows);
      })
      .catch(function (err) {
        console.error(err);
        safeText(el("nextMeta"), "Failed to load match night.");
        safeText(el("standMeta"), "Failed to load standings.");
      });
  }

  main();
})();

// /assets/js/rlol-hub-stats-preview.js
(function () {
  const $ = (sel) => document.querySelector(sel);

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
        row.push(cur); cur = "";
        if (row.some(x => String(x).trim() !== "")) rows.push(row);
        row = [];
        continue;
      }
      cur += c;
    }
    row.push(cur);
    if (row.some(x => String(x).trim() !== "")) rows.push(row);

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

  function num(v, fallback = 0) {
    const s = String(v ?? "").trim();
    if (!s) return fallback;
    const n = Number(s.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }

  function pick(row, keys, fb = "") {
    for (const k of keys) {
      const val = row[k];
      if (val !== undefined && val !== null && String(val).trim() !== "") return String(val).trim();
    }
    return fb;
  }

  async function fetchCsv(url) {
    if (!url) throw new Error("Stats CSV missing (OV_CONFIG.rlol.playerSeasonStatsCsv)");
    const busted = url + (url.includes("?") ? "&" : "?") + "v=" + Date.now();
    const res = await fetch(busted, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching stats CSV`);
    return parseCSV(await res.text());
  }

  function bestBy(rows, valueKeyCandidates) {
    let best = null;
    let bestVal = -Infinity;
    for (const r of rows) {
      const v = num(pick(r, valueKeyCandidates, "0"), 0);
      if (v > bestVal) { bestVal = v; best = r; }
    }
    return { row: best, val: bestVal };
  }

function renderRow(label, whoName, teamName, value, avatarUrl) {
  const img = avatarUrl
    ? `<img class="avatar" src="${avatarUrl}" alt="" loading="lazy" />`
    : "";

  return `
    <div class="stat-row">
      <div>
        <div class="label">${label}</div>
        <div class="who">
          ${img}
          <div class="name">${whoName || teamName || "—"}</div>
        </div>
      </div>
      <div class="value">${Number.isFinite(value) ? value : ""}</div>
    </div>
  `;
}

  async function init() {
    const mount = $("#statsPreview");
    if (!mount) return;

    try {
      const cfg = window.OV_CONFIG && window.OV_CONFIG.rlol;
      const rows = await fetchCsv(cfg && cfg.playerSeasonStatsCsv);

      // These column guesses cover most sheets:
      const nameKey = ["player", "Player", "player_name", "Player Name", "name", "Name"];
      const teamKey = ["team", "Team", "team_name", "Team Name"];
      const avatarKey = ["avatar", "avatar_url", "pfp", "photo", "image", "img"];

      const topScore = bestBy(rows, ["score", "Score", "pts", "PTS", "points", "Points"]);
      const topGoals = bestBy(rows, ["g", "G", "goals", "Goals"]);
      const topAssists = bestBy(rows, ["a", "A", "assists", "Assists"]);
      const topSaves = bestBy(rows, ["saves", "Saves", "sv", "SV"]);

      mount.innerHTML = [
        (() => {
          const r = topScore.row || {};
          return renderRow(
            "Top Score",
            pick(r, nameKey, ""),
            pick(r, teamKey, ""),
            topScore.val,
            pick(r, avatarKey, "")
          );
        })(),
        (() => {
          const r = topGoals.row || {};
          return renderRow(
            "Goals Leader",
            pick(r, nameKey, ""),
            pick(r, teamKey, ""),
            topGoals.val,
            pick(r, avatarKey, "")
          );
        })(),
        (() => {
          const r = topAssists.row || {};
          return renderRow(
            "Assists Leader",
            pick(r, nameKey, ""),
            pick(r, teamKey, ""),
            topAssists.val,
            pick(r, avatarKey, "")
          );
        })(),
        (() => {
          const r = topSaves.row || {};
          return renderRow(
            "Saves Leader",
            pick(r, nameKey, ""),
            pick(r, teamKey, ""),
            topSaves.val,
            pick(r, avatarKey, "")
          );
        })(),
      ].join("");
    } catch (err) {
      console.error(err);
      mount.innerHTML = `<div class="stats-preview__loading">Stats preview failed: ${String(err.message || err)}</div>`;
    }
  }

  init();
})();
