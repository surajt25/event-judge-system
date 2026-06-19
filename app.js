const STORAGE_KEY = "f2f4_evaluations_v1";
const SETTINGS_KEY = "f2f4_settings_v1";
const TEAMS_KEY = "f2f4_teams_v1";

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function makeId() {
  return crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const state = {
  currentScreen: "dashboardScreen",
  selectedRound: "",
  selectedTeamId: "",
  editingEvaluationId: "",
  currentRecording: { type: "", blob: null, url: "", mimeType: "", fileName: "" },
  mediaRecorder: null,
  chunks: [],
  stream: null,
  activeFilter: "All",
  sortMode: "score",
  detailId: ""
};

/*
const teamsSeed = [
  { teamId: makeId(), teamName: "Team Alpha", teamNumber: "1", schoolName: "", theme: "Accessibility", productServiceName: "Smart Cane Alert", ideaDescription: "", presentationRoom: "" },
  { teamId: makeId(), teamName: "Team Beta", teamNumber: "2", schoolName: "", theme: "Sustainability", productServiceName: "Waste Sorter", ideaDescription: "", presentationRoom: "" }
];
*/
const teamsSeed = [];


function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function getSettings() {
  return loadJSON(SETTINGS_KEY, { eventName: "Fuel to Fly 4.0", judgeName: "" });
}
/*
function getTeams() {
  const existing = loadJSON(TEAMS_KEY, null);
  if (existing) return existing;
  saveJSON(TEAMS_KEY, teamsSeed);
  return teamsSeed;
}
*/
function getTeams() {
  return loadJSON(TEAMS_KEY, []);
}

function getEvaluations() {
  return loadJSON(STORAGE_KEY, []);
}

function setScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  $(id).classList.add("active");
  state.currentScreen = id;
}

function calcTotal(scores) {
  return Object.values(scores).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

function scoreFields() {
  return {
    originalityInnovation: Number($("originalityInnovation").value),
    feasibilityPracticality: Number($("feasibilityPracticality").value),
    marketPotential: Number($("marketPotential").value),
    impactAccessibilityInclusion: Number($("impactAccessibilityInclusion").value),
    presentationQuality: Number($("presentationQuality").value)
  };
}

function syncScoreLabels() {
  ["originalityInnovation", "feasibilityPracticality", "marketPotential", "impactAccessibilityInclusion", "presentationQuality"].forEach((id) => {
    $(id + "Val").textContent = $(id).value;
  });
  $("totalScore").textContent = calcTotal(scoreFields());
}

function resetScoreForm() {
  ["originalityInnovation", "feasibilityPracticality", "marketPotential", "impactAccessibilityInclusion", "presentationQuality"].forEach((id) => {
    $(id).value = 0;
  });
  ["strengths", "concerns", "inclusionQuestion", "nextStep", "overallComment"].forEach((id) => $(id).value = "");
  syncScoreLabels();
  clearRecording();
}

function renderTeamList() {
  const query = $("teamSearch").value.trim().toLowerCase();
  const teams = getTeams().filter((t) => !query || [t.teamName, t.teamNumber, t.schoolName, t.theme].join(" ").toLowerCase().includes(query));
  
  $("teamList").innerHTML = teams.map((t) => `
    <div class="listItem">
      <strong>${escapeHtml(t.teamName)}</strong>
      <div class="meta">
        #${escapeHtml(t.teamNumber || "-")} • 
        ${escapeHtml(t.theme || "-")} • 
        ${escapeHtml(t.productServiceName || "-")}
      </div>

      <div class="grid">
        <button data-team="${t.teamId}" class="selectTeamBtn primary">Select Team</button>
        <button data-team="${t.teamId}" class="deleteTeamBtn danger">Delete Team</button>
      </div>
    </div>
  `).join("") || "<p class='meta'>No teams found.</p>";

  document.querySelectorAll(".selectTeamBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedTeamId = btn.dataset.team;
      openScoreScreen(getTeams().find((t) => t.teamId === state.selectedTeamId));
    });
  });


  document.querySelectorAll(".deleteTeamBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const confirmed = confirm(
        "Delete this team and all its evaluations?"
      );
      if (!confirmed) return;

      const teamId = btn.dataset.team;

      // Delete team
      let teams = getTeams();
      teams = teams.filter((t) => t.teamId !== teamId);
      saveJSON(TEAMS_KEY, teams);

      // Delete evaluations
      let evaluations = getEvaluations();
      const deletedEvaluations = evaluations.filter(
        (e) => e.teamId === teamId
      );

      evaluations = evaluations.filter(
        (e) => e.teamId !== teamId
      );

      saveJSON(STORAGE_KEY, evaluations);

      // Delete recordings for those evaluations
      for (const evalItem of deletedEvaluations) {
        await deleteRecordingFromIndexedDB(
          evalItem.evaluationId
        ).catch(() => {});
      }

      renderTeamList();
      alert("Team and related evaluations deleted.");
    });
  });

}


function openScoreScreen(team) {
  const settings = getSettings();
  $("scoreTitle").textContent = `Score Team`;
  $("scoreMeta").innerHTML = `
    <div><strong>Event:</strong> ${escapeHtml(settings.eventName || "")}</div>
    <div><strong>Judge:</strong> ${escapeHtml(settings.judgeName || "")}</div>
    <div><strong>Round:</strong> ${escapeHtml(state.selectedRound)}</div>
    <div><strong>Team:</strong> ${escapeHtml(team.teamName)}</div>
    <div><strong>Theme:</strong> ${escapeHtml(team.theme || "-")}</div>
    <div><strong>Product:</strong> ${escapeHtml(team.productServiceName || "-")}</div>
  `;
  state.editingEvaluationId = "";
  const existing = getEvaluations().find((e) => e.roundName === state.selectedRound && e.teamId === team.teamId);
  if (existing) loadEvaluationIntoForm(existing);
  else resetScoreForm();
  setScreen("scoreScreen");
}

function loadEvaluationIntoForm(e) {
  state.editingEvaluationId = e.evaluationId;
  $("originalityInnovation").value = e.scores.originalityInnovation;
  $("feasibilityPracticality").value = e.scores.feasibilityPracticality;
  $("marketPotential").value = e.scores.marketPotential;
  $("impactAccessibilityInclusion").value = e.scores.impactAccessibilityInclusion;
  $("presentationQuality").value = e.scores.presentationQuality;
  $("strengths").value = e.notes.strengths || "";
  $("concerns").value = e.notes.concerns || "";
  $("inclusionQuestion").value = e.notes.inclusionQuestion || "";
  $("nextStep").value = e.notes.nextStep || "";
  $("overallComment").value = e.notes.overallComment || "";
  syncScoreLabels();
  restoreRecordingForEvaluation(e.evaluationId);
}

function validateEvaluation(team, scores) {
  if (!state.selectedRound) return "Round is required.";
  if (!team?.teamName?.trim()) return "Team name is required.";
  if (Object.values(scores).some((v) => v === "" || v === null || v === undefined || Number.isNaN(Number(v)))) return "All score fields are required.";
  if (scores.originalityInnovation > 15 || scores.feasibilityPracticality > 5 || scores.marketPotential > 10 || scores.impactAccessibilityInclusion > 15 || scores.presentationQuality > 5) return "One or more scores exceed the maximum allowed.";
  return "";
}

function buildEvaluation(team) {
  const scores = scoreFields();
  const err = validateEvaluation(team, scores);
  if (err) {
    alert(err);
    return null;
  }

  const totalScore = calcTotal(scores);
  if (totalScore < 15 && !confirm("Total score is very low. Continue?")) return null;
  if (totalScore > 45 && !confirm("Total score is very high. Continue?")) return null;

  const existingSameRound = getEvaluations().find((e) =>
    e.teamId === team.teamId &&
    e.roundName === state.selectedRound &&
    e.evaluationId !== state.editingEvaluationId
  );
  if (existingSameRound && !confirm("This team already has a score in the same round. Save anyway?")) return null;

  const now = new Date().toISOString();
  const previous = state.editingEvaluationId
    ? getEvaluations().find((e) => e.evaluationId === state.editingEvaluationId)
    : null;

  //const recording = state.currentRecording.blob
  const recording = (state.currentRecording.blob || state.currentRecording.url)
    ? {
        audioAvailable: true,
        videoAvailable: state.currentRecording.type === "video",
        fileName: state.currentRecording.fileName || "",
        storageType: "browser",
        downloadStatus: "ready"
      }
    : (previous?.recording ?? {
        audioAvailable: false,
        videoAvailable: false,
        fileName: "",
        storageType: "",
        downloadStatus: "none"
      });

  return {
    evaluationId: state.editingEvaluationId || makeId(),
    eventName: getSettings().eventName || "Fuel to Fly 4.0",
    judgeName: $("judgeName").value.trim() || getSettings().judgeName || "Anonymous Judge",
    roundName: state.selectedRound,
    teamId: team.teamId,
    teamName: team.teamName,
    teamNumber: team.teamNumber || "",
    schoolName: team.schoolName || "",
    theme: team.theme || "",
    productServiceName: team.productServiceName || "",
    ideaDescription: team.ideaDescription || "",
    scores,
    totalScore,
    notes: {
      strengths: $("strengths").value.trim(),
      concerns: $("concerns").value.trim(),
      inclusionQuestion: $("inclusionQuestion").value.trim(),
      nextStep: $("nextStep").value.trim(),
      overallComment: $("overallComment").value.trim()
    },
    recording,
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
}

async function startRecording(type) {
  if (state.currentRecording.blob || state.currentRecording.url) {
    alert("Only one recording allowed per evaluation. Delete existing recording first.");
    return;
  }

  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      alert("Recording is not supported in this browser.");
      return;
    }

    //const constraints = type === "audio" ? { audio: true } : { audio: true, video: true };
    const constraints = type === "audio"
    ? { audio: true }
    : {
        audio: true,
        video: {
          facingMode: $("cameraSelect").value
        }
      };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);

    const mimeType = type === "audio"
      ? (
          MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm")
              ? "audio/webm"
              : ""
        )
      : (
          MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
            ? "video/webm;codecs=vp9,opus"
            : MediaRecorder.isTypeSupported("video/webm")
              ? "video/webm"
              : ""
        );

    state.chunks = [];
    state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
    state.currentRecording.type = type;

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.chunks.push(e.data);
    };

    state.mediaRecorder.onstop = () => {
      const blob = new Blob(state.chunks, {
        type: state.mediaRecorder.mimeType || (type === "audio" ? "audio/webm" : "video/webm")
      });
      const url = URL.createObjectURL(blob);
      state.currentRecording = {
        type,
        blob,
        url,
        mimeType: blob.type,
        fileName: `${type}-${state.selectedRound.replace(/\s+/g, "_")}-${Date.now()}.webm`
      };
      showPreview();
    };

    state.mediaRecorder.start();
    $("recordingStatus").textContent = `${type.toUpperCase()} recording started.`;
    $("startAudioBtn").disabled = true;
    $("startVideoBtn").disabled = true;
    $("recordingIndicator").classList.remove("hidden");
    $("stopAudioBtn").disabled = false;
    $("stopVideoBtn").disabled = false;
  } catch {
    alert("Recording permission denied or unavailable.");
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    $("startAudioBtn").disabled = false;
    $("startVideoBtn").disabled = false;
    $("recordingIndicator").classList.add("hidden");
    $("stopAudioBtn").disabled = true;
    $("stopVideoBtn").disabled = true;
    $("downloadRecordingBtn").disabled = false;
    $("deleteRecordingBtn").disabled = false;
    $("recordingStatus").textContent = "Recording ready for preview and download.";
  }
}

/*
function showPreview() {
  const el = state.currentRecording.type === "video" ? $("videoPreview") : $("audioPreview");
  el.src = state.currentRecording.url;
  el.classList.remove("hidden");
  $("downloadRecordingBtn").disabled = false;
  $("deleteRecordingBtn").disabled = false;
  $("recordingStatus").textContent = `${state.currentRecording.type.toUpperCase()} recording ready.`;
}*/
function showPreview() {
  $("audioPreview").classList.add("hidden");
  $("videoPreview").classList.add("hidden");

  const el = state.currentRecording.type === "video"
    ? $("videoPreview")
    : $("audioPreview");

  el.src = state.currentRecording.url;
  el.classList.remove("hidden");

  $("downloadRecordingBtn").disabled = false;
  $("deleteRecordingBtn").disabled = false;
  $("recordingStatus").textContent =
    `${state.currentRecording.type.toUpperCase()} recording ready.`;
}

function downloadRecording() {
  if (!state.currentRecording.url) return;

  const a = document.createElement("a");
  a.href = state.currentRecording.url;
  a.download = state.currentRecording.fileName || "recording.webm";
  a.click();
}

/*
function deleteRecording() {
  clearRecording();
} */
async function deleteRecording() {
  if (state.editingEvaluationId) {
    await deleteRecordingFromIndexedDB(state.editingEvaluationId).catch(() => {});
  }
  clearRecording();
}

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("f2f4_recordings_db", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("recordings")) db.createObjectStore("recordings", { keyPath: "evaluationId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRecordingToIndexedDB(evaluationId, blob, fileName, type) {
  const db = await initDB();
  const tx = db.transaction("recordings", "readwrite");
  tx.objectStore("recordings").put({ evaluationId, blob, fileName, type, updatedAt: new Date().toISOString() });
}

async function loadRecordingFromIndexedDB(evaluationId) {
  const db = await initDB();
  const tx = db.transaction("recordings", "readonly");
  const req = tx.objectStore("recordings").get(evaluationId);
  return await new Promise((resolve) => {
    req.onsuccess = () => {
      const item = req.result;
      if (!item?.blob) return resolve(null);
      resolve({ url: URL.createObjectURL(item.blob), type: item.type, fileName: item.fileName });
    };
    req.onerror = () => resolve(null);
  });
}

async function deleteRecordingFromIndexedDB(evaluationId) {
  const db = await initDB();
  const tx = db.transaction("recordings", "readwrite");
  tx.objectStore("recordings").delete(evaluationId);
}

function exportCSV() {
  const evaluations = getEvaluations();
  if (!evaluations.length) {
    alert("No evaluations to export.");
    return;
  }

  const headers = [
    "Rank",
    "Judge",
    "Team",
    "Round",
    "Theme",
    "Product/Service",
    "Originality",
    "Feasibility",
    "Market",
    "Impact & Inclusion",
    "Presentation",
    "Total Score",
    "Strengths",
    "Concerns",
    "Inclusion Question",
    "Next Step",
    "Overall Comment"
  ];

  const sorted = [...evaluations].sort((a, b) => b.totalScore - a.totalScore);

  const rows = sorted.map((e, i) => [
    i + 1,
    e.judgeName,
    e.teamName,
    e.roundName,
    e.theme,
    e.productServiceName,
    e.scores.originalityInnovation,
    e.scores.feasibilityPracticality,
    e.scores.marketPotential,
    e.scores.impactAccessibilityInclusion,
    e.scores.presentationQuality,
    e.totalScore,
    e.notes.strengths,
    e.notes.concerns,
    e.notes.inclusionQuestion,
    e.notes.nextStep,
    e.notes.overallComment
  ]);

  const csv =
    [headers, ...rows].map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");

  downloadText(`f2f4-evaluation-${Date.now()}.csv`, csv, "text/csv");
}

function exportJSON() {
  const data = {
    exportDate: new Date().toISOString(),
    eventName: getSettings().eventName,
    judges: [...new Set(getEvaluations().map(e => e.judgeName))],
    evaluations: getEvaluations()
  };

  downloadText(`f2f4-backup-${Date.now()}.json`, JSON.stringify(data, null, 2), "application/json");
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copySummary() {
  const text = getEvaluations().map((e, i) =>
    `${i + 1}. ${e.teamName} | ${e.roundName} | ${e.totalScore}/50 | Theme: ${e.theme || "-"} | Comment: ${e.notes.overallComment || "-"}`
  ).join("\n");
  navigator.clipboard.writeText(text).then(() => alert("Summary copied."));
}

function printSummary() {
  const evaluations = getEvaluations();
  if (!evaluations.length) {
    alert("No evaluations to print.");
    return;
  }

  const sorted = [...evaluations].sort((a, b) => b.totalScore - a.totalScore);

  const html = `
    <html>
      <head>
        <title>F2F4 Evaluation Summary</title>
        <style>
          body { font-family: Arial; margin: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background: #f0f0f0; font-weight: bold; }
          .header { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
          .meta { color: #666; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="header">Fuel to Fly 4.0 - Evaluation Summary</div>
        <div class="meta">
          Date: ${new Date().toLocaleDateString()}<br>
          Event: ${getSettings().eventName}
        </div>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Judge</th>
              <th>Team</th>
              <th>Round</th>
              <th>Theme</th>
              <th>Originality</th>
              <th>Feasibility</th>
              <th>Market</th>
              <th>Impact</th>
              <th>Presentation</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map(
                (e, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(e.judgeName)}</td>
                <td>${escapeHtml(e.teamName)}</td>
                <td>${escapeHtml(e.roundName)}</td>
                <td>${escapeHtml(e.theme)}</td>
                <td>${e.scores.originalityInnovation}</td>
                <td>${e.scores.feasibilityPracticality}</td>
                <td>${e.scores.marketPotential}</td>
                <td>${e.scores.impactAccessibilityInclusion}</td>
                <td>${e.scores.presentationQuality}</td>
                <td><strong>${e.totalScore}</strong></td>
              </tr>
            `)
            }
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const printWindow = window.open("", "", "width=1000,height=600");
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.print();
}

function resetData() {
  if (!confirm("Reset all saved data?")) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(TEAMS_KEY);
  alert("Data reset.");
  location.reload();
}

function bindEvents() {
  ["originalityInnovation","feasibilityPracticality","marketPotential","impactAccessibilityInclusion","presentationQuality"].forEach((id) => {
    $(id).addEventListener("input", syncScoreLabels);
  });

  $("judgeName").addEventListener("input", () => {
    const settings = getSettings();
    settings.judgeName = $("judgeName").value;
    settings.eventName = $("eventName").value;
    saveJSON(SETTINGS_KEY, settings);
  });
  $("eventName").addEventListener("input", () => {
    const settings = getSettings();
    settings.judgeName = $("judgeName").value;
    settings.eventName = $("eventName").value;
    saveJSON(SETTINGS_KEY, settings);
  });

  $("startBtn").onclick = () => setScreen("roundScreen");
  $("summaryBtn").onclick = () => { setScreen("summaryScreen"); renderSummary(); };
  $("exportBtn").onclick = () => {
    setScreen("summaryScreen");
    renderSummary();
  };
  
  $("resetBtn").onclick = resetData;

  document.querySelectorAll(".roundBtn").forEach((btn) => {
    btn.onclick = () => {
      state.selectedRound = btn.dataset.round;
      setScreen("teamScreen");
      renderTeamList();
    };
  });

  $("teamSearch").addEventListener("input", renderTeamList);
  $("continueBtn").onclick = () => {
    const team = {
      teamId: makeId(),
      teamName: $("teamName").value.trim(),
      teamNumber: $("teamNumber").value.trim(),
      schoolName: $("schoolName").value.trim(),
      theme: $("theme").value,
      productServiceName: $("productServiceName").value.trim(),
      ideaDescription: $("ideaDescription").value.trim(),
      presentationRoom: $("presentationRoom").value.trim()
    };
    if (!state.selectedRound) return alert("Select round first.");
    if (!team.teamName) return alert("Team name is required.");

    const teams = getTeams();

    const duplicate = teams.find(t =>
      t.teamName.toLowerCase() === team.teamName.toLowerCase() ||
      t.teamNumber === team.teamNumber
    );

    if (duplicate) {
      alert("Team already exists.");
      return;
    }

    teams.push(team);
    saveJSON(TEAMS_KEY, teams);

    state.selectedTeamId = team.teamId;
    openScoreScreen(team);
  };

  $("saveBtn").onclick = () => saveEvaluation(false);
  $("saveNextBtn").onclick = () => saveEvaluation(true);

  $("startAudioBtn").onclick = () => startRecording("audio");
  $("startVideoBtn").onclick = () => startRecording("video");
  $("stopAudioBtn").onclick = stopRecording;
  $("stopVideoBtn").onclick = stopRecording;
  $("downloadRecordingBtn").onclick = downloadRecording;
  $("deleteRecordingBtn").onclick = deleteRecording;

  $("summaryBtn").onclick = () => { setScreen("summaryScreen"); renderSummary(); };
  $("copyBtn").onclick = copySummary;
  $("printBtn").onclick = printSummary;

  $("exportCsvBtn").onclick = exportCSV;
  $("exportJsonBtn").onclick = exportJSON;

  $("sortScoreBtn").onclick = () => { state.sortMode = "score"; renderSummary(); };
  $("sortImpactBtn").onclick = () => { state.sortMode = "impact"; renderSummary(); };
  $("sortMarketBtn").onclick = () => { state.sortMode = "market"; renderSummary(); };

  document.querySelectorAll(".filterBtn").forEach((btn) => {
    btn.onclick = () => { state.activeFilter = btn.dataset.filter; renderSummary(); };
  });

  document.querySelectorAll(".backBtn").forEach((btn) => {
    btn.onclick = () => {
      if (state.currentScreen === "teamScreen" || state.currentScreen === "roundScreen") setScreen("dashboardScreen");
      else if (state.currentScreen === "scoreScreen") setScreen("teamScreen");
      else setScreen("dashboardScreen");
    };
  });

  $("closeDetailBtn").onclick = () => $("detailDialog").close();
}

function init() {
  const settings = getSettings();
  $("eventName").value = settings.eventName || "Fuel to Fly 4.0";
  $("judgeName").value = settings.judgeName || "";
  bindEvents();
  syncScoreLabels();
  renderTeamList();
  setScreen("dashboardScreen");
}


function clearRecording() {
  if (state.currentRecording.url) {
    URL.revokeObjectURL(state.currentRecording.url);
  }

  state.currentRecording = {
    type: "",
    blob: null,
    url: "",
    mimeType: "",
    fileName: ""
  };

  $("audioPreview").src = "";
  $("videoPreview").src = "";

  $("audioPreview").classList.add("hidden");
  $("videoPreview").classList.add("hidden");

  $("downloadRecordingBtn").disabled = true;
  $("deleteRecordingBtn").disabled = true;
  $("recordingStatus").textContent = "No recording yet.";
}



async function restoreRecordingForEvaluation(evaluationId) {
  clearRecording();

  const recording = await loadRecordingFromIndexedDB(evaluationId);

  if (!recording) return;

  state.currentRecording = {
    type: recording.type,
    blob: null,
    url: recording.url,
    mimeType: "",
    fileName: recording.fileName
  };

  showPreview();
}


async function saveEvaluation(goNext) {
  const team = getTeams().find((t) => t.teamId === state.selectedTeamId);

  if (!team) {
    alert("No team selected.");
    return;
  }

  const evaluation = buildEvaluation(team);
  if (!evaluation) return;

  let evaluations = getEvaluations();
  const index = evaluations.findIndex((e) => e.evaluationId === evaluation.evaluationId);

  if (index !== -1) {
    evaluations[index] = evaluation;
  } else {
    evaluations.push(evaluation);
  }

  saveJSON(STORAGE_KEY, evaluations);

  if (state.currentRecording.blob) {
    await saveRecordingToIndexedDB(
      evaluation.evaluationId,
      state.currentRecording.blob,
      state.currentRecording.fileName,
      state.currentRecording.type
    );

    console.log("Recording saved to IndexedDB:", evaluation.evaluationId);
  }

  alert("Evaluation saved.");

  if (goNext) {
    resetScoreForm();
    setScreen("teamScreen");
    renderTeamList();
  } else {
    setScreen("summaryScreen");
    renderSummary();
  }
}

function renderSummary() {
  let evaluations = getEvaluations();

  if (state.activeFilter !== "All") {
    evaluations = evaluations.filter(e => e.roundName === state.activeFilter);
  }

  if (state.sortMode === "score") {
    evaluations.sort((a, b) => b.totalScore - a.totalScore);
  } else if (state.sortMode === "impact") {
    evaluations.sort((a, b) =>
      b.scores.impactAccessibilityInclusion - a.scores.impactAccessibilityInclusion
    );
  } else if (state.sortMode === "market") {
    evaluations.sort((a, b) =>
      b.scores.marketPotential - a.scores.marketPotential
    );
  }

  if (!evaluations.length) {
    $("summaryList").innerHTML = "<p>No evaluations yet.</p>";
    return;
  }

  $("summaryList").innerHTML = evaluations.map((e, i) => `
    <div class="listItem" style="cursor:pointer;" data-eval="${e.evaluationId}">
      <strong>${i + 1}. ${escapeHtml(e.teamName)}</strong>
      <div class="meta">
        Round: ${escapeHtml(e.roundName)}<br>
        Score: <strong>${e.totalScore}/50</strong><br>
        Theme: ${escapeHtml(e.theme || "-")}<br>
        Product: ${escapeHtml(e.productServiceName || "-")}<br>
        Comment: ${escapeHtml(e.notes.overallComment || "-")}
      </div>
    </div>
  `).join("") || "<p class='meta'>No evaluations yet.</p>";

  // Add click handlers
  document.querySelectorAll("[data-eval]").forEach((el) => {
    el.addEventListener("click", () => {
      showDetailDialog(el.dataset.eval);
    });
  });
}

function showDetailDialog(evaluationId) {
  console.log("showDetailDialog called", evaluationId);

  state.detailId = evaluationId;
  const evaluation = getEvaluations().find((e) => e.evaluationId === evaluationId);
  if (!evaluation) return;

  $("detailContent").innerHTML = `
    <strong>${escapeHtml(evaluation.teamName)}</strong>
    <div class="meta">
      Judge: ${escapeHtml(evaluation.judgeName)}<br>
      Round: ${escapeHtml(evaluation.roundName)}<br>
      Theme: ${escapeHtml(evaluation.theme || "-")}<br>
      Product: ${escapeHtml(evaluation.productServiceName || "-")}<br>
      Total Score: <strong>${evaluation.totalScore}/50</strong><br><br>
      <strong>Scores:</strong><br>
      Originality: ${evaluation.scores.originalityInnovation}/15<br>
      Feasibility: ${evaluation.scores.feasibilityPracticality}/5<br>
      Market: ${evaluation.scores.marketPotential}/10<br>
      Impact & Inclusion: ${evaluation.scores.impactAccessibilityInclusion}/15<br>
      Presentation: ${evaluation.scores.presentationQuality}/5<br><br>
      <strong>Notes:</strong><br>
      Strengths: ${escapeHtml(evaluation.notes.strengths || "-")}<br>
      Concerns: ${escapeHtml(evaluation.notes.concerns || "-")}<br>
      Inclusion: ${escapeHtml(evaluation.notes.inclusionQuestion || "-")}<br>
      Next Step: ${escapeHtml(evaluation.notes.nextStep || "-")}<br>
      Comment: ${escapeHtml(evaluation.notes.overallComment || "-")}<br>

      <hr>
      <div id="detailRecordingSection">
        <strong>Recording:</strong><br>
        <div id="detailRecordingPreview">Loading recording...</div>
      </div>
    </div>
  `;
  $("detailDialog").showModal();
  console.log("Before loading recording");
  loadRecordingFromIndexedDB(evaluationId).then((recording) => {
    console.log("Loaded recording:", recording);
    const preview = $("detailRecordingPreview");

    if (!recording) {
      preview.innerHTML = "No recording found.";
      return;
    }

    if (recording.type === "audio") {
      preview.innerHTML = `
        <audio controls src="${recording.url}" style="width:100%; margin-top:10px;"></audio>
      `;
    } else {
      preview.innerHTML = `
        <video controls src="${recording.url}" style="width:100%; margin-top:10px; border-radius:12px;"></video>
      `;
    }
  });


}

// 2. EDIT FROM DETAIL - Load evaluation back into form
$("editBtn").onclick = () => {
  const evaluation = getEvaluations().find((e) => e.evaluationId === state.detailId);
  if (!evaluation) return;
  
  state.selectedRound = evaluation.roundName;
  state.selectedTeamId = evaluation.teamId;
  const team = getTeams().find((t) => t.teamId === evaluation.teamId);
  
  $("detailDialog").close();
  openScoreScreen(team);
  loadEvaluationIntoForm(evaluation);
};

// 3. DELETE FROM DETAIL
$("deleteBtn").onclick = () => {
  if (!confirm("Delete this evaluation?")) return;
  
  let evaluations = getEvaluations();
  evaluations = evaluations.filter((e) => e.evaluationId !== state.detailId);
  saveJSON(STORAGE_KEY, evaluations);
  
  deleteRecordingFromIndexedDB(state.detailId).catch(() => {});
  
  $("detailDialog").close();
  renderSummary();
  alert("Evaluation deleted.");
};

/*
// 4. MAKE SUMMARY CLICKABLE
// Update renderSummary to add click handlers:
function renderSummary() {
  let evaluations = getEvaluations();

  if (state.activeFilter !== "All") {
    evaluations = evaluations.filter(e => e.roundName === state.activeFilter);
  }

  if (state.sortMode === "score") {
    evaluations.sort((a, b) => b.totalScore - a.totalScore);
  } else if (state.sortMode === "impact") {
    evaluations.sort((a, b) =>
      b.scores.impactAccessibilityInclusion - a.scores.impactAccessibilityInclusion
    );
  } else if (state.sortMode === "market") {
    evaluations.sort((a, b) =>
      b.scores.marketPotential - a.scores.marketPotential
    );
  }

  if (!evaluations.length) {
    $("summaryList").innerHTML = "<p>No evaluations yet.</p>";
    return;
  }

  $("summaryList").innerHTML = evaluations.map((e, i) => `
    <div class="listItem" style="cursor:pointer;" data-eval="${e.evaluationId}">
      <strong>${i + 1}. ${escapeHtml(e.teamName)}</strong>
      <div class="meta">
        Round: ${escapeHtml(e.roundName)}<br>
        Score: <strong>${e.totalScore}/50</strong><br>
        Theme: ${escapeHtml(e.theme || "-")}<br>
        Product: ${escapeHtml(e.productServiceName || "-")}<br>
        Comment: ${escapeHtml(e.notes.overallComment || "-")}
      </div>
    </div>
  `).join("") || "<p class='meta'>No evaluations yet.</p>";

  // Add click handlers
  document.querySelectorAll("[data-eval]").forEach((el) => {
    el.addEventListener("click", () => {
      showDetailDialog(el.dataset.eval);
    });
  });
}
*/
init();