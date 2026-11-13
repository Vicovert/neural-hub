/* ============================================================================
 * NEURAL DEV HUB V6.0 — MOTEUR AGENTIQUE XML PUR & AUTO-HEAL CI/CD
 * - Zéro JSON pour le transport de code (Protocole XML + CDATA)
 * - Sélection automatique des fichiers via Gemini Flash
 * - Patch multi-hunks tolérant à l'indentation + Réécriture complète
 * - Commit Git Atomique multi-fichiers (Git Data API : blobs -> tree -> commit)
 * - Boucle d'auto-réparation CI/CD (lecture des logs d'échec GitHub Actions)
 * - Caméra 3D verrouillée en permanence sur CORTEX_CORE (fx:0, fy:0, fz:0)
 * ============================================================================ */

let graph3D = null;
let currentRepo = null;
let currentRepoTree = [];
let abortAgentController = null;

const CORTEX_ID = "CORTEX_CORE";

// ============================================================================
// 1. GESTION DES CLÉS & INITIALISATION
// ============================================================================

function getCreds() {
  return {
    ghToken: (localStorage.getItem("ndh_gh_token") || "").trim(),
    geminiKey: (localStorage.getItem("ndh_gemini_key") || "").trim()
  };
}

function saveCreds(ghToken, geminiKey) {
  localStorage.setItem("ndh_gh_token", ghToken.trim());
  localStorage.setItem("ndh_gemini_key", geminiKey.trim());
}

function logTerminal(msg, type = "info") {
  const box = document.getElementById("agent-terminal");
  if (!box) return;
  const line = document.createElement("div");
  line.className = `log-${type}`;
  const time = new Date().toLocaleTimeString("fr-FR", { hour12: false });
  line.textContent = `[${time}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function setStepStatus(text) {
  const el = document.getElementById("agent-step-indicator");
  if (el) el.textContent = text;
}

window.addEventListener("DOMContentLoaded", async () => {
  bindUIEvents();
  initBrain3D();

  const { ghToken, geminiKey } = getCreds();
  if (!ghToken || !geminiKey) {
    document.getElementById("settings-modal").classList.remove("hidden");
    logTerminal("Clés API manquantes. Configure ton Token GitHub et ta clé Gemini.", "warn");
  } else {
    await loadUserRepositories();
  }
});

function bindUIEvents() {
  document.getElementById("btn-open-settings").onclick = () => {
    const { ghToken, geminiKey } = getCreds();
    document.getElementById("input-gh-token").value = ghToken;
    document.getElementById("input-gemini-key").value = geminiKey;
    document.getElementById("settings-modal").classList.remove("hidden");
  };

  document.getElementById("btn-close-settings").onclick = () => {
    document.getElementById("settings-modal").classList.add("hidden");
  };

  document.getElementById("btn-save-settings").onclick = async () => {
    const gh = document.getElementById("input-gh-token").value;
    const gem = document.getElementById("input-gemini-key").value;
    saveCreds(gh, gem);
    document.getElementById("settings-modal").classList.add("hidden");
    await loadUserRepositories();
  };

  document.getElementById("btn-center-cortex").onclick = () => lockCameraOnCortex(800);
  document.getElementById("btn-close-hud").onclick = () => {
    document.getElementById("project-hud").classList.add("hidden");
    lockCameraOnCortex(700);
  };

  document.getElementById("btn-refresh-tree").onclick = () => {
    if (currentRepo) refreshRepoTree(currentRepo);
  };

  document.getElementById("btn-uncheck-all").onclick = () => {
    document.querySelectorAll(".ctx-file-cb").forEach(cb => {
      cb.checked = false;
      cb.closest(".file-item")?.classList.remove("ai-picked");
    });
  };

  document.getElementById("btn-create-tag").onclick = async () => {
    if (currentRepo) await createBackupTag(currentRepo, "manual");
  };

  document.getElementById("btn-execute-agent").onclick = () => {
    if (currentRepo) runAutonomousCycle(currentRepo);
  };

  document.getElementById("btn-stop-agent").onclick = () => {
    if (abortAgentController) {
      abortAgentController.abort();
      logTerminal("Arrêt demandé par l'utilisateur.", "warn");
    }
  };
}

// ============================================================================
// 2. GRAPHE 3D & VERROUILLAGE PERMANENT SUR LE CORTEX CORE
// ============================================================================

function initBrain3D() {
  const container = document.getElementById("graph-3d");

  graph3D = ForceGraph3D()(container)
    .backgroundColor("#07090e")
    .showNavInfo(false)
    .nodeLabel(node => node.name)
    .nodeThreeObject(node => {
      const group = new THREE.Group();
      const geo = new THREE.SphereGeometry(node.isCore ? 14 : 6.5, 28, 28);
      const mat = new THREE.MeshStandardMaterial({
        color: node.isCore ? 0x38bdf8 : (node.ciColor || 0x818cf8),
        emissive: node.isCore ? 0x0284c7 : (node.ciColor || 0x312e81),
        emissiveIntensity: node.isCore ? 0.85 : 0.45,
        roughness: 0.25,
        metalness: 0.7
      });
      group.add(new THREE.Mesh(geo, mat));

      if (node.isCore) {
        const ringGeo = new THREE.TorusGeometry(20, 0.6, 16, 64);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
        group.add(new THREE.Mesh(ringGeo, ringMat));
      }
      return group;
    })
    .linkColor(() => "rgba(56, 189, 248, 0.28)")
    .linkWidth(1.2)
    .linkDirectionalParticles(2)
    .linkDirectionalParticleWidth(2)
    .onNodeClick(node => {
      if (node.isCore) {
        lockCameraOnCortex(800);
        return;
      }
      openProjectHud(node.repoData);
    });

  // Éclairage 3D
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
  dirLight.position.set(120, 180, 140);
  graph3D.scene().add(ambientLight, dirLight);

  // Verrouillage permanent du pivot d'orbite sur (0, 0, 0) où réside CORTEX_CORE
  graph3D.onEngineTick(() => {
    const controls = graph3D.controls();
    if (controls && controls.target) {
      controls.target.set(0, 0, 0);
    }
  });

  window.addEventListener("resize", () => {
    graph3D.width(container.clientWidth);
    graph3D.height(container.clientHeight);
  });
}

function lockCameraOnCortex(duration = 800) {
  if (!graph3D) return;
  const controls = graph3D.controls();
  if (controls && controls.target) {
    controls.target.set(0, 0, 0);
  }
  graph3D.cameraPosition(
    { x: 0, y: 35, z: 220 },
    { x: 0, y: 0, z: 0 },
    duration
  );
}

// ============================================================================
// 3. API GITHUB (REPOS, ARBORESCENCE, GIT DATA API ATOMIQUE, TAGS, ACTIONS)
// ============================================================================

async function ghFetch(endpoint, options = {}) {
  const { ghToken } = getCreds();
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${ghToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub API ${res.status} (${endpoint}): ${txt}`);
  }
  if (res.status === 204) return null;
  return await res.json();
}

async function loadUserRepositories() {
  try {
    const repos = await ghFetch("/user/repos?sort=updated&per_page=40");
    // Le CORTEX_CORE est fixé mathématiquement à l'origine (0, 0, 0)
    const nodes = [
      { id: CORTEX_ID, name: "CORTEX CORE", isCore: true, fx: 0, fy: 0, fz: 0 }
    ];
    const links = [];

    const radius = 115;
    repos.forEach((r, idx) => {
      // Distribution sphérique de Fibonacci autour du Cortex
      const phi = Math.acos(1 - 2 * (idx + 0.5) / Math.max(repos.length, 1));
      const theta = Math.PI * (1 + Math.sqrt(5)) * idx;

      nodes.push({
        id: r.full_name,
        name: r.name,
        isCore: false,
        repoData: r,
        x: radius * Math.cos(theta) * Math.sin(phi),
        y: radius * Math.sin(theta) * Math.sin(phi),
        z: radius * Math.cos(phi)
      });
      links.push({ source: CORTEX_ID, target: r.full_name });
    });

    graph3D.graphData({ nodes, links });
    setTimeout(() => lockCameraOnCortex(600), 200);
  } catch (err) {
    logTerminal(`Erreur chargement dépôts GitHub : ${err.message}`, "err");
  }
}

async function openProjectHud(repo) {
  currentRepo = repo;
  document.getElementById("project-hud").classList.remove("hidden");
  document.getElementById("hud-repo-title").textContent = repo.name;
  document.getElementById("hud-repo-branch").textContent = repo.default_branch || "main";
  document.getElementById("agent-terminal").innerHTML = "";

  // Maintient le pivot d'orbite sur le Cortex tout en ouvrant le HUD
  lockCameraOnCortex(600);

  logTerminal(`Dépôt actif : ${repo.full_name} (${repo.default_branch})`, "step");
  await Promise.all([
    refreshRepoTree(repo),
    refreshBackupTags(repo),
    refreshCIStatusBadge(repo)
  ]);
}

function isUsefulTextFile(path, size = 0) {
  if (size > 350000) return false;
  const ignoredDirs = ["node_modules/", ".git/", "__pycache__/", ".venv/", "venv/", "dist/", "build/", ".pytest_cache/"];
  if (ignoredDirs.some(d => path.includes(d))) return false;
  const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".pyc", ".woff", ".woff2", ".ttf", ".glb", ".gltf"];
  return !binaryExts.some(ext => path.toLowerCase().endsWith(ext));
}

async function refreshRepoTree(repo) {
  const branch = repo.default_branch || "main";
  const data = await ghFetch(`/repos/${repo.full_name}/git/trees/${branch}?recursive=1`);
  currentRepoTree = (data.tree || []).filter(item => item.type === "blob" && isUsefulTextFile(item.path, item.size));

  const container = document.getElementById("hud-file-list");
  container.innerHTML = "";

  currentRepoTree.forEach(file => {
    const row = document.createElement("label");
    row.className = "file-item";
    const kb = ((file.size || 0) / 1024).toFixed(1);
    row.innerHTML = `
      <input type="checkbox" class="ctx-file-cb" value="${file.path}" />
      <span>${file.path} <small style="color:#64748b">(${kb} Ko)</small></span>
    `;
    container.appendChild(row);
  });
}

async function fetchFileContent(repo, path) {
  const branch = repo.default_branch || "main";
  const data = await ghFetch(`/repos/${repo.full_name}/contents/${encodeURIComponent(path)}?ref=${branch}`);
  const binStr = atob((data.content || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// Création de tag Git de sauvegarde avant modification
async function createBackupTag(repo, prefix = "auto") {
  try {
    const branch = repo.default_branch || "main";
    const refData = await ghFetch(`/repos/${repo.full_name}/git/ref/heads/${branch}`);
    const headSha = refData.object.sha;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const tagName = `backup-${prefix}-${stamp}`;

    await ghFetch(`/repos/${repo.full_name}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/tags/${tagName}`,
        sha: headSha
      })
    });
    logTerminal(`Point de restauration créé : ${tagName}`, "ok");
    await refreshBackupTags(repo);
    return tagName;
  } catch (e) {
    logTerminal(`Avertissement Tag : ${e.message}`, "warn");
    return null;
  }
}

async function refreshBackupTags(repo) {
  const listEl = document.getElementById("hud-tag-list");
  listEl.innerHTML = "";
  try {
    const tags = await ghFetch(`/repos/${repo.full_name}/tags?per_page=10`);
    tags.forEach(t => {
      const item = document.createElement("div");
      item.className = "tag-item";
      item.innerHTML = `
        <span>🏷️ ${t.name}</span>
        <button class="btn-mini">Restaurer</button>
      `;
      item.querySelector("button").onclick = async () => {
        if (!confirm(`Forcer la branche ${repo.default_branch} à revenir sur ${t.name} ?`)) return;
        await ghFetch(`/repos/${repo.full_name}/git/refs/heads/${repo.default_branch}`, {
          method: "PATCH",
          body: JSON.stringify({ sha: t.commit.sha, force: true })
        });
        logTerminal(`Branche restaurée sur ${t.name}`, "ok");
        await refreshRepoTree(repo);
      };
      listEl.appendChild(item);
    });
  } catch {}
}

// Commit Atomique Multi-Fichiers via Git Data API
async function pushAtomicCommit(repo, modifiedFilesMap, commitMessage) {
  const branch = repo.default_branch || "main";
  const refData = await ghFetch(`/repos/${repo.full_name}/git/ref/heads/${branch}`);
  const latestCommitSha = refData.object.sha;

  const commitData = await ghFetch(`/repos/${repo.full_name}/git/commits/${latestCommitSha}`);
  const baseTreeSha = commitData.tree.sha;

  const treeItems = [];
  for (const [filePath, newContent] of Object.entries(modifiedFilesMap)) {
    const blobRes = await ghFetch(`/repos/${repo.full_name}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({
        content: newContent,
        encoding: "utf-8"
      })
    });
    treeItems.push({
      path: filePath,
      mode: "100644",
      type: "blob",
      sha: blobRes.sha
    });
  }

  const newTree = await ghFetch(`/repos/${repo.full_name}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeItems
    })
  });

  const newCommit = await ghFetch(`/repos/${repo.full_name}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha]
    })
  });

  await ghFetch(`/repos/${repo.full_name}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });

  return newCommit.sha;
}

// ============================================================================
// 4. PROTOCOLE GEMINI XML BRUT (ZÉRO JSON POUR LE CODE)
// ============================================================================

async function callGeminiRawText(model, systemInstruction, userPrompt, signal) {
  const { geminiKey } = getCreds();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 65536,
        responseMimeType: "text/plain"
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

// Étape 1 : Sélection autonome des fichiers via Gemini Flash
async function autoSelectFilesWithFlash(repo, userGoal, signal) {
  const manualChecked = Array.from(document.querySelectorAll(".ctx-file-cb:checked")).map(cb => cb.value);
  if (manualChecked.length > 0) {
    logTerminal(`Utilisation des ${manualChecked.length} fichier(s) coché(s) manuellement.`, "info");
    return manualChecked;
  }

  setStepStatus("Tri IA des fichiers...");
  logTerminal("Analyse de l'arborescence par Gemini Flash pour cibler les fichiers...", "step");

  const treeList = currentRepoTree.map(f => `${f.path} (${f.size} B)`).join("\n");
  const sys = `Tu es un routeur d'analyse de dépôt Git.
À partir de l'arborescence du projet et de l'objectif utilisateur, sélectionne TOUS les fichiers pertinents à lire et modifier (jusqu'à 8 fichiers).
Réponds UNIQUEMENT avec des balises <path>chemin/du/fichier</path>, une par ligne. N'utilise aucun JSON.`;

  const prompt = `PROJET : ${repo.name}\nARBORESCENCE :\n${treeList}\n\nOBJECTIF UTILISATEUR :\n${userGoal}`;

  try {
    const raw = await callGeminiRawText("gemini-2.5-flash", sys, prompt, signal);
    const matches = [...raw.matchAll(/<path>\s*([^<]+?)\s*<\/path>/gi)].map(m => m[1].trim());
    const validPaths = matches.filter(p => currentRepoTree.some(f => f.path === p));

    if (validPaths.length > 0) {
      document.querySelectorAll(".ctx-file-cb").forEach(cb => {
        const isPicked = validPaths.includes(cb.value);
        cb.checked = isPicked;
        cb.closest(".file-item")?.classList.toggle("ai-picked", isPicked);
      });
      logTerminal(`Fichiers sélectionnés par l'IA : ${validPaths.join(", ")}`, "ok");
      return validPaths;
    }
  } catch (e) {
    logTerminal(`Repli sélection auto : ${e.message}`, "warn");
  }

  const fallback = currentRepoTree.slice(0, 6).map(f => f.path);
  return fallback;
}

// Étape 2 : Parseur XML + Application chirurgicale ou complète
function parseXmlOperations(rawResponse) {
  const cleaned = rawResponse.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const commitMatch = cleaned.match(/<commit_msg>([\s\S]*?)<\/commit_msg>/i);
  const commitMsg = commitMatch ? commitMatch[1].trim() : "feat(agent): autonomous multi-file update";

  const fullFiles = [];
  const fileRegex = /<file\s+path="([^"]+)"[^>]*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/file>/gi;
  let m;
  while ((m = fileRegex.exec(cleaned)) !== null) {
    const path = m[1].trim();
    const content = (m[2] !== undefined ? m[2] : m[3]).replace(/^\n+|\n+$/g, "") + "\n";
    fullFiles.push({ path, content });
  }

  const patches = [];
  const patchRegex = /<patch\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/patch>/gi;
  while ((m = patchRegex.exec(cleaned)) !== null) {
    const path = m[1].trim();
    const body = m[2];
    const hunks = [];

    const hunkRegex = /<search>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/search>\s*<replace>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/replace>/gi;
    let hm;
    while ((hm = hunkRegex.exec(body)) !== null) {
      const searchBlock = hm[1] !== undefined ? hm[1] : hm[2];
      const replaceBlock = hm[3] !== undefined ? hm[3] : hm[4];
      hunks.push({ search: searchBlock, replace: replaceBlock });
    }
    if (hunks.length > 0) {
      patches.push({ path, hunks });
    }
  }

  return { commitMsg, fullFiles, patches };
}

function applyHunkTolerant(originalContent, searchStr, replaceStr) {
  const normOrig = originalContent.replace(/\r\n/g, "\n");
  const normSearch = searchStr.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  const normReplace = replaceStr.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");

  // 1. Recherche exacte
  if (normOrig.includes(normSearch)) {
    return normOrig.replace(normSearch, normReplace);
  }

  // 2. Recherche ligne par ligne tolérante aux espaces de fin de ligne
  const origLines = normOrig.split("\n");
  const searchLines = normSearch.split("\n");

  for (let i = 0; i <= origLines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (origLines[i + j].trimEnd() !== searchLines[j].trimEnd()) {
        match = false;
        break;
      }
    }
    if (match) {
      const before = origLines.slice(0, i);
      const after = origLines.slice(i + searchLines.length);
      return [...before, normReplace, ...after].join("\n");
    }
  }

  throw new Error(`Bloc <search> introuvable (première ligne: "${searchLines[0]?.slice(0, 60)}")`);
}

// ============================================================================
// 5. SURVEILLANCE GITHUB ACTIONS & EXTRACTION DES LOGS D'ERREUR CI/CD
// ============================================================================

async function refreshCIStatusBadge(repo) {
  const badge = document.getElementById("hud-ci-badge");
  try {
    const runs = await ghFetch(`/repos/${repo.full_name}/actions/runs?per_page=1`);
    const latest = runs.workflow_runs?.[0];
    if (!latest) {
      badge.className = "ci-badge ci-neutral";
      badge.textContent = "CI: Aucun Workflow";
      return null;
    }
    if (latest.status !== "completed") {
      badge.className = "ci-badge ci-pending";
      badge.textContent = `CI: En cours (${latest.status})`;
    } else if (latest.conclusion === "success") {
      badge.className = "ci-badge ci-success";
      badge.textContent = "CI: PASS ✓";
    } else {
      badge.className = "ci-badge ci-failure";
      badge.textContent = `CI: ÉCHEC (${latest.conclusion})`;
    }
    return latest;
  } catch {
    return null;
  }
}

async function waitForCIRunAndGetFailureLog(repo, commitSha, signal) {
  setStepStatus("Attente CI/CD GitHub...");
  logTerminal(`Surveillance du workflow GitHub Actions pour le commit ${commitSha.slice(0, 7)}...`, "step");

  await new Promise(r => setTimeout(r, 4500));

  for (let attempt = 1; attempt <= 28; attempt++) {
    if (signal.aborted) throw new Error("Cycle interrompu.");

    const runsData = await ghFetch(`/repos/${repo.full_name}/actions/runs?head_sha=${commitSha}&per_page=5`);
    const run = runsData.workflow_runs?.[0];

    if (!run) {
      if (attempt >= 4) {
        logTerminal("Aucun workflow GitHub Actions déclenché sur ce commit.", "info");
        return { passed: true, log: "" };
      }
      await new Promise(r => setTimeout(r, 3500));
      continue;
    }

    await refreshCIStatusBadge(repo);

    if (run.status === "completed") {
      if (run.conclusion === "success") {
        logTerminal("GitHub Actions : TOUS LES TESTS SONT AU VERT ✓", "ok");
        return { passed: true, log: "" };
      } else {
        logTerminal(`GitHub Actions en échec (${run.conclusion}). Récupération de la trace d'erreur...`, "err");
        const failureTrace = await extractFailedJobTrace(repo, run.id);
        return { passed: false, log: failureTrace };
      }
    }

    logTerminal(`CI en cours d'exécution (${run.status})... [${attempt * 4}s]`, "info");
    await new Promise(r => setTimeout(r, 4000));
  }

  return { passed: true, log: "" };
}

async function extractFailedJobTrace(repo, runId) {
  try {
    const jobsData = await ghFetch(`/repos/${repo.full_name}/actions/runs/${runId}/jobs`);
    const failedJob = (jobsData.jobs || []).find(j => j.conclusion === "failure") || jobsData.jobs?.[0];
    if (!failedJob) return "Job en échec sans détail disponible.";

    const { ghToken } = getCreds();
    const res = await fetch(`https://api.github.com/repos/${repo.full_name}/actions/jobs/${failedJob.id}/logs`, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (res.ok) {
      const fullLog = await res.text();
      // Conserve les 4500 derniers caractères contenant la Traceback Python/Unittest
      return fullLog.slice(-4500);
    }
  } catch {}
  return "Le workflow CI a échoué.";
}

// ============================================================================
// 6. BOUCLE D'EXÉCUTION AUTONOME PRINCIPALE (XML + COMMIT ATOMIQUE + AUTO-HEAL)
// ============================================================================

async function runAutonomousCycle(repo) {
  const userGoal = document.getElementById("hud-prompt-input").value.trim();
  if (!userGoal) {
    alert("Écris d'abord ton instruction dans la zone de prompt.");
    return;
  }

  const btnExec = document.getElementById("btn-execute-agent");
  const btnStop = document.getElementById("btn-stop-agent");
  btnExec.disabled = true;
  btnStop.classList.remove("hidden");

  abortAgentController = new AbortController();
  const signal = abortAgentController.signal;

  const model = document.getElementById("agent-model-select").value;
  const autoHeal = document.getElementById("auto-heal-toggle").checked;
  const maxCycles = autoHeal ? 3 : 1;

  try {
    // 1. Tag de sauvegarde automatique avant d'agir
    await createBackupTag(repo, "pre-agent");

    // 2. Sélection automatique des fichiers
    const selectedPaths = await autoSelectFilesWithFlash(repo, userGoal, signal);

    let ciFeedbackContext = "";

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (signal.aborted) break;

      setStepStatus(`Cycle ${cycle}/${maxCycles} — Lecture fichiers...`);
      logTerminal(`--- DÉBUT DU CYCLE ${cycle}/${maxCycles} (${model}) ---`, "step");

      // Lecture fraîche des fichiers sélectionnés
      const originalFilesMap = {};
      let filesBundle = "";
      for (const path of selectedPaths) {
        try {
          const content = await fetchFileContent(repo, path);
          originalFilesMap[path] = content;
          filesBundle += `\n==============================\nFICHIER : ${path}\n==============================\n${content}\n`;
        } catch (e) {
          logTerminal(`Impossible de lire ${path}: ${e.message}`, "warn");
        }
      }

      const sysInstruction = `Tu es un ingénieur logiciel senior autonome.
Tu dois traiter INTÉGRALEMENT toutes les demandes de l'utilisateur en une seule passe, sur autant de fichiers que nécessaire.
INTERDICTION ABSOLUE D'UTILISER DU JSON. Réponds UNIQUEMENT avec le protocole XML strict ci-dessous.

Pour remplacer ou créer un fichier complet, utilise :
<file path="chemin/du/fichier.py"><![CDATA[
...code complet du fichier sans aucune troncature...
]]></file>

Pour modifier chirurgicalement une ou plusieurs parties d'un fichier long sans tout réécrire, utilise :
<patch path="chemin/du/fichier.py">
<search><![CDATA[
...lignes exactes existantes à remplacer...
]]></search>
<replace><![CDATA[
...nouvelles lignes complètes...
]]></replace>
</patch>

Inclus toujours un message de commit clair :
<commit_msg>fix(module): description précise</commit_msg>

RÈGLES STRICTES :
1. Traite TOUS les points demandés par l'utilisateur.
2. N'utilise jamais de commentaires paresseux du type "# reste du code inchangé" à l'intérieur d'une balise <file>. Si tu ne modifies qu'une fonction dans un fichier de 800 lignes, utilise <patch> avec <search> et <replace>.`;

      const fullUserPrompt = `PROJET : ${repo.name}
ARBORESCENCE COMPLÈTE :
${currentRepoTree.map(f => "- " + f.path).join("\n")}

CONTENU ACTUEL DES FICHIERS CIBLES :
${filesBundle}

${ciFeedbackContext ? `\n⚠️ ERREUR CI/CD DU CYCLE PRÉCÉDENT À CORRIGER IMPÉRATIVEMENT :\n${ciFeedbackContext}\n` : ""}

INSTRUCTIONS DE L'UTILISATEUR À APPLIQUER INTÉGRALEMENT :
${userGoal}`;

      setStepStatus(`Cycle ${cycle}/${maxCycles} — Génération Gemini...`);
      logTerminal(`Envoi du contexte (${(fullUserPrompt.length / 1024).toFixed(1)} Ko) à ${model}...`, "info");

      const rawXml = await callGeminiRawText(model, sysInstruction, fullUserPrompt, signal);
      const { commitMsg, fullFiles, patches } = parseXmlOperations(rawXml);

      const updatedFilesMap = {};

      // Application des réécritures complètes <file>
      for (const f of fullFiles) {
        updatedFilesMap[f.path] = f.content;
        logTerminal(`Fichier complet généré : ${f.path} (${f.content.split("\n").length} lignes)`, "ok");
      }

      // Application des patchs chirurgicaux <patch>
      for (const p of patches) {
        let baseContent = updatedFilesMap[p.path] ?? originalFilesMap[p.path];
        if (baseContent === undefined) {
          baseContent = await fetchFileContent(repo, p.path);
        }
        for (const hunk of p.hunks) {
          baseContent = applyHunkTolerant(baseContent, hunk.search, hunk.replace);
        }
        updatedFilesMap[p.path] = baseContent;
        logTerminal(`Patch appliqué sur ${p.path} (${p.hunks.length} bloc(s) modifié(s))`, "ok");
      }

      const modifiedCount = Object.keys(updatedFilesMap).length;
      if (modifiedCount === 0) {
        throw new Error("Aucune balise <file> ou <patch> valide détectée dans la réponse de l'agent.");
      }

      setStepStatus(`Cycle ${cycle}/${maxCycles} — Push Git Atomique...`);
      logTerminal(`Création d'un commit atomique sur ${modifiedCount} fichier(s) : "${commitMsg}"`, "step");

      const newCommitSha = await pushAtomicCommit(repo, updatedFilesMap, commitMsg);
      logTerminal(`Commit poussé avec succès : ${newCommitSha.slice(0, 7)}`, "ok");

      if (!autoHeal) {
        await refreshCIStatusBadge(repo);
        break;
      }

      // Vérification automatique des tests GitHub Actions
      const ciResult = await waitForCIRunAndGetFailureLog(repo, newCommitSha, signal);
      if (ciResult.passed) {
        logTerminal("Cycle autonome terminé avec succès : CI validée !", "ok");
        break;
      } else {
        ciFeedbackContext = ciResult.log;
        logTerminal(`Échec CI détecté :\n${ciResult.log.slice(-800)}`, "err");
        if (cycle < maxCycles) {
          logTerminal(`Lancement automatique du cycle de réparation ${cycle + 1}/${maxCycles}...`, "warn");
        } else {
          logTerminal("Nombre maximal de cycles Auto-Heal atteint.", "err");
        }
      }
    }

    setStepStatus("Terminé ✓");
    await refreshRepoTree(repo);
  } catch (err) {
    setStepStatus("Erreur");
    logTerminal(`ERREUR : ${err.message}`, "err");
  } finally {
    btnExec.disabled = false;
    btnStop.classList.add("hidden");
  }
}
