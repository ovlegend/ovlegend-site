// /assets/js/rlol-schedule.js
(function () {

  OV_CONFIG.scheduleCSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQCQnxfwBylnd5H8jHc_g9Gtv7wyhzelCLixlK3-Bi_Uw0pVJga8MPtgYf5740Csm7hbfLTJhHGdWzh/pub?gid=907396704&single=true&output=csv";

  const root = document.getElementById("scheduleRoot");
  const weekFilter = document.getElementById("weekFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");
  const statusText = document.getElementById("schedStatusText");

  let matches = [];

  /* ---------------- CSV PARSER (safe with quotes) ---------------- */

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

      if (c === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (c === "," && !inQuotes) {
        row.push(cur);
        cur = "";
        continue;
      }

      if ((c === "\n" || c === "\r") && !inQuotes) {
        if (c === "\r" && next === "\n") i++;
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
        continue;
      }

      cur += c;
    }

    if (cur.length || row.length) {
      row.push(cur);
      rows.push(row);
    }

    return rows;
  }

  /* ---------------- FETCH + BUILD ---------------- */

  fetch(CSV_URL)
    .then(r => r.text())
    .then(text => {
      const rows = parseCSV(text);

      const headers = rows.shift().map(h => h.trim().toLowerCase());

      matches = rows.map(r => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = (r[i] || "").trim());
        return obj;
      });

      buildWeekFilter();
      updateStatusPill();
      render();

      weekFilter.addEventListener("change", render);
      statusFilter.addEventListener("change", render);
      searchInput.addEventListener("input", render);
    })
    .catch(err => {
      console.error("Schedule load failed", err);
      statusText.textContent = "Failed to load schedule";
    });

  /* ---------------- FILTER UI ---------------- */

  function buildWeekFilter() {
    const weeks = [...new Set(matches.map(m => m.week).filter(Boolean))];

    weeks.sort((a,b) => {
      const na = parseInt(a.replace(/\D/g,"")) || 0;
      const nb = parseInt(b.replace(/\D/g,"")) || 0;
      return na - nb;
    });

    weeks.forEach(w => {
      const opt = document.createElement("option");
      opt.value = w;
      opt.textContent = w;
      weekFilter.appendChild(opt);
    });
  }

  /* ---------------- STATUS PILL ---------------- */

  function updateStatusPill() {
    const live = matches.filter(m => m.status.toLowerCase() === "live").length;

    if (live > 0) {
      statusText.textContent = `${live} match${live>1?"es":""} live now`;
    } else {
      statusText.textContent = `${matches.length} total matches`;
    }
  }

  /* ---------------- RENDER ---------------- */

  function render() {

    const weekVal = weekFilter.value;
    const statusVal = statusFilter.value;
    const q = searchInput.value.toLowerCase();

    let filtered = matches.filter(m => {

      if (weekVal !== "all" && m.week !== weekVal) return false;

      if (statusVal !== "all" && m.status.toLowerCase() !== statusVal) return false;

      if (q) {
        const blob = `${m.team1} ${m.team2} ${m.week}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }

      return true;
    });

    root.innerHTML = "";

    if (!filtered.length) {
      root.innerHTML = `<div class="empty">No matches found</div>`;
      return;
    }

    filtered.forEach(m => {

      const card = document.createElement("div");
      card.className = "match-row";

      const statusClass = m.status.toLowerCase();

      card.innerHTML = `
        <div class="match-left">
          <div class="week">${m.week}</div>
          <div class="time">${m.time || ""}</div>
        </div>

        <div class="match-center">
          <div class="teams">
            <span class="team">${m.team1}</span>
            <span class="vs">vs</span>
            <span class="team">${m.team2}</span>
          </div>
        </div>

        <div class="match-right">
          <span class="status ${statusClass}">${m.status}</span>
        </div>
      `;

      root.appendChild(card);
    });
  }

})();
