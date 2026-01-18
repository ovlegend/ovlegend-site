(function () {
  function splitCSVLine(line) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur); cur = "";
      } else cur += ch;
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

  function toISODateKey(s) { return (s || "").slice(0, 10); }

  function prettyDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function buildTeamMap(teamsRows) {
    var map = new Map();
    for (var i = 0; i < teamsRows.length; i++) {
      var r = teamsRows[i];
      var id = r.team_id;
      if (!id) continue;
      var name = r.Team || r.team_name || r.team || id;
      var logo = r.logo_url || "";
      map.set(id, { id: id, name: name, logo: logo });
    }
    return map;
  }

  function normalizeStatus(s) { return String(s || "").toLowerCase().trim(); }

  function matchSearchText(m, teamMap) {
    var home = (teamMap.get(m.home_team_id) || {}).name || m.home_team_id;
    var away = (teamMap.get(m.away_team_id) || {}).name || m.away_team_id;
    return (home + " " + away + " " + m.home_team_id + " " + m.away_team_id).toLowerCase();
  }

  function badgeForStatus(status) {
    if (status === "played") return '<span class="badge played">✅ Played</span>';
    if (status === "scheduled") return '<span class="badge sched">🗓️ Scheduled</span>';
    if (status === "postponed") return '<span class="badge">⏸️ Postponed</span>';
    if (status === "cancelled") return '<span class="badge">🛑 Cancelled</span>';
    return '<span class="badge">' + (status || "—") + '</span>';
  }

  function isTonight(isoDate) {
    if (!isoDate) return false;
    var now = new Date();
    var d = new Date(isoDate + "T00:00:00");
    return now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
  }

  function groupByWeek(scheduleRows) {
    var weeks = new Map();
    for (var i = 0; i < scheduleRows.length; i++) {
      var m = scheduleRows[i];
      var wk = Number(m.week || 0);
      if (!weeks.has(wk)) weeks.set(wk, []);
      weeks.get(wk).push(m);
    }
    weeks.forEach(function (arr) {
      arr.sort(function (a, b) { return String(a.match_id).localeCompare(String(b.match_id)); });
    });
    return Array.from(weeks.entries()).sort(function (a, b) { return a[0] - b[0]; });
  }

  function renderWeeks(teamMap, scheduleRows) {
    var weeksEl = document.getElementById("weeks");
    weeksEl.innerHTML = "";

    var byWeek = groupByWeek(scheduleRows);

    for (var w = 0; w < byWeek.length; w++) {
      var wk = byWeek[w][0];
      var matches = byWeek[w][1];

      var dateKey = toISODateKey((matches[0] || {}).scheduled_date);
      var time = (matches[0] || {}).scheduled_time || "18:00";
      var tz = (matches[0] || {}).timezone || "EST";

      var weekCard = document.createElement("div");
      weekCard.className = "card";

      var tonight = isTonight(dateKey);

      weekCard.innerHTML =
        '<div class="weekTitle">' +
          '<h2>Week ' + wk + '</h2>' +
          '<div class="small">' +
            (dateKey ? (prettyDate(dateKey) + " • Stream starts " + time + " " + tz) : "Date TBD") +
            (tonight ? ' • <span class="badge live">⚡ Tonight</span>' : "") +
          '</div>' +
        '</div>' +
        '<div style="overflow:auto;">' +
          '<table>' +
            '<thead>' +
              '<tr>' +
                '<th>Match</th>' +
                '<th class="right">Series</th>' +
                '<th class="right hideMobile">Goals</th>' +
                '<th class="right">Status</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody></tbody>' +
          '</table>' +
        '</div>';

      var tbody = weekCard.querySelector("tbody");

      for (var i = 0; i < matches.length; i++) {
        var m = matches[i];

        var home = teamMap.get(m.home_team_id) || { name: m.home_team_id, logo: "" };
        var away = teamMap.get(m.away_team_id) || { name: m.away_team_id, logo: "" };

        var status = normalizeStatus(m.status);
        var series = String(m.series_score || "").trim();
        var hs = String(m.home_score || "").trim();
        var as = String(m.away_score || "").trim();

        var goalsText = (hs !== "" || as !== "") ? ((hs || 0) + "–" + (as || 0)) : "—";
        var seriesText = series ? series : "—";

        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td>' +
            '<div class="matchCell">' +
              '<div class="teamChip">' +
                '<img class="logo" src="' + (home.logo || "") + '" alt="' + home.name + ' logo" loading="lazy">' +
                '<span class="teamName">' + home.name + '</span>' +
              '</div>' +
              '<span class="vs">vs</span>' +
              '<div class="teamChip">' +
                '<img class="logo" src="' + (away.logo || "") + '" alt="' + away.name + ' logo" loading="lazy">' +
                '<span class="teamName">' + away.name + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="footer">Match ID: <span class="num">' + (m.match_id || "") + '</span></div>' +
          '</td>' +
          '<td class="right num">' + seriesText + '</td>' +
          '<td class="right num hideMobile">' + goalsText + '</td>' +
          '<td class="right">' + badgeForStatus(status) + '</td>';

        tbody.appendChild(tr);
      }

      weeksEl.appendChild(weekCard);
    }
  }

  function applyFilters(teamMap, rawSchedule) {
    var statusChoice = document.getElementById("statusFilter").value;
    var q = document.getElementById("searchBox").value.trim().toLowerCase();

    var rows = rawSchedule.slice();

    if (statusChoice !== "all") {
      rows = rows.filter(function (r) { return normalizeStatus(r.status) === statusChoice; });
    }
    if (q) {
      rows = rows.filter(function (r) { return matchSearchText(r, teamMap).indexOf(q) !== -1; });
    }

    var total = rawSchedule.length;
    var played = rawSchedule.filter(function (r) { return normalizeStatus(r.status) === "played"; }).length;
    var scheduled = rawSchedule.filter(function (r) { return normalizeStatus(r.status) === "scheduled"; }).length;

    document.getElementById("counts").textContent =
      "Matches: " + rows.length + " shown • " + scheduled + " scheduled • " + played + " played • " + total + " total";

    renderWeeks(teamMap, rows);
  }

  function main() {
    if (!window.OV_CONFIG || !window.OV_CONFIG.rlol) {
      console.error("OV_CONFIG not found");
      document.getElementById("asOf").textContent = "Missing config.";
      return;
    }

    var TEAMS_CSV_URL = window.OV_CONFIG.rlol.teamsCsv;
    var SCHEDULE_CSV_URL = window.OV_CONFIG.rlol.scheduleCsv;

    Promise.all([fetchCSV(TEAMS_CSV_URL), fetchCSV(SCHEDULE_CSV_URL)])
      .then(function (res) {
        var teamsRows = res[0];
        var scheduleRows = res[1];

        var teamMap = buildTeamMap(teamsRows);

        scheduleRows.sort(function (a, b) {
          return (Number(a.week || 0) - Number(b.week || 0)) ||
                 String(a.match_id).localeCompare(String(b.match_id));
        });

        var now = new Date();
        document.getElementById("asOf").textContent =
          "Updated " + now.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" });

        var rawSchedule = scheduleRows;

        var rerender = function () { applyFilters(teamMap, rawSchedule); };
        document.getElementById("statusFilter").addEventListener("change", rerender);
        document.getElementById("searchBox").addEventListener("input", rerender);

        rerender();
      })
      .catch(function (err) {
        console.error(err);
        document.getElementById("asOf").textContent = "Failed to load schedule.";
      });
  }

  main();
})();
