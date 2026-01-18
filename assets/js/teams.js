console.log("teams.js loaded");

if (!window.OV_CONFIG || !window.OV_CONFIG.rlol) {
  console.error("OV_CONFIG not found");
} else {
  console.log("Teams CSV:", window.OV_CONFIG.rlol.teamsCsv);
}
