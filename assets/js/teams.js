console.log("teams.js loaded");

async function fetchCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return await res.text();
}

// Simple CSV parser (handles commas + quotes)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      cur = "";
      // ignore totally empty last row
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }

  // last cell
  if (cur.length || row.length) {
    row.push(cur);
    if (row.some(cell => cell.trim() !== "")) rows.push(row);
  }

  return rows;
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function renderTeams(teams) {
  const main = document.querySelector("main");
  main.innerHTML = ""; // wipe placeholder

  const title = el("h1", "", "RLOL Teams");
  const sub = el("p", "", "All teams competing in RLOL");
  sub.style.opacity = "0.85";

  const grid = el("div", "teams-grid");
  teams.forEach(t => {
    const card = el("div", "team-card");
    const name = el("div", "team-name", t.name || "Unnamed Team");
    const meta = el("div", "team-meta", [t.tag, t.captain].filter(Boolean).join(" • "));
    card.appendChild(name);
    if (meta.textContent.trim()) card.appendChild(meta);
    grid.appendChild(card);
  });

  main.appendChild(title);
  main.appendChild(sub);
  main.appendChild(grid);
}

(async () => {
  try {
    const cfg = window.OV_CONFIG?.rlol;
    if (!cfg?.teamsCsv) throw new Error("teamsCsv missing in config.js");

    console.log("Teams CSV:", cfg.teamsCsv);

    const csvText = await fetchCsv(cfg.teamsCsv);
    const rows = parseCsv(csvText);

    // Expect headers in row 0
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const data = rows.slice(1);

    // Try to map common column names (flexible)
    const idx = (name) => headers.indexOf(name);

    const iName =
      idx("team") !== -1 ? idx("team") :
      idx("name") !== -1 ? idx("name") :
      idx("team name") !== -1 ? idx("team name") : 0;

    const iTag =
      idx("tag") !== -1 ? idx("tag") :
      idx("abbr") !== -1 ? idx("abbr") :
      idx("abbreviation") !== -1 ? idx("abbreviation") : -1;

    const iCaptain =
      idx("captain") !== -1 ? idx("captain") :
      idx("owner") !== -1 ? idx("owner") : -1;

    const teams = data
      .map(r => ({
        name: (r[iName] || "").trim(),
        tag: iTag >= 0 ? (r[iTag] || "").trim() : "",
        captain: iCaptain >= 0 ? (r[iCaptain] || "").trim() : ""
      }))
      .filter(t => t.name);

    console.log("Teams parsed:", teams.length, teams);

    renderTeams(teams);
  } catch (err) {
    console.error(err);
  }
})();
