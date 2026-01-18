(function () {
  if (!window.OV_CONFIG || !window.OV_CONFIG.rlol) {
    console.error("OV_CONFIG missing");
    return;
  }

  const SCHEDULE = window.OV_CONFIG.rlol.scheduleCsv;
  const STANDINGS = window.OV_CONFIG.rlol.standingsCsv;

  function fetchCSV(url) {
    return fetch(url, { cache: "no-store" })
      .then(r => r.text())
      .then(t => t.trim().split(/\r?\n/).slice(1));
  }

  /* ---------- NEXT MATCH NIGHT ---------- */
  fetchCSV(SCHEDULE).then(rows => {
    const upcoming = rows
      .map(r => r.split(","))
      .find(r => r[6]?.toLowerCase() === "scheduled");

    if (!upcoming) return;

    document.getElementById("next-match-night").innerHTML = `
      <div class="pill">Stream Start <strong>6:00 PM ET</strong></div>
      <div class="pill">Format <strong>Bo3 Series</strong></div>
      <div class="pill">Tiebreaker <strong>Goal Diff</strong></div>
    `;
  });

  /* ---------- STANDINGS SNAPSHOT ---------- */
  fetchCSV(STANDINGS).then(rows => {
    const top = rows.slice(0, 5);
    const el = document.getElementById("standings-snapshot");

    el.innerHTML = top.map(r => {
      const [team, w, l, gd] = r.split(",");
      return `<div><strong>${team}</strong> ${w}-${l} (${gd})</div>`;
    }).join("");
  });
})();
