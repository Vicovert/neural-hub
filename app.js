// ============================================================================
// NEURAL DEV HUB V6.0 — ARCHITECTURE AGENTIQUE ZÉRO JSON & AUTO-HEAL CI/CD
// Modèles mis à jour : gemini-3.5-flash-lite (Routing) & gemini-3.8-flash / gemini-4-* (Code)
// ============================================================================

const BASE_ROUTING_MODEL = "gemini-3.5-flash-lite";

let graph3D = null;
let repositories = [];
let nodesMap = new Map();
let currentRepo = null;
let currentRepoTree = [];
let currentRepoIsEmpty = false;
let currentFileCache = {};
let autoSelectedPaths = [];
let stagedChanges = null;
let grantedScopes = "";
let lastAuditImprovements = [];
let lockedCameraTarget = { x: 0, y: 0, z: 0 };

let pendingRetryResolver = null;
let retryIntervalId = null;

const TEXT_EXTENSIONS = [
  ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".md",
  ".yml", ".yaml", ".json", ".toml", ".txt", ".sh", ".scad", "dockerfile"
];
const IGNORED_PATHS = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
  "node_modules/", "__pycache__/", ".git/", "dist/", "build/"
];

// ============================================================================
// 1. GESTION DU MODE PC (PRINCIPAL vs TEMPORAIRE) & ENCODAGE UTF-8 STRICT
// ============================================================================
function hasConfiguredStorageMode() {
  return localStorage.getItem("ndh_storage_mode") !== null || sessionStorage.getItem("ndh_storage_mode") !== null;
}

function getStorageMode() {
  return sessionStorage.getItem("ndh_storage_mode") || localStorage.getItem("ndh_storage_mode") || "session";
}

function getStore() {
  return getStorageMode() === "local" ? localStorage : sessionStorage;
}

function getCreds() {
  const s = getStore();
  return {
    mode: getStorageMode(),
    owner: (s.getItem("ndh_owner") || "").trim(),
    githubToken: (s.getItem("ndh_gh_token") || "").trim(),
    geminiKey: (s.getItem("ndh_gemini_key") || "").trim(),
    groqKey: (s.getItem("ndh_groq_key") || "").trim()
  };
}

function selectStorageModeCard(mode) {
  document.getElementById("cfg-storage-mode").value = mode;
  const localCard = document.getElementById("card-mode-local");
  const sessionCard = document.getElementById("card-mode-session");

  if (mode === "local") {
    localCard.className = "text-left p-3.5 rounded-xl border-2 border-cyan-400 bg-cyan-950/40 transition space-y-1";
    sessionCard.className = "text-left p-3.5 rounded-xl border-2 border-slate-700 bg-slate-900/70 hover:border-slate-500 transition space-y-1";
  } else {
    sessionCard.className = "text-left p-3.5 rounded-xl border-2 border-amber-400 bg-amber-950/40 transition space-y-1";
    localCard.className = "text-left p-3.5 rounded-xl border-2 border-slate-700 bg-slate-900/70 hover:border-slate-500 transition space-y-1";
  }
}

function updateStorageModeBadge() {
  const mode = getStorageMode();
  const ind = document.getElementById("storage-mode-indicator");
  if (!ind) return;
  ind.textContent = mode === "local" ? "💻 PC Principal (Clés sauvées)" : "🕵️ PC Temporaire (Session)";
}

function saveCredentials() {
  const mode = document.getElementById("cfg-storage-mode").value;
  if (mode === "local") {
    sessionStorage.clear();
    localStorage.setItem("ndh_storage_mode", "local");
  } else {
    ["ndh_owner", "ndh_gh_token", "ndh_gemini_key", "ndh_groq_key", "ndh_storage_mode"].forEach(k => localStorage.removeItem(k));
    sessionStorage.setItem("ndh_storage_mode", "session");
  }

  const s = mode === "local" ? localStorage : sessionStorage;
  s.setItem("ndh_owner", document.getElementById("cfg-owner").value.trim());
  s.setItem("ndh_gh_token", document.getElementById("cfg-github-token").value.trim());
  s.setItem("ndh_gemini_key", document.getElementById("cfg-gemini-key").value.trim());
  s.setItem("ndh_groq_key", document.getElementById("cfg-groq-key").value.trim());

  updateStorageModeBadge();
  closeFirstRunModal();
  loadAllRepositories();
}

function clearCredentials() {
  sessionStorage.clear();
  ["ndh_owner", "ndh_gh_token", "ndh_gemini_key", "ndh_groq_key", "ndh_storage_mode"].forEach(k => localStorage.removeItem(k));
  alert("Toutes les clés ont été purgées de ce navigateur.");
  location.reload();
}

function toggleSettingsDrawer() {
  const modal = document.getElementById("first-run-modal");
  modal.classList.toggle("hidden");
}

function closeFirstRunModal() {
  document.getElementById("first-run-modal").classList.add("hidden");
}

function toggleNewProjectDrawer() {
  document.getElementById("new-project-drawer").classList.toggle("hidden");
}

function b64DecodeUtf8(b64) {
  const clean = (b64 || "").replace(/\s/g, "");
  const binString = atob(clean);
  const bytes = Uint8Array.from(binString, m => m.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binString = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binString += String.fromCharCode(bytes[i]);
  }
  return btoa(binString);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function switchHudTab(tab) {
  ["overview", "ai", "prompt"].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
    document.getElementById(`tab-btn-${t}`).className =
      t === tab
        ? "flex-1 py-2.5 font-semibold text-cyan-400 border-b-2 border-cyan-400"
        : "flex-1 py-2.5 font-semibold text-slate-400 hover:text-slate-200";
  });
}

// ============================================================================
// 2. CERVEAU 3D V6.0 — NEURONES FIXES RESSERRÉS & CENTRAGE DYNAMIQUE AVEC HUD
// ============================================================================
function get3DViewportSize() {
  const hudOpen = document.body.classList.contains("hud-open");
  const isWide = window.innerWidth >= 900;
  const width = hudOpen && isWide ? window.innerWidth - 556 : window.innerWidth;
  return { width: Math.max(320, width), height: window.innerHeight };
}

function syncGraphViewportSize() {
  if (!graph3D) return;
  const { width, height } = get3DViewportSize();
  graph3D.width(width);
  graph3D.height(height);
}

function initBrain3D() {
  const elem = document.getElementById("3d-graph");
  const initialSize = get3DViewportSize();

  graph3D = ForceGraph3D()(elem)
    .width(initialSize.width)
    .height(initialSize.height)
    .backgroundColor("rgba(0,0,0,0)")
    .showNavInfo(false)
    .enableNodeDrag(false) // Interdiction de déplacer les projets à la souris
    .nodeRelSize(6)
    .linkWidth(l => (l.isCore ? 1.5 : 0.6))
    .linkColor(l => (l.isCore ? "rgba(56, 189, 248, 0.48)" : "rgba(148, 163, 184, 0.16)"))
    .linkDirectionalParticles(l => (l.isCore ? 2 : 1))
    .linkDirectionalParticleWidth(1.8)
    .linkDirectionalParticleSpeed(0.004)
    .nodeThreeObject(node => {
      const group = new THREE.Group();
      const radius = node.isCore ? 12 : Math.max(5, Math.min(8.5, node.sizeWeight || 6));

      const sphereMat = new THREE.MeshPhongMaterial({
        color: node.color || "#38bdf8",
        emissive: node.color || "#0284c7",
        emissiveIntensity: node.isCore ? 0.85 : 0.5,
        shininess: 100,
        transparent: true,
        opacity: 0.95
      });
      node.__sphereMat = sphereMat;
      group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 28), sphereMat));

      const haloMat = new THREE.MeshBasicMaterial({
        color: node.color || "#38bdf8",
        transparent: true,
        opacity: node.isCore ? 0.28 : 0.16,
        wireframe: !!node.isCore
      });
      node.__haloMat = haloMat;
      group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * (node.isCore ? 1.42 : 1.3), 16, 16), haloMat));

      const label = new SpriteText(node.name);
      label.color = node.isCore ? "#67e8f9" : "#f8fafc";
      label.backgroundColor = "rgba(3, 7, 18, 0.74)";
      label.padding = 1.5;
      label.borderRadius = 3;
      label.textHeight = node.isCore ? 4.8 : 3.3;
      label.position.y = radius + 5.0;
      label.material.depthTest = false;
      label.renderOrder = 999;
      group.add(label);

      return group;
    })
    .onNodeClick(node => {
      if (node.isCore) {
        closeProjectHud();
        return;
      }
      openProjectHud(node.repoData, node);
    });

  const scene = graph3D.scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dLight = new THREE.DirectionalLight(0x38bdf8, 1.3);
  dLight.position.set(120, 150, 100);
  scene.add(dLight);

  const starGeo = new THREE.BufferGeometry();
  const pts = new Float32Array(900 * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * 900;
  starGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.3, color: 0x38bdf8, transparent: true, opacity: 0.38 })));

  // Verrouillage mathématique permanent du Cortex (0,0,0) et de la cible caméra
  graph3D.onEngineTick(() => {
    const coreNode = nodesMap.get("CORTEX_CORE");
    if (coreNode) {
      coreNode.fx = 0;
      coreNode.fy = 0;
      coreNode.fz = 0;
      coreNode.x = 0;
      coreNode.y = 0;
      coreNode.z = 0;
    }
    const ctrl = graph3D.controls ? graph3D.controls() : null;
    if (ctrl && ctrl.target) {
      ctrl.target.set(lockedCameraTarget.x, lockedCameraTarget.y, lockedCameraTarget.z);
    }
  });

  window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeProjectHud();
    }
  });

  window.addEventListener("resize", () => {
    syncGraphViewportSize();
  });

  resetCamera();
}

function updateNodeColor3D(repoName, hexColor) {
  const node = nodesMap.get(repoName);
  if (!node) return;
  node.color = hexColor;
  if (node.__sphereMat) {
    node.__sphereMat.color.set(hexColor);
    node.__sphereMat.emissive.set(hexColor);
  }
  if (node.__haloMat) {
    node.__haloMat.color.set(hexColor);
  }
}

function focusNodeInViewport(node) {
  const nx = node.fx ?? node.x ?? 1;
  const ny = node.fy ?? node.y ?? 1;
  const nz = node.fz ?? node.z ?? 1;
  lockedCameraTarget = { x: nx, y: ny, z: nz };

  const dist = 75;
  const norm = Math.hypot(nx, ny, nz) || 1;
  const ratio = 1 + dist / norm;
  graph3D.cameraPosition(
    { x: nx * ratio, y: ny * ratio, z: nz * ratio },
    lockedCameraTarget,
    800
  );
}

function resetCamera() {
  lockedCameraTarget = { x: 0, y: 0, z: 0 };
  graph3D.cameraPosition({ x: 0, y: 0, z: 195 }, { x: 0, y: 0, z: 0 }, 800);
}

function closeProjectHud() {
  document.getElementById("project-hud").classList.add("hidden");
  document.body.classList.remove("hud-open");
  syncGraphViewportSize();
  resetCamera();
}

// ============================================================================
// 3. API GITHUB & SPHÈRE DE FIBONACCI COMPACTE (RAYON 72, COORDONNÉES FIXES)
// ============================================================================
async function ghFetch(endpoint, options = {}) {
  const { githubToken } = getCreds();
  const headers = {
    "Accept": "application/vnd.github+json",
    ...(options.headers || {})
  };
  if (githubToken) headers["Authorization"] = `Bearer ${githubToken}`;
  const url = endpoint.startsWith("http") ? endpoint : `https://api.github.com${endpoint}`;
  const resp = await fetch(url, { ...options, headers, cache: "no-store" });

  const scopes = resp.headers.get("x-oauth-scopes");
  if (scopes !== null) {
    grantedScopes = scopes;
    const badge = document.getElementById("scopes-badge");
    badge.classList.remove("hidden");
    const hasWorkflow = scopes.includes("workflow");
    badge.textContent = `Scopes: ${scopes || "aucun"}`;
    badge.className = hasWorkflow
      ? "text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30"
      : "text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40";
  }
  return resp;
}

async function loadAllRepositories() {
  const creds = getCreds();
  const stats = document.getElementById("stats-counter");
  if (!creds.githubToken && !creds.owner) {
    stats.textContent = "En attente de configuration...";
    document.getElementById("first-run-modal").classList.remove("hidden");
    return;
  }

  stats.textContent = "Chargement des neurones Git...";
  try {
    let owner = creds.owner;
    if (creds.githubToken) {
      const meRes = await ghFetch("/user");
      if (meRes.ok) {
        const me = await meRes.json();
        owner = me.login;
        getStore().setItem("ndh_owner", owner);
        document.getElementById("cfg-owner").value = owner;
      }
    }

    const endpoint = creds.githubToken
      ? "/user/repos?per_page=100&sort=updated&affiliation=owner"
      : `/users/${owner}/repos?per_page=100&sort=updated`;

    const res = await ghFetch(endpoint);
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    repositories = await res.json();

    buildBrainGraph(owner, repositories);
    stats.textContent = `${repositories.length} dépôts actifs (${owner})`;
  } catch (err) {
    stats.textContent = `Erreur GitHub : ${err.message}`;
  }
}

function buildBrainGraph(owner, repos) {
  nodesMap.clear();
  const coreId = "CORTEX_CORE";
  const coreNode = {
    id: coreId,
    name: `${owner || "HUB"} • CORTEX`,
    isCore: true,
    color: "#38bdf8",
    fx: 0,
    fy: 0,
    fz: 0
  };
  const nodes = [coreNode];
  nodesMap.set(coreId, coreNode);

  const links = [];
  const langBuckets = {};
  const total = Math.max(1, repos.length);
  // Rayon réduit à 72 (au lieu de 125) pour garder les neurones proches du Cortex
  const sphereRadius = 72;

  repos.forEach((r, idx) => {
    const lang = r.language || "Autre";
    const colorMap = {
      Python: "#38bdf8",
      JavaScript: "#facc15",
      TypeScript: "#60a5fa",
      HTML: "#fb923c",
      OpenSCAD: "#a855f7"
    };

    const phi = Math.acos(1 - 2 * (idx + 0.5) / total);
    const theta = Math.PI * (1 + Math.sqrt(5)) * (idx + 0.5);
    const fx = sphereRadius * Math.sin(phi) * Math.cos(theta);
    const fy = sphereRadius * Math.sin(phi) * Math.sin(theta);
    const fz = sphereRadius * Math.cos(phi);

    const node = {
      id: r.name,
      name: r.name,
      color: colorMap[lang] || "#2dd4bf",
      sizeWeight: Math.log10((r.size || 10) + 10) * 2.2,
      repoData: r,
      fx,
      fy,
      fz,
      x: fx,
      y: fy,
      z: fz
    };
    nodes.push(node);
    nodesMap.set(r.name, node);
    links.push({ source: coreId, target: r.name, isCore: true });

    if (!langBuckets[lang]) langBuckets[lang] = [];
    if (langBuckets[lang].length > 0) {
      links.push({
        source: langBuckets[lang][langBuckets[lang].length - 1],
        target: r.name,
        isCore: false
      });
    }
    langBuckets[lang].push(r.name);
  });

  graph3D.graphData({ nodes, links });
}

// ============================================================================
// 4. OUVERTURE DU HUD PROJET (AVEC RECADRAGE AUTOMATIQUE DE LA ZONE 3D)
// ============================================================================
async function openProjectHud(repo, clickedNode = null) {
  currentRepo = repo;
  currentRepoTree = [];
  currentRepoIsEmpty = false;
  currentFileCache = {};
  autoSelectedPaths = [];
  stagedChanges = null;

  document.getElementById("project-hud").classList.remove("hidden");
  document.body.classList.add("hud-open");
  syncGraphViewportSize();

  const targetNode = clickedNode || nodesMap.get(repo.name);
  if (targetNode) {
    focusNodeInViewport(targetNode);
  }

  document.getElementById("hud-staged-box").classList.add("hidden");
  document.getElementById("hud-auto-selected-box").classList.add("hidden");
  document.getElementById("hud-prompt-status").textContent = "";
  document.getElementById("hud-title").textContent = repo.name;
  document.getElementById("hud-desc").textContent = repo.description || `Branche : ${repo.default_branch} • Langage : ${repo.language || "N/A"}`;
  document.getElementById("hud-github-link").href = repo.html_url;

  checkSiteLiveStatus(repo);
  loadWorkflowRunsAndDiagnostics(repo);
  loadLastCommitInfo(repo);
  loadBackupSnapshots(repo);
  await loadRepositoryTree(repo);
  loadMetricsJson(repo);
}

function refreshCurrentProject() {
  if (currentRepo) openProjectHud(currentRepo);
}

async function checkSiteLiveStatus(repo) {
  const statusEl = document.getElementById("hud-site-status");
  const linkEl = document.getElementById("hud-site-url");
  let url = (repo.homepage || "").trim();
  if (!url && repo.has_pages) {
    url = `https://${repo.owner.login}.github.io/${repo.name}/`;
  }
  if (!url) {
    statusEl.textContent = "Aucun site web configuré";
    statusEl.className = "text-xs font-bold text-slate-400 mt-1";
    linkEl.classList.add("hidden");
    return;
  }
  linkEl.href = url;
  linkEl.classList.remove("hidden");
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store" });
    statusEl.textContent = "EN LIGNE (Répond)";
    statusEl.className = "text-xs font-bold text-emerald-400 mt-1";
  } catch {
    statusEl.textContent = "Injoignable / Hors-ligne";
    statusEl.className = "text-xs font-bold text-rose-400 mt-1";
  }
}

async function loadMetricsJson(repo) {
  const statusEl = document.getElementById("hud-sales-status");
  const subEl = document.getElementById("hud-sales-sub");
  const hasMetrics = currentRepoTree.some(f => f.path === "metrics.json");
  if (!hasMetrics) {
    statusEl.textContent = "Projet non-marchand";
    statusEl.className = "text-xs font-bold text-slate-400 mt-1";
    subEl.textContent = "Pas de fichier metrics.json à la racine";
    return;
  }
  try {
    const content = await fetchFileContent(repo, "metrics.json");
    const data = JSON.parse(content);
    statusEl.textContent = `${data.revenue || 0} € (${data.sales_count || 0} achats)`;
    statusEl.className = "text-xs font-bold text-emerald-400 mt-1";
    subEl.textContent = data.last_sale ? `Dernier achat : ${data.last_sale}` : "Flux actif";
  } catch (e) {
    statusEl.textContent = "Erreur lecture metrics.json";
    subEl.textContent = e.message;
  }
}

async function loadWorkflowRunsAndDiagnostics(repo) {
  const badge = document.getElementById("hud-workflow-badge");
  const listEl = document.getElementById("hud-actions-list");
  badge.textContent = "SCAN...";
  badge.className = "px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-slate-700 text-slate-200";
  listEl.innerHTML = "Interrogation de GitHub Actions...";

  try {
    const res = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/actions/runs?per_page=3`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const runs = data.workflow_runs || [];

    if (runs.length === 0) {
      badge.textContent = "SANS CI";
      updateNodeColor3D(repo.name, "#38bdf8");
      listEl.innerHTML = `<div class="text-slate-400">Aucun workflow exécuté sur ce dépôt.</div>`;
      return;
    }

    const latest = runs[0];
    if (latest.status !== "completed") {
      badge.textContent = "EN COURS";
      badge.className = "px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/40";
      updateNodeColor3D(repo.name, "#facc15");
    } else if (latest.conclusion === "success") {
      badge.textContent = "CI OK";
      badge.className = "px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
      updateNodeColor3D(repo.name, "#10b981");
    } else {
      badge.textContent = "ERREUR CI";
      badge.className = "px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-rose-500/20 text-rose-300 border border-rose-500/40";
      updateNodeColor3D(repo.name, "#f43f5e");
    }

    let html = "";
    for (const run of runs) {
      const icon = run.conclusion === "success" ? "🟢" : (run.status !== "completed" ? "🟡" : "🔴");
      const dateStr = new Date(run.created_at).toLocaleString("fr-FR");
      let failureDetail = "";

      if (run.conclusion === "failure") {
        const jobsRes = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/actions/runs/${run.id}/jobs`);
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          for (const j of jobsData.jobs || []) {
            const badStep = (j.steps || []).find(s => s.conclusion === "failure");
            if (badStep) {
              failureDetail = `<div class="mt-1 text-[11px] text-rose-300 bg-rose-950/50 p-1.5 rounded border border-rose-500/30">
                Étape plantée : <b>${escapeHtml(badStep.name)}</b> (Job: ${escapeHtml(j.name)})
              </div>`;
            }
          }
        }
      }

      html += `
        <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold">${icon} ${escapeHtml(run.name)} #${run.run_number}</span>
            <div class="flex items-center gap-1.5">
              <button onclick="rerunWorkflow(${run.id})" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/30">▶ Re-run</button>
              <a href="${run.html_url}" target="_blank" class="text-[10px] text-slate-400 hover:text-white underline">Logs ↗</a>
            </div>
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5">${dateStr} • Événement : ${run.event}</div>
          ${failureDetail}
        </div>
      `;
    }
    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = `<div class="text-rose-400">Erreur lecture Actions : ${e.message}</div>`;
  }
}

async function rerunWorkflow(runId) {
  if (!currentRepo) return;
  const res = await ghFetch(`/repos/${currentRepo.owner.login}/${currentRepo.name}/actions/runs/${runId}/rerun`, { method: "POST" });
  if (res.ok || res.status === 201) {
    alert("Relance (Re-run) envoyée à GitHub Actions !");
    setTimeout(() => loadWorkflowRunsAndDiagnostics(currentRepo), 2000);
  } else {
    alert(`Échec de relance (${res.status}) : ${await res.text()}`);
  }
}

async function triggerWorkflowDispatch() {
  if (!currentRepo) return;
  const res = await ghFetch(`/repos/${currentRepo.owner.login}/${currentRepo.name}/actions/workflows`);
  if (!res.ok) return alert("Impossible de lister les workflows.");
  const data = await res.json();
  const wf = (data.workflows || [])[0];
  if (!wf) return alert("Aucun fichier workflow trouvé dans ce dépôt.");

  const disp = await ghFetch(`/repos/${currentRepo.owner.login}/${currentRepo.name}/actions/workflows/${wf.id}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: currentRepo.default_branch })
  });
  if (disp.status === 204) {
    alert(`Workflow '${wf.name}' déclenché sur ${currentRepo.default_branch} !`);
    setTimeout(() => loadWorkflowRunsAndDiagnostics(currentRepo), 2500);
  } else {
    alert("Ce workflow ne contient pas 'workflow_dispatch:' dans son YAML. Utilise le bouton '▶ Re-run' juste en dessous !");
  }
}

async function loadLastCommitInfo(repo) {
  const el = document.getElementById("hud-last-commit");
  const res = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/commits?per_page=1`);
  if (!res.ok) {
    el.textContent = "Aucun commit (Dépôt vide).";
    return;
  }
  const commits = await res.json();
  if (!commits.length) {
    el.textContent = "Aucun commit.";
    return;
  }
  const c = commits[0];
  const dateStr = new Date(c.commit.author.date).toLocaleString("fr-FR");
  el.innerHTML = `
    <div class="font-semibold text-white">${escapeHtml(c.commit.message)}</div>
    <div class="text-[10px] text-slate-400 mt-0.5">SHA: <code>${c.sha.slice(0, 7)}</code> • ${dateStr}</div>
  `;
}

// ============================================================================
// 4B. BACKUPS GIT AUTOMATIQUES (`backup-pre-agent-*`) & RESTAURATION
// ============================================================================
function generateBackupTagName(prefix = "backup-pre-agent") {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${stamp}`;
}

async function createGitBackupSnapshot(owner, repoName, commitSha, tagPrefix = "backup-pre-agent") {
  const tagName = generateBackupTagName(tagPrefix);
  const res = await ghFetch(`/repos/${owner}/${repoName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/tags/${tagName}`,
      sha: commitSha
    })
  });
  if (!res.ok) return null;
  return tagName;
}

async function createManualBackupSnapshot() {
  if (!currentRepo) return;
  try {
    const owner = currentRepo.owner.login;
    const repo = currentRepo.name;
    const branch = currentRepo.default_branch;

    const refRes = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    if (!refRes.ok) return alert("Dépôt vide : rien à sauvegarder.");
    const refData = await refRes.json();

    const tag = await createGitBackupSnapshot(owner, repo, refData.object.sha, "backup-manuel");
    if (tag) {
      alert(`Point de sauvegarde créé : ${tag}`);
      loadBackupSnapshots(currentRepo);
    }
  } catch (e) {
    alert(`Erreur création backup : ${e.message}`);
  }
}

async function loadBackupSnapshots(repo) {
  const listEl = document.getElementById("hud-backups-list");
  listEl.innerHTML = "Recherche des sauvegardes...";

  try {
    const res = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/git/matching-refs/tags/backup`);
    if (!res.ok) {
      listEl.innerHTML = `<div class="text-[11px] text-slate-500">Aucune sauvegarde disponible.</div>`;
      return;
    }
    const refs = await res.json();
    if (!Array.isArray(refs) || refs.length === 0) {
      listEl.innerHTML = `<div class="text-[11px] text-slate-500">Aucune backup enregistrée.</div>`;
      return;
    }

    const latestBackups = refs.slice(-6).reverse();
    let html = "";

    for (const r of latestBackups) {
      const tagName = r.ref.replace("refs/tags/", "");
      const sha = r.object.sha;
      let commitMsg = `Commit ${sha.slice(0, 7)}`;
      try {
        const cRes = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/git/commits/${sha}`);
        if (cRes.ok) {
          const cData = await cRes.json();
          commitMsg = cData.message.split("\n")[0];
        }
      } catch {}

      html += `
        <div class="flex items-center justify-between gap-2 bg-slate-950/70 px-2.5 py-1.5 rounded border border-slate-800">
          <div class="min-w-0">
            <div class="font-mono text-[10px] text-cyan-300 font-bold truncate">${escapeHtml(tagName)}</div>
            <div class="text-[10px] text-slate-400 truncate">${escapeHtml(commitMsg)} (${sha.slice(0, 7)})</div>
          </div>
          <button onclick="restoreFromBackupTag('${escapeHtml(tagName)}', '${sha}')" class="shrink-0 text-[10px] bg-emerald-950 hover:bg-emerald-800 text-emerald-300 px-2 py-1 rounded border border-emerald-500/30 font-semibold transition">
            Restaurer
          </button>
        </div>
      `;
    }
    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = `<div class="text-[11px] text-rose-400">Erreur lecture backups : ${e.message}</div>`;
  }
}

async function restoreFromBackupTag(tagName, targetCommitSha) {
  if (!currentRepo) return;
  if (!confirm(`Restaurer '${currentRepo.name}' exactement à l'état de la sauvegarde '${tagName}' ?`)) return;

  try {
    const owner = currentRepo.owner.login;
    const repo = currentRepo.name;
    const branch = currentRepo.default_branch;

    const headRes = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const headData = await headRes.json();
    const currentHeadSha = headData.object.sha;

    await createGitBackupSnapshot(owner, repo, currentHeadSha, "backup-avant-restore");

    const targetCommitRes = await ghFetch(`/repos/${owner}/${repo}/git/commits/${targetCommitSha}`);
    if (!targetCommitRes.ok) throw new Error("Impossible de lire le commit de sauvegarde.");
    const targetCommit = await targetCommitRes.json();

    const restoreCommitRes = await ghFetch(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `Restauration depuis sauvegarde ${tagName} (${targetCommitSha.slice(0, 7)})`,
        tree: targetCommit.tree.sha,
        parents: [currentHeadSha]
      })
    });
    if (!restoreCommitRes.ok) throw new Error(await restoreCommitRes.text());
    const newCommit = await restoreCommitRes.json();

    const patchRef = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommit.sha, force: false })
    });
    if (!patchRef.ok) throw new Error(await patchRef.text());

    alert(`Dépôt restauré à l'état '${tagName}' !`);
    refreshCurrentProject();
  } catch (e) {
    alert(`Erreur lors de la restauration : ${e.message}`);
  }
}

async function rollbackLastCommit() {
  if (!currentRepo) return;
  if (!confirm(`Voulez-vous faire un rollback vers le commit précédent sur ${currentRepo.name} ?`)) return;

  try {
    const owner = currentRepo.owner.login;
    const repo = currentRepo.name;
    const branch = currentRepo.default_branch;

    const commitsRes = await ghFetch(`/repos/${owner}/${repo}/commits?sha=${branch}&per_page=2`);
    const commits = await commitsRes.json();
    if (!commits || commits.length < 2) {
      return alert("Impossible de faire un rollback : il n'y a qu'un seul commit dans l'historique.");
    }
    const latestCommitSha = commits[0].sha;
    const parentTreeSha = commits[1].commit.tree.sha;

    await createGitBackupSnapshot(owner, repo, latestCommitSha, "backup-avant-rollback");

    const newCommitRes = await ghFetch(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `Rollback vers le commit ${commits[1].sha.slice(0, 7)}`,
        tree: parentTreeSha,
        parents: [latestCommitSha]
      })
    });
    if (!newCommitRes.ok) throw new Error(await newCommitRes.text());
    const newCommit = await newCommitRes.json();

    const refRes = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommit.sha, force: false })
    });
    if (!refRes.ok) throw new Error(await refRes.text());

    alert("Rollback effectué proprement !");
    refreshCurrentProject();
  } catch (e) {
    alert(`Erreur Rollback : ${e.message}`);
  }
}

// ============================================================================
// 5. ARBORESCENCE & ROUTING AUTOMATIQUE (`gemini-3.5-flash-lite`)
// ============================================================================
function isUsefulTextFile(filePath, size = 0) {
  const lower = filePath.toLowerCase();
  if (size > 150000) return false;
  if (IGNORED_PATHS.some(ig => lower.includes(ig))) return false;
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

async function loadRepositoryTree(repo) {
  const countBadge = document.getElementById("hud-repo-file-count");
  const res = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/git/trees/${repo.default_branch}?recursive=1`);
  if (res.status === 409 || res.status === 404) {
    currentRepoIsEmpty = true;
    currentRepoTree = [];
    if (countBadge) countBadge.textContent = "Dépôt vide";
    return;
  }

  const data = await res.json();
  currentRepoTree = (data.tree || []).filter(item => item.type === "blob");
  if (countBadge) countBadge.textContent = `${currentRepoTree.length} fichiers indexés`;
}

async function fetchFileContent(repo, path, forceRefresh = false) {
  if (!forceRefresh && currentFileCache[path] !== undefined) return currentFileCache[path];
  const res = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/contents/${encodeURIComponent(path)}?ref=${repo.default_branch}`);
  if (!res.ok) throw new Error(`Impossible de lire ${path}`);
  const data = await res.json();
  const decoded = b64DecodeUtf8(data.content || "");
  currentFileCache[path] = decoded;
  return decoded;
}

function renderAutoSelectedBadges(paths) {
  const box = document.getElementById("hud-auto-selected-box");
  const container = document.getElementById("hud-auto-selected-badges");
  if (!box || !container) return;

  if (!paths || paths.length === 0) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  container.innerHTML = paths.map(p => `
    <span class="px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-500/30">${escapeHtml(p)}</span>
  `).join("");
}

// Sélection 100 % automatique des fichiers pertinents par gemini-3.5-flash-lite
async function autoSelectFilesWithBaseModel(promptText) {
  if (currentRepoTree.length === 0) {
    autoSelectedPaths = [];
    return [];
  }

  const fallbackFiles = currentRepoTree
    .filter(f => isUsefulTextFile(f.path, f.size))
    .slice(0, 8)
    .map(f => f.path);

  const creds = getCreds();
  if (!creds.geminiKey) {
    autoSelectedPaths = fallbackFiles;
    renderAutoSelectedBadges(autoSelectedPaths);
    return autoSelectedPaths;
  }

  const treePaths = currentRepoTree.map(f => f.path).join("\n");
  const sys = `Tu es l'agent de routage de fichiers de Neural Dev Hub V6.0.
Analyse l'arborescence complète du dépôt et la demande utilisateur.
Sélectionne jusqu'à 8 fichiers existants les plus pertinents à lire ou modifier pour répondre à la demande.
Réponds UNIQUEMENT avec des balises XML <path> contenant le chemin exact :
<paths>
<path>chemin/exact/fichier1.py</path>
<path>chemin/exact/fichier2.js</path>
</paths>`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${BASE_ROUTING_MODEL}:generateContent?key=${creds.geminiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: `ARBORESCENCE :\n${treePaths}\n\nDEMANDE :\n${promptText}` }] }],
        generationConfig: { temperature: 0.0, responseMimeType: "text/plain" }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const rawXml = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const validPathsSet = new Set(currentRepoTree.map(f => f.path));
      const selected = Array.from(rawXml.matchAll(/<path>([\s\S]*?)<\/path>/gi))
        .map(m => m[1].trim())
        .filter(p => validPathsSet.has(p))
        .slice(0, 8);

      if (selected.length > 0) {
        autoSelectedPaths = selected;
        renderAutoSelectedBadges(autoSelectedPaths);
        return autoSelectedPaths;
      }
    }
  } catch (e) {
    console.warn("Repli autoSelectFilesWithBaseModel :", e);
  }

  autoSelectedPaths = fallbackFiles;
  renderAutoSelectedBadges(autoSelectedPaths);
  return autoSelectedPaths;
}

async function gatherSelectedContext(repo, explicitPaths = null) {
  const pathsToLoad = (explicitPaths && explicitPaths.length > 0) ? explicitPaths : autoSelectedPaths;
  let bundle = `PROJET : ${repo.name}\nARBORESCENCE COMPLÈTE DU DÉPÔT :\n${currentRepoTree.map(f => "- " + f.path).join("\n")}\n\n`;
  for (const p of pathsToLoad.slice(0, 10)) {
    try {
      const code = await fetchFileContent(repo, p);
      bundle += `\n=== FICHIER ACTUEL : ${p} ===\n${code}\n`;
    } catch {}
  }
  return bundle;
}

// ============================================================================
// 6. ROUTEUR MULTI-AGENTS EN TEXTE BRUT (XML / CDATA — ZÉRO JSON)
// ============================================================================
async function detectLocalOllama() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1400);
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const opt = document.getElementById("ollama-opt");
      opt.disabled = false;
      opt.textContent = "Ollama Local (Connecté sur :11434)";
    }
  } catch {}
}

function cancelRetryLoop() {
  if (retryIntervalId) clearInterval(retryIntervalId);
  retryIntervalId = null;
  document.getElementById("rate-limit-panel").classList.add("hidden");
  if (pendingRetryResolver) {
    pendingRetryResolver({ action: "cancel" });
    pendingRetryResolver = null;
  }
}

function startActiveWaitLoop() {
  const subEl = document.getElementById("rl-wait-sub");
  const btnWait = document.getElementById("btn-rl-wait");
  btnWait.disabled = true;

  let secondsLeft = 15;
  subEl.textContent = `Nouvelle tentative automatique dans ${secondsLeft}s...`;

  if (retryIntervalId) clearInterval(retryIntervalId);
  retryIntervalId = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(retryIntervalId);
      retryIntervalId = null;
      btnWait.disabled = false;
      subEl.textContent = "Tentative de connexion en cours...";
      if (pendingRetryResolver) {
        pendingRetryResolver({ action: "retry" });
        pendingRetryResolver = null;
      }
    } else {
      subEl.textContent = `Nouvelle tentative automatique dans ${secondsLeft}s...`;
    }
  }, 1000);
}

function switchFallbackModel(newAgentValue) {
  if (retryIntervalId) clearInterval(retryIntervalId);
  retryIntervalId = null;
  document.getElementById("agent-selector").value = newAgentValue;
  document.getElementById("rate-limit-panel").classList.add("hidden");
  if (pendingRetryResolver) {
    pendingRetryResolver({ action: "switch", agent: newAgentValue });
    pendingRetryResolver = null;
  }
}

function askUserOnSaturation(statusCode, modelName, rawErrorMsg = "") {
  return new Promise(resolve => {
    pendingRetryResolver = resolve;
    const panel = document.getElementById("rate-limit-panel");
    const title = document.getElementById("rl-title");
    const desc = document.getElementById("rl-desc");

    title.textContent = statusCode === 429
      ? `Quota atteint sur ${modelName} (HTTP 429)`
      : `Pic de charge sur ${modelName} (HTTP 503)`;

    let detailHtml = "";
    if (rawErrorMsg) {
      detailHtml = `<div class="mt-1.5 p-1.5 bg-slate-950/90 rounded border border-slate-800 text-[10px] text-amber-200 break-words">${escapeHtml(rawErrorMsg.slice(0, 220))}</div>`;
    }

    desc.innerHTML = `Le modèle <b>${escapeHtml(modelName)}</b> est temporairement indisponible. Comment veux-tu procéder ?${detailHtml}`;
    document.getElementById("btn-rl-flash").classList.toggle("hidden", modelName === "gemini-3.5-flash-lite");
    document.getElementById("btn-rl-groq").classList.toggle("hidden", !getCreds().groqKey);
    document.getElementById("btn-rl-wait").disabled = false;
    panel.classList.remove("hidden");
  });
}

async function callSelectedAgentRawXml(systemInstruction, userPrompt) {
  const sel = document.getElementById("agent-selector").value;
  const [provider, modelName] = sel.split(":");
  const creds = getCreds();

  if (provider === "gemini") {
    if (!creds.geminiKey) throw new Error("Clé API Gemini manquante dans 'Clés & Mode PC'.");
    return await callGeminiRawText(modelName, creds.geminiKey, systemInstruction, userPrompt);
  }

  if (provider === "groq") {
    if (!creds.groqKey) throw new Error("Clé API Groq manquante dans 'Clés & Mode PC'.");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${creds.groqKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt }
        ]
      })
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  if (provider === "ollama") {
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt }
        ]
      })
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data.message?.content || "";
  }
}

async function callGeminiRawText(model, apiKey, sysPrompt, userPrompt, autoWaitMode = false) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sysPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 65536,
        responseMimeType: "text/plain"
      }
    })
  });

  if (res.status === 429 || res.status === 503) {
    let apiErrMsg = "";
    try {
      const errJson = await res.json();
      apiErrMsg = errJson.error?.message || "";
    } catch {}

    if (autoWaitMode) {
      const decision = await new Promise(resolve => {
        pendingRetryResolver = resolve;
        startActiveWaitLoop();
      });
      if (decision && decision.action === "cancel") throw new Error("Requête annulée par l'utilisateur.");
      if (decision && decision.action === "switch") return await callSelectedAgentRawXml(sysPrompt, userPrompt);
      return await callGeminiRawText(model, apiKey, sysPrompt, userPrompt, true);
    }

    const decision = await askUserOnSaturation(res.status, model, apiErrMsg);
    if (decision.action === "cancel") throw new Error("Requête annulée par l'utilisateur.");
    if (decision.action === "switch") return await callSelectedAgentRawXml(sysPrompt, userPrompt);
    if (decision.action === "retry") return await callGeminiRawText(model, apiKey, sysPrompt, userPrompt, true);
  }

  document.getElementById("rate-limit-panel").classList.add("hidden");
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ============================================================================
// 7. AUDIT VULGARISÉ & CONCRET + PARSEUR XML / CDATA V6.0 (`<file>`, `<patch>`)
// ============================================================================
async function analyzeCurrentRepo() {
  if (!currentRepo) return;
  const btn = document.getElementById("btn-analyze-repo");
  const out = document.getElementById("hud-ai-analysis");
  btn.disabled = true;
  btn.textContent = "Analyse en cours...";
  out.innerHTML = "1/2 Sélection automatique des fichiers clés par Gemini 3.5 Flash-Lite...";

  try {
    await autoSelectFilesWithBaseModel("Audit complet du fonctionnement du projet et propositions d'améliorations concrètes");
    out.innerHTML = "2/2 Rédaction de l'audit clair et sans jargon...";
    const context = await gatherSelectedContext(currentRepo);

    const sys = `Tu es un conseiller technique pédagogue et pragmatique.
Ton objectif est d'expliquer ce dépôt Git simplement, sans jargon abstrait ni phrases compliquées, et de proposer 3 à 4 améliorations très concrètes dont l'utilité est immédiatement compréhensible.

Réponds UNIQUEMENT en XML brut avec CDATA selon cette structure exacte :
<audit>
  <architecture_summary><![CDATA[Explique en 2 ou 3 phrases très simples à quoi sert ce projet et ce qu'il fait concrètement.]]></architecture_summary>
  <how_it_works><![CDATA[Explique étape par étape comment le projet fonctionne en pratique (ex: 1. Entrée, 2. Traitement, 3. Résultat) avec des mots simples.]]></how_it_works>
  <improvement>
    <title><![CDATA[Titre court et parlant (ex: Éviter le blocage quand un fichier est vide)]]></title>
    <problem><![CDATA[Quel est le problème ou le manque actuel expliqué simplement en 1 phrase.]]></problem>
    <benefit><![CDATA[Ce que cette amélioration va t'apporter concrètement à l'usage en 1 phrase.]]></benefit>
    <ready_prompt><![CDATA[Instruction technique complète et précise à donner à l'agent de code pour réaliser cette modification.]]></ready_prompt>
  </improvement>
</audit>`;

    const rawXml = await callSelectedAgentRawXml(sys, context);
    const extractTag = (src, tag) => {
      const m = src.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
      if (!m) return "";
      const cdata = m[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
      return (cdata ? cdata[1] : m[1]).trim();
    };

    const archSummary = extractTag(rawXml, "architecture_summary") || "Résumé non disponible.";
    const howItWorks = extractTag(rawXml, "how_it_works") || "Détails non disponibles.";

    lastAuditImprovements = [];
    const impRegex = /<improvement>([\s\S]*?)<\/improvement>/gi;
    let m;
    while ((m = impRegex.exec(rawXml)) !== null) {
      const block = m[1];
      lastAuditImprovements.push({
        title: extractTag(block, "title") || "Amélioration",
        problem: extractTag(block, "problem") || extractTag(block, "description") || "",
        benefit: extractTag(block, "benefit") || "",
        ready_prompt: extractTag(block, "ready_prompt") || ""
      });
    }

    const impHtml = lastAuditImprovements.map((imp, idx) => `
      <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
        <label class="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" class="audit-imp-cb mt-0.5 accent-cyan-500" value="${idx}" checked />
          <div class="flex-1 space-y-1">
            <div class="font-bold text-cyan-300 text-xs">${idx + 1}. ${escapeHtml(imp.title)}</div>
            ${imp.problem ? `<div class="text-[11px] text-slate-300"><span class="text-amber-300 font-semibold">Pourquoi :</span> ${escapeHtml(imp.problem)}</div>` : ""}
            ${imp.benefit ? `<div class="text-[11px] text-slate-300"><span class="text-emerald-300 font-semibold">Résultat concret :</span> ${escapeHtml(imp.benefit)}</div>` : ""}
          </div>
        </label>
        <div class="pl-6">
          <button type="button" onclick="applySingleImprovement(${idx})" class="text-[11px] bg-slate-800 hover:bg-cyan-700 text-cyan-200 hover:text-white px-2.5 py-1 rounded border border-cyan-500/30 font-semibold transition">
            Coder cette amélioration →
          </button>
        </div>
      </div>
    `).join("");

    const batchBtnHtml = lastAuditImprovements.length > 0 ? `
      <button type="button" onclick="applySelectedImprovements()" class="w-full bg-cyan-600 hover:bg-cyan-500 text-white py-2 rounded-lg font-bold shadow transition">
        Coder les améliorations cochées en une fois →
      </button>
    ` : "";

    out.innerHTML = `
      <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
        <div class="text-cyan-400 font-bold uppercase text-[11px] mb-1">À quoi sert ce projet</div>
        <p>${escapeHtml(archSummary)}</p>
      </div>
      <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
        <div class="text-cyan-400 font-bold uppercase text-[11px] mb-1">Comment ça marche en pratique</div>
        <p class="whitespace-pre-line">${escapeHtml(howItWorks)}</p>
      </div>
      <div class="space-y-2">
        <div class="text-cyan-400 font-bold uppercase text-[11px]">Propositions concrètes (Coche et lance)</div>
        ${impHtml}
        ${batchBtnHtml}
      </div>
    `;
  } catch (e) {
    out.innerHTML = `<div class="text-rose-400">Erreur d'audit : ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Lancer l'Audit Clair";
  }
}

function applySingleImprovement(index) {
  const imp = lastAuditImprovements[index];
  if (!imp) return;
  switchHudTab("prompt");
  document.getElementById("hud-prompt-input").value = imp.ready_prompt;
}

function applySelectedImprovements() {
  const selectedIndexes = Array.from(document.querySelectorAll(".audit-imp-cb:checked"))
    .map(cb => parseInt(cb.value, 10));
  if (selectedIndexes.length === 0) return alert("Coche au moins une amélioration.");

  const combinedPrompt = selectedIndexes
    .map((idx, i) => `### Amélioration ${i + 1} : ${lastAuditImprovements[idx].title}\n${lastAuditImprovements[idx].ready_prompt}`)
    .join("\n\n");

  switchHudTab("prompt");
  document.getElementById("hud-prompt-input").value =
    `Applique conjointement les améliorations suivantes en veillant à leur cohérence globale :\n\n${combinedPrompt}`;
}

function extractCdataContent(rawInner) {
  const cdataMatch = rawInner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  const content = cdataMatch ? cdataMatch[1] : rawInner;
  return content.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function applyRawPatchBlocks(originalContent, patchBody, filePath) {
  let updated = originalContent.replace(/\r\n/g, "\n");
  const normalizedPatch = patchBody.replace(/\r\n/g, "\n");
  const blockRegex = /<<<<\s*SEARCH\n([\s\S]*?)\n====\n([\s\S]*?)\n>>>>\s*REPLACE/g;
  let match;
  let count = 0;

  while ((match = blockRegex.exec(normalizedPatch)) !== null) {
    count++;
    const searchStr = match[1];
    const replaceStr = match[2];
    const idx = updated.indexOf(searchStr);
    if (idx === -1) {
      throw new Error(`Bloc <<<< SEARCH #${count} introuvable dans '${filePath}'.`);
    }
    updated = updated.slice(0, idx) + replaceStr + updated.slice(idx + searchStr.length);
  }

  if (count === 0 && normalizedPatch.trim().length > 0) {
    return normalizedPatch;
  }
  return updated;
}

async function parseAndCompileAgentXml(rawText, repo) {
  const cleanText = (rawText || "").trim();
  let summary = "Modification générée via protocole XML/CDATA V6.0";
  let commitMsg = "Update via Neural Dev Hub V6.0";

  const sumMatch = cleanText.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (sumMatch) summary = extractCdataContent(sumMatch[1]).trim();

  const msgMatch = cleanText.match(/<commit_msg>([\s\S]*?)<\/commit_msg>/i);
  if (msgMatch) commitMsg = extractCdataContent(msgMatch[1]).trim();

  const compiledFiles = [];
  const diffPreviewHtml = [];

  const fileRegex = /<file\s+path=["']([^"']+)["'](?:\s+action=["']([^"']+)["'])?\s*>([\s\S]*?)<\/file>/gi;
  let match;
  while ((match = fileRegex.exec(cleanText)) !== null) {
    const path = match[1].trim();
    const action = (match[2] || "upsert").trim().toLowerCase();
    const content = extractCdataContent(match[3] || "");

    if (action === "delete") {
      compiledFiles.push({ path, action: "delete", content: "" });
      diffPreviewHtml.push(`
        <details class="bg-slate-900 rounded-lg border border-rose-500/30 p-2">
          <summary class="cursor-pointer font-mono text-[11px] font-bold text-rose-400">[DELETE] ${escapeHtml(path)}</summary>
        </details>
      `);
    } else {
      compiledFiles.push({ path, action: "upsert", content });
      diffPreviewHtml.push(`
        <details class="bg-slate-900 rounded-lg border border-emerald-500/30 p-2" open>
          <summary class="cursor-pointer font-mono text-[11px] font-bold text-emerald-300">
            [FILE] ${escapeHtml(path)} (${content.split("\n").length} lignes)
          </summary>
          <pre class="mt-2 p-2 bg-slate-950 rounded text-[10px] text-emerald-200 overflow-x-auto max-h-48">${escapeHtml(content)}</pre>
        </details>
      `);
    }
  }

  const patchRegex = /<patch\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/patch>/gi;
  while ((match = patchRegex.exec(cleanText)) !== null) {
    const path = match[1].trim();
    const patchBody = extractCdataContent(match[2] || "");
    const original = await fetchFileContent(repo, path);
    const patchedContent = applyRawPatchBlocks(original, patchBody, path);

    compiledFiles.push({ path, action: "upsert", content: patchedContent });
    diffPreviewHtml.push(`
      <details class="bg-slate-900 rounded-lg border border-cyan-500/30 p-2" open>
        <summary class="cursor-pointer font-mono text-[11px] font-bold text-cyan-300">
          [PATCH] ${escapeHtml(path)} (${original.split("\n").length} → ${patchedContent.split("\n").length} lignes)
        </summary>
        <pre class="mt-2 p-2 bg-slate-950 rounded text-[10px] text-cyan-200 overflow-x-auto max-h-48">${escapeHtml(patchBody)}</pre>
      </details>
    `);
  }

  if (compiledFiles.length === 0) {
    throw new Error("Aucune balise <file> ou <patch> détectée dans la réponse de l'agent.");
  }

  return { summary, commit_message: commitMsg, files: compiledFiles, previewHtml: diffPreviewHtml.join("") };
}

// ============================================================================
// 8. GÉNÉRATION XML, COMMIT ATOMIQUE (`pushAtomicCommit`) & AUTO-HEAL CI/CD
// ============================================================================
const XML_CODE_SYSTEM_PROMPT = `Tu es l'agent logiciel autonome de Neural Dev Hub V6.0 (façon Claude Code Web).
INTERDICTION ABSOLUE D'UTILISER DU JSON. Réponds UNIQUEMENT en XML brut avec des sections CDATA.

Format obligatoire de ta réponse :
<response>
<summary><![CDATA[Explication simple et concise des modifications]]></summary>
<commit_msg><![CDATA[feat/fix: message de commit clair]]></commit_msg>

<!-- Pour créer un nouveau fichier ou remplacer un fichier complet : -->
<file path="chemin/vers/fichier.py"><![CDATA[
# Code complet du fichier sans aucune troncature
]]></file>

<!-- OU pour patcher chirurgicalement un long fichier existant : -->
<patch path="chemin/vers/fichier_existant.py"><![CDATA[
<<<< SEARCH
lignes exactes existantes
====
nouvelles lignes de remplacement
>>>> REPLACE
]]></patch>
</response>

RÈGLES STRICTES :
1. N'échappe aucun caractère dans les blocs <![CDATA[ ... ]]>, écris le code pur tel quel.
2. Si tu crées un workflow GitHub Actions (.github/workflows/*.yml), inclus toujours 'workflow_dispatch:'.`;

async function proposeCodeChanges() {
  if (!currentRepo) return;
  const promptText = document.getElementById("hud-prompt-input").value.trim();
  if (!promptText) return alert("Écris d'abord une instruction pour l'agent.");

  const btn = document.getElementById("btn-generate-changes");
  const statusEl = document.getElementById("hud-prompt-status");
  btn.disabled = true;
  btn.textContent = `1/2 Tri automatique des fichiers (${BASE_ROUTING_MODEL})...`;
  statusEl.textContent = `Scan de l'arborescence par ${BASE_ROUTING_MODEL} pour sélectionner les fichiers utiles...`;

  try {
    const selectedFiles = await autoSelectFilesWithBaseModel(promptText);

    btn.textContent = "2/2 Téléchargement des fichiers & Génération XML...";
    statusEl.textContent = `${selectedFiles.length} fichier(s) retenu(s). Génération du code avec l'Agent Principal...`;
    const context = await gatherSelectedContext(currentRepo, selectedFiles);

    const rawResponse = await callSelectedAgentRawXml(
      XML_CODE_SYSTEM_PROMPT,
      `${context}\n\nINSTRUCTION À CODER :\n${promptText}`
    );

    const compiled = await parseAndCompileAgentXml(rawResponse, currentRepo);
    stagedChanges = {
      promptText,
      summary: compiled.summary,
      commit_message: compiled.commit_message,
      files: compiled.files
    };

    document.getElementById("hud-staged-box").classList.remove("hidden");
    document.getElementById("hud-staged-count").textContent = `${compiled.files.length} fichier(s)`;
    document.getElementById("hud-staged-summary").textContent = compiled.summary;
    document.getElementById("hud-commit-msg").value = compiled.commit_message;
    document.getElementById("hud-staged-files").innerHTML = compiled.previewHtml;
    statusEl.textContent = "";
  } catch (e) {
    statusEl.textContent = `❌ Erreur : ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "1. Sélectionner les fichiers auto & Générer le code (XML / CDATA)";
  }
}

async function pushAtomicCommit(owner, repoName, branch, commitMessage, filesArray, isEmptyRepo = false, autoBackup = true) {
  if (isEmptyRepo) {
    const first = filesArray.find(f => f.action !== "delete") || { path: "README.md", content: `# ${repoName}` };
    const initRes = await ghFetch(`/repos/${owner}/${repoName}/contents/${encodeURIComponent(first.path)}`, {
      method: "PUT",
      body: JSON.stringify({
        message: "Initialisation du dépôt",
        content: b64EncodeUtf8(first.content || `# ${repoName}`),
        branch
      })
    });
    if (!initRes.ok) throw new Error(`Échec initialisation dépôt vide : ${await initRes.text()}`);
  }

  const refRes = await ghFetch(`/repos/${owner}/${repoName}/git/ref/heads/${branch}`);
  if (!refRes.ok) throw new Error(`Impossible de lire refs/heads/${branch} : ${await refRes.text()}`);
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;

  let createdBackupTag = null;
  if (autoBackup && !isEmptyRepo) {
    createdBackupTag = await createGitBackupSnapshot(owner, repoName, latestCommitSha, "backup-pre-agent");
  }

  const commitRes = await ghFetch(`/repos/${owner}/${repoName}/git/commits/${latestCommitSha}`);
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  const treeEntries = [];
  for (const file of filesArray) {
    if (file.action === "delete") {
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: null });
      delete currentFileCache[file.path];
    } else {
      const blobRes = await ghFetch(`/repos/${owner}/${repoName}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: "utf-8" })
      });
      if (!blobRes.ok) throw new Error(`Erreur blob ${file.path}: ${await blobRes.text()}`);
      const blobData = await blobRes.json();
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blobData.sha });
      currentFileCache[file.path] = file.content;
    }
  }

  const newTreeRes = await ghFetch(`/repos/${owner}/${repoName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
  });
  if (!newTreeRes.ok) throw new Error(`Erreur git/tree : ${await newTreeRes.text()}`);
  const newTree = await newTreeRes.json();

  const createCommitRes = await ghFetch(`/repos/${owner}/${repoName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha]
    })
  });
  if (!createCommitRes.ok) throw new Error(`Erreur git/commit : ${await createCommitRes.text()}`);
  const newCommit = await createCommitRes.json();

  const updateRefRes = await ghFetch(`/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });
  if (!updateRefRes.ok) {
    const errText = await updateRefRes.text();
    if (errText.includes("workflow") || updateRefRes.status === 403) {
      throw new Error("WORKFLOW_SCOPE_MISSING:" + errText);
    }
    throw new Error(`Erreur mise à jour branche : ${errText}`);
  }

  return { commitSha: newCommit.sha, backupTag: createdBackupTag };
}

async function waitForCIRunAndGetFailureLog(owner, repoName, commitSha, statusCallback) {
  await new Promise(r => setTimeout(r, 4500));

  for (let poll = 1; poll <= 28; poll++) {
    const res = await ghFetch(`/repos/${owner}/${repoName}/actions/runs?head_sha=${commitSha}&per_page=5`);
    if (res.ok) {
      const data = await res.json();
      const runs = data.workflow_runs || [];
      if (runs.length === 0 && poll >= 3) {
        return { hasCI: false, success: true };
      }
      if (runs.length > 0) {
        const run = runs[0];
        if (statusCallback) {
          statusCallback(`⏳ CI/CD '${run.name}' #${run.run_number} : ${run.status} (vérification ${poll}/28)...`);
        }
        if (run.status === "completed") {
          if (run.conclusion === "success" || run.conclusion === "skipped" || run.conclusion === "neutral") {
            updateNodeColor3D(repoName, "#10b981");
            return { hasCI: true, success: true, run };
          }
          updateNodeColor3D(repoName, "#f43f5e");
          const trace = await extractFailedJobTrace(owner, repoName, run.id);
          return { hasCI: true, success: false, run, log: trace };
        }
      }
    }
    await new Promise(r => setTimeout(r, 4000));
  }
  return { hasCI: true, success: true, timeout: true };
}

async function extractFailedJobTrace(owner, repoName, runId) {
  let summary = "";
  try {
    const jobsRes = await ghFetch(`/repos/${owner}/${repoName}/actions/runs/${runId}/jobs`);
    if (!jobsRes.ok) return "Impossible de lire les jobs CI.";
    const jobsData = await jobsRes.json();
    const failedJob = (jobsData.jobs || []).find(j => j.conclusion === "failure") || (jobsData.jobs || [])[0];
    if (!failedJob) return "Aucun job en échec identifié.";

    const failedSteps = (failedJob.steps || []).filter(s => s.conclusion === "failure").map(s => s.name);
    summary += `Job en échec : ${failedJob.name}\nÉtapes plantées : ${failedSteps.join(", ") || "N/A"}\n`;

    const logRes = await ghFetch(`/repos/${owner}/${repoName}/actions/jobs/${failedJob.id}/logs`);
    if (logRes.ok) {
      const rawLog = await logRes.text();
      summary += `\n--- TRACEBACK / LOG (4500 derniers caractères) ---\n${rawLog.slice(-4500)}`;
      return summary;
    }

    const checkRes = await ghFetch(`/repos/${owner}/${repoName}/check-runs/${failedJob.id}/annotations`);
    if (checkRes.ok) {
      const annotations = await checkRes.json();
      const annText = (annotations || []).map(a => `[${a.path}:${a.start_line}] ${a.title}: ${a.message}`).join("\n");
      if (annText) summary += `\n--- ANNOTATIONS D'ERREUR ---\n${annText}`;
    }
  } catch (e) {
    summary += `\nErreur lecture trace : ${e.message}`;
  }
  return summary.slice(-4500);
}

async function commitStagedChanges() {
  if (!currentRepo || !stagedChanges) return;
  const btn = document.getElementById("btn-commit-push");
  const statusEl = document.getElementById("hud-prompt-status");
  const autoHealEnabled = document.getElementById("chk-auto-heal").checked;
  const msg = document.getElementById("hud-commit-msg").value.trim() || "Update via Neural Dev Hub V6.0";

  btn.disabled = true;
  btn.textContent = "Push Atomique en cours...";

  const owner = currentRepo.owner.login;
  const repoName = currentRepo.name;
  const branch = currentRepo.default_branch;

  try {
    let filesToCommit = stagedChanges.files;
    let commitResult;

    try {
      commitResult = await pushAtomicCommit(owner, repoName, branch, msg, filesToCommit, currentRepoIsEmpty, true);
    } catch (e) {
      if (String(e.message).startsWith("WORKFLOW_SCOPE_MISSING:")) {
        const retryNoWf = confirm("Ton token GitHub n'a pas le scope 'workflow'. Pousser tous les autres fichiers sans .github/workflows ?");
        if (!retryNoWf) throw e;
        filesToCommit = filesToCommit.filter(f => !f.path.startsWith(".github/workflows"));
        commitResult = await pushAtomicCommit(owner, repoName, branch, msg, filesToCommit, currentRepoIsEmpty, false);
      } else {
        throw e;
      }
    }

    currentRepoIsEmpty = false;
    await loadRepositoryTree(currentRepo);

    // Conserver tous les fichiers touchés dans le contexte actif en cas d'Auto-Heal
    const touchedPaths = filesToCommit.filter(f => f.action !== "delete").map(f => f.path);
    autoSelectedPaths = Array.from(new Set([...touchedPaths, ...autoSelectedPaths])).slice(0, 10);
    renderAutoSelectedBadges(autoSelectedPaths);

    if (autoHealEnabled) {
      statusEl.textContent = `✅ Commit ${commitResult.commitSha.slice(0, 7)} poussé. Surveillance GitHub Actions (Auto-Heal)...`;
      let ciStatus = await waitForCIRunAndGetFailureLog(owner, repoName, commitResult.commitSha, txt => {
        statusEl.textContent = txt;
      });

      let cycle = 0;
      while (ciStatus.hasCI && !ciStatus.success && cycle < 3) {
        cycle++;
        statusEl.textContent = `🔴 Échec CI détecté ! Auto-Heal Cycle ${cycle}/3 avec l'Agent Principal...`;

        const updatedContext = await gatherSelectedContext(currentRepo, autoSelectedPaths);
        const healPrompt = `Le commit précédent pour la demande "${stagedChanges.promptText || msg}" a fait échouer GitHub Actions.
Voici la trace d'erreur exacte retournée par la CI/CD :

${ciStatus.log}

Analyse cette erreur, corrige les fichiers en cause et renvoie la correction complète en XML / CDATA (<file> ou <patch>).`;

        const healRawXml = await callSelectedAgentRawXml(XML_CODE_SYSTEM_PROMPT, `${updatedContext}\n\n${healPrompt}`);
        const healCompiled = await parseAndCompileAgentXml(healRawXml, currentRepo);

        statusEl.textContent = `🔧 Application du correctif Auto-Heal #${cycle} (${healCompiled.files.length} fichier(s))...`;
        commitResult = await pushAtomicCommit(
          owner,
          repoName,
          branch,
          `fix(auto-heal #${cycle}): ${healCompiled.commit_message}`,
          healCompiled.files,
          false,
          false
        );

        ciStatus = await waitForCIRunAndGetFailureLog(owner, repoName, commitResult.commitSha, txt => {
          statusEl.textContent = `[Auto-Heal #${cycle}] ${txt}`;
        });
      }

      if (ciStatus.hasCI && !ciStatus.success) {
        alert(`⚠️ La CI/CD échoue encore après 3 cycles d'Auto-Heal. Vérifie l'onglet Vue & Santé.`);
      } else {
        alert(`✅ Commit poussé et validé (CI Verte) !${commitResult.backupTag ? `\nBackup : ${commitResult.backupTag}` : ""}`);
      }
    } else {
      alert(`✅ Commit atomique poussé avec succès !${commitResult.backupTag ? `\nBackup : ${commitResult.backupTag}` : ""}`);
    }

    refreshCurrentProject();
  } catch (e) {
    statusEl.textContent = `❌ Erreur : ${e.message}`;
    alert(`Erreur lors du commit / Auto-Heal : ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "2. Backup Auto + Push Atomique + Surveillance CI/CD";
  }
}

// ============================================================================
// 9. CRÉATION D'UN NOUVEAU DÉPÔT DE ZÉRO PAR PROMPT (PROTOCOLE XML V6.0)
// ============================================================================
async function waitForDefaultBranchReady(owner, repo, branch, maxTries = 8) {
  for (let i = 0; i < maxTries; i++) {
    const res = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    if (res.ok) return true;
    await new Promise(r => setTimeout(r, 1100));
  }
  throw new Error("Timeout en attendant l'initialisation de la branche par GitHub.");
}

async function createRepoFromPrompt() {
  const name = document.getElementById("new-repo-name").value.trim();
  const isPrivate = document.getElementById("new-repo-private").value === "true";
  const promptText = document.getElementById("new-repo-prompt").value.trim();
  const logEl = document.getElementById("new-repo-log");
  const btn = document.getElementById("btn-create-repo");

  if (!name || !promptText) return alert("Indique un nom de dépôt et un prompt.");

  btn.disabled = true;
  logEl.classList.remove("hidden");
  logEl.textContent = `1/4 Création du dépôt '${name}' sur GitHub (auto_init: true)...\n`;

  try {
    const createRes = await ghFetch("/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name,
        private: isPrivate,
        auto_init: true,
        description: `Généré par prompt via Neural Dev Hub V6.0`
      })
    });
    if (!createRes.ok) throw new Error(`Création refusée (${createRes.status}): ${await createRes.text()}`);
    const newRepo = await createRes.json();

    logEl.textContent += `2/4 Attente de synchronisation de la branche '${newRepo.default_branch}'...\n`;
    await waitForDefaultBranchReady(newRepo.owner.login, newRepo.name, newRepo.default_branch);

    logEl.textContent += `3/4 Génération XML / CDATA complète des fichiers par l'Agent...\n`;
    const sys = `Tu es un architecte logiciel senior. Génère l'intégralité des fichiers pour ce nouveau dépôt GitHub (${name}).
Réponds UNIQUEMENT en XML brut avec CDATA :
<response>
<summary><![CDATA[Initialisation complète du projet]]></summary>
<commit_msg><![CDATA[feat: initial project generation]]></commit_msg>
<file path="README.md"><![CDATA[
# ${name}
...
]]></file>
</response>
Inclus tous les fichiers de code complets sans troncature, les fichiers de dépendances et, si pertinent, un workflow .github/workflows/ci.yml contenant 'workflow_dispatch:'.`;

    const rawXml = await callSelectedAgentRawXml(sys, promptText);
    const compiled = await parseAndCompileAgentXml(rawXml, newRepo);

    logEl.textContent += `4/4 Commit atomique de ${compiled.files.length} fichier(s) sur GitHub...\n`;
    try {
      await pushAtomicCommit(
        newRepo.owner.login,
        newRepo.name,
        newRepo.default_branch,
        compiled.commit_message || "Initial commit via Neural Dev Hub V6.0",
        compiled.files,
        false,
        true
      );
    } catch (e) {
      if (String(e.message).startsWith("WORKFLOW_SCOPE_MISSING:")) {
        logEl.textContent += `⚠️ Scope 'workflow' absent : commit du code sans .github/workflows...\n`;
        const noWf = compiled.files.filter(f => !f.path.startsWith(".github/workflows"));
        await pushAtomicCommit(newRepo.owner.login, newRepo.name, newRepo.default_branch, "Initial commit", noWf, false, false);
      } else {
        throw e;
      }
    }

    logEl.textContent += `✅ Terminé ! Le neurone '${newRepo.name}' est ajouté au Cerveau 3D.`;
    await loadAllRepositories();
    setTimeout(() => {
      toggleNewProjectDrawer();
      openProjectHud(newRepo);
    }, 1200);
  } catch (e) {
    logEl.textContent += `\n❌ ERREUR : ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// DÉMARRAGE AUTOMATIQUE & DÉTECTION PREMIÈRE CONNEXION
// ============================================================================
function startApp() {
  const creds = getCreds();
  selectStorageModeCard(creds.mode);
  document.getElementById("cfg-owner").value = creds.owner;
  document.getElementById("cfg-github-token").value = creds.githubToken;
  document.getElementById("cfg-gemini-key").value = creds.geminiKey;
  document.getElementById("cfg-groq-key").value = creds.groqKey;
  updateStorageModeBadge();

  initBrain3D();
  detectLocalOllama();

  // Si c'est la première connexion ou qu'aucune clé n'est enregistrée, on affiche la modale de choix PC Principal / Temporaire
  if (!hasConfiguredStorageMode() || (!creds.githubToken && !creds.owner)) {
    document.getElementById("first-run-modal").classList.remove("hidden");
  } else {
    loadAllRepositories();
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
