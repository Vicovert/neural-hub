// ============================================================================
// NEURAL DEV HUB V5.7 — AGENT AUTONOME + BACKUPS GIT AUTOMATIQUES & RESTAURATION
// ============================================================================

let graph3D = null;
let repositories = [];
let nodesMap = new Map();
let currentRepo = null;
let currentRepoTree = [];
let currentRepoIsEmpty = false;
let currentFileCache = {};
let stagedChanges = null;
let grantedScopes = "";
let lastAuditImprovements = [];

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
// 1. GESTION DES CLÉS (SESSION OU LOCAL) & ENCODAGE UTF-8 STRICT
// ============================================================================
function getStore() {
  const mode = localStorage.getItem("ndh_storage_mode") || "session";
  return mode === "local" ? localStorage : sessionStorage;
}

function getCreds() {
  const s = getStore();
  return {
    mode: localStorage.getItem("ndh_storage_mode") || "session",
    owner: (s.getItem("ndh_owner") || "").trim(),
    githubToken: (s.getItem("ndh_gh_token") || "").trim(),
    geminiKey: (s.getItem("ndh_gemini_key") || "").trim(),
    groqKey: (s.getItem("ndh_groq_key") || "").trim()
  };
}

function saveCredentials() {
  const mode = document.getElementById("cfg-storage-mode").value;
  localStorage.setItem("ndh_storage_mode", mode);
  const s = mode === "local" ? localStorage : sessionStorage;
  s.setItem("ndh_owner", document.getElementById("cfg-owner").value.trim());
  s.setItem("ndh_gh_token", document.getElementById("cfg-github-token").value.trim());
  s.setItem("ndh_gemini_key", document.getElementById("cfg-gemini-key").value.trim());
  s.setItem("ndh_groq_key", document.getElementById("cfg-groq-key").value.trim());
  document.getElementById("settings-drawer").classList.add("hidden");
  loadAllRepositories();
}

function clearCredentials() {
  sessionStorage.clear();
  ["ndh_owner", "ndh_gh_token", "ndh_gemini_key", "ndh_groq_key", "ndh_storage_mode"].forEach(k => localStorage.removeItem(k));
  alert("Toutes les clés ont été purgées de ce navigateur.");
  location.reload();
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

function toggleSettingsDrawer() {
  document.getElementById("settings-drawer").classList.toggle("hidden");
}

function toggleNewProjectDrawer() {
  document.getElementById("new-project-drawer").classList.toggle("hidden");
}

function closeProjectHud() {
  document.getElementById("project-hud").classList.add("hidden");
  resetCamera();
}

function switchHudTab(tab) {
  ["overview", "ai", "prompt", "files"].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
    document.getElementById(`tab-btn-${t}`).className =
      t === tab
        ? "flex-1 py-2.5 font-semibold text-cyan-400 border-b-2 border-cyan-400"
        : "flex-1 py-2.5 font-semibold text-slate-400 hover:text-slate-200";
  });
}

// ============================================================================
// 2. INITIALISATION DU CERVEAU 3D (THREE.JS + 3D-FORCE-GRAPH)
// ============================================================================
function initBrain3D() {
  const elem = document.getElementById("3d-graph");
  graph3D = ForceGraph3D()(elem)
    .backgroundColor("#030712")
    .showNavInfo(false)
    .nodeRelSize(6)
    .linkWidth(l => (l.isCore ? 1.4 : 0.6))
    .linkColor(l => (l.isCore ? "rgba(56, 189, 248, 0.42)" : "rgba(148, 163, 184, 0.18)"))
    .linkDirectionalParticles(l => (l.isCore ? 2 : 1))
    .linkDirectionalParticleWidth(1.6)
    .linkDirectionalParticleSpeed(0.004)
    .nodeThreeObject(node => {
      const group = new THREE.Group();
      const radius = node.isCore ? 11 : Math.max(5, Math.min(9, node.sizeWeight || 6));

      const sphereMat = new THREE.MeshPhongMaterial({
        color: node.color || "#38bdf8",
        emissive: node.color || "#0284c7",
        emissiveIntensity: node.isCore ? 0.75 : 0.45,
        shininess: 90,
        transparent: true,
        opacity: 0.94
      });
      node.__sphereMat = sphereMat;
      group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 24), sphereMat));

      const haloMat = new THREE.MeshBasicMaterial({
        color: node.color || "#38bdf8",
        transparent: true,
        opacity: 0.16,
        wireframe: !!node.isCore
      });
      node.__haloMat = haloMat;
      group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.35, 14, 14), haloMat));

      const label = new SpriteText(node.name);
      label.color = node.isCore ? "#67e8f9" : "#f8fafc";
      label.textHeight = node.isCore ? 5.2 : 3.5;
      label.position.y = radius + 4.8;
      group.add(label);

      return group;
    })
    .onNodeClick(node => {
      if (node.isCore) {
        resetCamera();
        return;
      }
      focusNodeLeftOfHud(node);
      openProjectHud(node.repoData);
    });

  const scene = graph3D.scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
  dLight.position.set(100, 140, 90);
  scene.add(dLight);

  const starGeo = new THREE.BufferGeometry();
  const pts = new Float32Array(750 * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * 900;
  starGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.2, color: 0x0ea5e9, transparent: true, opacity: 0.35 })));

  window.addEventListener("resize", () => {
    graph3D.width(window.innerWidth);
    graph3D.height(window.innerHeight);
  });
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

function focusNodeLeftOfHud(node) {
  const dist = 105;
  const ratio = 1 + dist / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
  const lookAtTarget = { x: (node.x || 0) + 18, y: node.y || 0, z: node.z || 0 };
  graph3D.cameraPosition(
    { x: (node.x || 1) * ratio, y: (node.y || 1) * ratio, z: (node.z || 1) * ratio },
    lookAtTarget,
    950
  );
}

function resetCamera() {
  if (!graph3D) return;
  const graphData = graph3D.graphData();
  const coreNode = (graphData.nodes || []).find(n => n.isCore);
  
  if (coreNode && coreNode.x !== undefined) {
    // Si le nœud 3D a déjà calculé ses coordonnées physiques, on se place autour de lui
    const dist = 140;
    graph3D.cameraPosition(
      { x: coreNode.x, y: coreNode.y, z: coreNode.z + dist },
      { x: coreNode.x, y: coreNode.y, z: coreNode.z },
      900
    );
  } else {
    // Repli par défaut sur l'origine du graphe
    graph3D.cameraPosition({ x: 0, y: 0, z: 270 }, { x: 0, y: 0, z: 0 }, 900);
  }
}

// ============================================================================
// 3. API GITHUB (AVEC NO-STORE & DIAGNOSTIC DE SCOPES)
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
    stats.textContent = "Configure tes clés en haut à droite";
    document.getElementById("settings-drawer").classList.remove("hidden");
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
  const nodes = [{ id: coreId, name: `${owner || "HUB"} • CORTEX`, isCore: true, color: "#38bdf8" }];
  const links = [];
  const langBuckets = {};

  repos.forEach(r => {
    const lang = r.language || "Autre";
    const colorMap = {
      Python: "#38bdf8",
      JavaScript: "#facc15",
      TypeScript: "#60a5fa",
      HTML: "#fb923c",
      OpenSCAD: "#a855f7"
    };
    const node = {
      id: r.name,
      name: r.name,
      color: colorMap[lang] || "#2dd4bf",
      sizeWeight: Math.log10((r.size || 10) + 10) * 2.5,
      repoData: r
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
// 4. OUVERTURE DU HUD PROJET (SANTÉ, ACTIONS, BACKUPS GIT, ARBRE GIT)
// ============================================================================
async function openProjectHud(repo) {
  currentRepo = repo;
  currentRepoTree = [];
  currentRepoIsEmpty = false;
  currentFileCache = {};
  stagedChanges = null;

  document.getElementById("project-hud").classList.remove("hidden");
  document.getElementById("hud-staged-box").classList.add("hidden");
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
    const t = await res.text();
    alert(`Échec de relance (${res.status}) : ${t}`);
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
// 4B. SYSTÈME DE BACKUP AUTOMATIQUE PAR TAGS GIT & RESTAURATION EN 1 CLIC
// ============================================================================
function generateBackupTagName(prefix = "backup") {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${stamp}`;
}

async function createGitBackupSnapshot(owner, repoName, commitSha, tagPrefix = "backup") {
  const tagName = generateBackupTagName(tagPrefix);
  const res = await ghFetch(`/repos/${owner}/${repoName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/tags/${tagName}`,
      sha: commitSha
    })
  });
  if (!res.ok) {
    console.warn("Impossible de créer le tag de sauvegarde :", await res.text());
    return null;
  }
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
      listEl.innerHTML = `<div class="text-[11px] text-slate-500">Aucune backup enregistrée (une backup sera créée automatiquement à ta prochaine modification).</div>`;
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
  if (!confirm(`Restaurer '${currentRepo.name}' exactement à l'état de la sauvegarde '${tagName}' ?\n\nUne sauvegarde de ton état actuel sera également prise avant la restauration.`)) return;

  try {
    const owner = currentRepo.owner.login;
    const repo = currentRepo.name;
    const branch = currentRepo.default_branch;

    const headRes = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const headData = await headRes.json();
    const currentHeadSha = headData.object.sha;

    // Backup de sécurité de l'état actuel avant restauration
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
  if (!confirm(`Voulez-vous créer un commit de restauration vers l'état précédant le dernier commit sur ${currentRepo.name} ?`)) return;

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
// 5. LECTURE DE L'ARBORESCENCE ET DES FICHIERS (CONTEXTE COMPLET)
// ============================================================================
function isUsefulTextFile(filePath, size = 0) {
  const lower = filePath.toLowerCase();
  if (size > 150000) return false;
  if (IGNORED_PATHS.some(ig => lower.includes(ig))) return false;
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

async function loadRepositoryTree(repo) {
  const treeEl = document.getElementById("hud-file-tree");
  const ctxEl = document.getElementById("hud-context-files");
  treeEl.innerHTML = "Lecture de l'arborescence...";
  ctxEl.innerHTML = "";

  const res = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/git/trees/${repo.default_branch}?recursive=1`);
  if (res.status === 409 || res.status === 404) {
    currentRepoIsEmpty = true;
    currentRepoTree = [];
    treeEl.innerHTML = `<div class="text-amber-300">Dépôt vide (0 commit). Utilise l'onglet 'Coder par Prompt' pour l'initialiser.</div>`;
    ctxEl.innerHTML = `<div class="text-amber-300">Dépôt vide : tous les fichiers générés seront créés.</div>`;
    return;
  }

  const data = await res.json();
  currentRepoTree = (data.tree || []).filter(item => item.type === "blob");

  treeEl.innerHTML = currentRepoTree.map(f => `
    <div onclick="previewRepoFile('${f.path.replace(/'/g, "\\'")}')" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded flex justify-between items-center">
      <span class="text-slate-200 truncate">${escapeHtml(f.path)}</span>
      <span class="text-slate-500 text-[10px]">${((f.size || 0) / 1024).toFixed(1)} Ko</span>
    </div>
  `).join("");

  let autoCount = 0;
  ctxEl.innerHTML = currentRepoTree.map(f => {
    const shouldCheck = isUsefulTextFile(f.path, f.size) && autoCount < 8;
    if (shouldCheck) autoCount++;
    const checked = shouldCheck ? "checked" : "";
    return `
      <label class="flex items-center gap-2 cursor-pointer hover:bg-slate-900 px-1.5 py-0.5 rounded">
        <input type="checkbox" class="ctx-file-cb" value="${escapeHtml(f.path)}" ${checked} />
        <span class="truncate text-slate-300">${escapeHtml(f.path)}</span>
        <span class="ml-auto text-[10px] text-slate-500">${((f.size || 0) / 1024).toFixed(1)}k</span>
      </label>
    `;
  }).join("");
}

function toggleAllContextFiles(onlyUseful) {
  let count = 0;
  document.querySelectorAll(".ctx-file-cb").forEach(cb => {
    if (onlyUseful && isUsefulTextFile(cb.value, 100000) && count < 8) {
      cb.checked = true;
      count++;
    } else {
      cb.checked = false;
    }
  });
}

async function fetchFileContent(repo, path) {
  if (currentFileCache[path]) return currentFileCache[path];
  const res = await ghFetch(`/repos/${repo.owner.login}/${repo.name}/contents/${encodeURIComponent(path)}?ref=${repo.default_branch}`);
  if (!res.ok) throw new Error(`Impossible de lire ${path}`);
  const data = await res.json();
  const decoded = b64DecodeUtf8(data.content || "");
  currentFileCache[path] = decoded;
  return decoded;
}

async function previewRepoFile(path) {
  if (!currentRepo) return;
  const box = document.getElementById("hud-file-viewer-box");
  const title = document.getElementById("hud-file-viewer-title");
  const contentEl = document.getElementById("hud-file-viewer-content");
  box.classList.remove("hidden");
  title.textContent = path;
  contentEl.textContent = "Chargement UTF-8...";
  try {
    contentEl.textContent = await fetchFileContent(currentRepo, path);
  } catch (e) {
    contentEl.textContent = `Erreur : ${e.message}`;
  }
}

async function gatherSelectedContext(repo, isForCodeGeneration = false) {
  // 1. Récupération de tous les fichiers texte valides du dépôt
  const allFiles = currentRepoTree.filter(f => isUsefulTextFile(f.path, f.size));
  const fileListText = allFiles.map(f => `- ${f.path} (${((f.size || 0) / 1024).toFixed(1)} Ko)`).join("\n");

  const promptText = document.getElementById("hud-prompt-input").value.trim();

  // 2. Appel à un modèle rapide et léger (Flash-Lite) pour identifier les fichiers strictement nécessaires
  const selectorSys = `Tu es un assistant de filtrage de code. À partir de la liste des fichiers du projet et d'une instruction utilisateur, identifie les chemins (paths) exacts des fichiers indispensables à modifier ou consulter. Réponds UNIQUEMENT sous forme d'un objet JSON valide avec la structure : { "selected_paths": ["chemin/vers/fichier1.py", "chemin/vers/fichier2.py"] }`;
  
  const selectorUser = `PROJET : ${repo.name}\nFICHIERS DISPONIBLES :\n${fileListText}\n\nINSTRUCTION :\n${promptText}`;

  let selectedPaths = [];
  try {
    // On force l'utilisation du modèle léger pour le tri automatique
    const creds = getCreds();
    const routerRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${creds.geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: selectorSys }] },
        contents: [{ role: "user", parts: [{ text: selectorUser }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    
    if (routerRes.ok) {
      const data = await routerRes.json();
      const parsed = sanitizeJsonResponse(data.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      selectedPaths = parsed.selected_paths || [];
    }
  } catch (e) {
    console.warn("Échec du tri automatique par le modèle léger, repli sur les 5 premiers fichiers utiles :", e);
  }

  // Si le modèle léger n'a rien retourné, on prend par défaut les fichiers les plus pertinents (ex: router.py, app.py, etc.)
  if (selectedPaths.length === 0) {
    selectedPaths = allFiles.slice(0, 5).map(f => f.path);
  }

  // Mise à jour visuelle des cases à cocher dans l'UI pour que tu voies ce que l'agent a sélectionné
  document.querySelectorAll(".ctx-file-cb").forEach(cb => {
    cb.checked = selectedPaths.includes(cb.value);
  });

  // 3. Construction du bundle final avec les fichiers sélectionnés automatiquement
  let bundle = `PROJET : ${repo.name}\nARBORESCENCE COMPLÈTE :\n${currentRepoTree.map(f => "- " + f.path).join("\n")}\n\n`;
  for (const p of selectedPaths) {
    try {
      const code = await fetchFileContent(repo, p);
      const contentToInclude = (!isForCodeGeneration && code.length > 25000)
        ? code.slice(0, 25000) + "\n// [APERÇU AUDIT]"
        : code;
      bundle += `\n=== FICHIER : ${p} ===\n${contentToInclude}\n`;
    } catch {}
  }
  return bundle;
}

// ============================================================================
// 6. ROUTEUR MULTI-AGENTS & GESTION INTERACTIVE DE SATURATION (503 / 429)
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

function sanitizeJsonResponse(raw) {
  let cleaned = (raw || "").trim();
  // Supprime les blocs de pensée internes (type DeepSeek / R1)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  
  // Extrait le contenu entre la première accolade ouvrante et la dernière fermante
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // Nettoie les retours à la ligne non échappés dans les chaînes JSON si nécessaire
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Tentative de correction agressive des sauts de ligne littéraux dans les valeurs string
    try {
      const fixed = cleaned.replace(/[\u0000-\u001F]+/g, " ");
      return JSON.parse(fixed);
    } catch (e2) {
      throw new Error(`Erreur JSON : ${err.message}. Réponse brute reçue de l'agent malformée.`);
    }
  }
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
    document.getElementById("rl-wait-sub").textContent = "Relance automatique toutes les 15 secondes jusqu'à libération du serveur.";

    panel.classList.remove("hidden");
  });
}

async function callSelectedAgent(systemInstruction, userPrompt, schema = null) {
  const sel = document.getElementById("agent-selector").value;
  const [provider, modelName] = sel.split(":");
  const creds = getCreds();

  if (provider === "gemini") {
    if (!creds.geminiKey) throw new Error("Clé API Gemini manquante dans 'Clés & Sécurité'.");
    return await callGeminiWithUserChoice(modelName, creds.geminiKey, systemInstruction, userPrompt, schema);
  }

  if (provider === "groq") {
    if (!creds.groqKey) throw new Error("Clé API Groq manquante dans 'Clés & Sécurité'.");
    try {
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
            { role: "system", content: systemInstruction + "\nIMPORTANT: Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ni après." },
            { role: "user", content: userPrompt + "\n\nFormat attendu : JSON pur." }
          ]
        })
      });
      if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return sanitizeJsonResponse(data.choices[0].message.content);
    } catch (e) {
      if (e.name === "TypeError" && e.message.includes("fetch")) {
        throw new Error("Connexion vers api.groq.com bloquée par ton navigateur ou le pare-feu de ce PC.");
      }
      throw e;
    }
  }

  if (provider === "ollama") {
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt }
        ]
      })
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return sanitizeJsonResponse(data.message.content);
  }
}

async function callGeminiWithUserChoice(model, apiKey, sysPrompt, userPrompt, schema, autoWaitMode = false) {
  // On retire responseSchema pour laisser Gemini Pro structurer son JSON nativement sans crash de troncature
  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 65536,
    responseMimeType: "application/json"
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sysPrompt + "\nRéponds UNIQUEMENT avec un objet JSON valide contenant tes modifications." }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig
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
      if (decision && decision.action === "cancel") {
        throw new Error("Requête annulée par l'utilisateur.");
      }
      if (decision && decision.action === "switch") {
        return await callSelectedAgent(sysPrompt, userPrompt, schema);
      }
      return await callGeminiWithUserChoice(model, apiKey, sysPrompt, userPrompt, schema, true);
    }

    const decision = await askUserOnSaturation(res.status, model, apiErrMsg);
    if (decision.action === "cancel") {
      throw new Error("Requête annulée par l'utilisateur.");
    }
    if (decision.action === "switch") {
      return await callSelectedAgent(sysPrompt, userPrompt, schema);
    }
    if (decision.action === "retry") {
      return await callGeminiWithUserChoice(model, apiKey, sysPrompt, userPrompt, schema, true);
    }
  }

  document.getElementById("rate-limit-panel").classList.add("hidden");

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return sanitizeJsonResponse(rawText);
}

// ============================================================================
// 7. AUDIT DU PROJET & MOTEUR DE PATCH CHIRURGICAL (SEARCH & REPLACE)
// ============================================================================
const AUDIT_SCHEMA = {
  type: "OBJECT",
  properties: {
    architecture_summary: { type: "STRING" },
    how_it_works: { type: "STRING" },
    improvements: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          description: { type: "STRING" },
          ready_prompt: { type: "STRING" }
        },
        required: ["title", "description", "ready_prompt"]
      }
    }
  },
  required: ["architecture_summary", "how_it_works", "improvements"]
};

const PATCH_CHANGES_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    commit_message: { type: "STRING" },
    operations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING" },
          action: { type: "STRING", enum: ["patch", "create", "delete"] },
          content: { type: "STRING" },
          hunks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                search: { type: "STRING" },
                replace: { type: "STRING" }
              },
              required: ["search", "replace"]
            }
          }
        },
        required: ["path", "action"]
      }
    }
  },
  required: ["summary", "commit_message", "operations"]
};

const NEW_REPO_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    commit_message: { type: "STRING" },
    files: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING" },
          action: { type: "STRING", enum: ["upsert", "delete"] },
          content: { type: "STRING" }
        },
        required: ["path", "action", "content"]
      }
    }
  },
  required: ["summary", "commit_message", "files"]
};

async function analyzeCurrentRepo() {
  if (!currentRepo) return;
  const btn = document.getElementById("btn-analyze-repo");
  const out = document.getElementById("hud-ai-analysis");
  btn.disabled = true;
  btn.textContent = "Analyse en cours...";
  out.innerHTML = "Lecture des fichiers et génération de l'audit technique...";

  try {
    const context = await gatherSelectedContext(currentRepo, false);
    const sys = `Tu es un ingénieur logiciel senior. Analyse ce dépôt Git sans complaisance. Explique clairement ce que fait le code et propose 3 à 4 améliorations concrètes. Réponds en français au format JSON demandé.`;
    const result = await callSelectedAgent(sys, context, AUDIT_SCHEMA);
    lastAuditImprovements = result.improvements || [];

    const impHtml = lastAuditImprovements.map((imp, idx) => `
      <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" class="audit-imp-cb mt-0.5 accent-cyan-500" value="${idx}" checked />
          <div class="flex-1">
            <div class="font-bold text-cyan-300">${idx + 1}. ${escapeHtml(imp.title)}</div>
            <p class="text-slate-300 text-[11px] mt-0.5">${escapeHtml(imp.description)}</p>
          </div>
        </label>
        <div class="pl-5">
          <button type="button" onclick="applySingleImprovement(${idx})" class="text-[11px] bg-slate-800 hover:bg-cyan-700 text-cyan-200 hover:text-white px-2.5 py-1 rounded border border-cyan-500/30 font-semibold transition">
            Coder uniquement celle-ci →
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
      <div>
        <div class="text-cyan-400 font-bold uppercase text-[11px] mb-1">Résumé Architectural</div>
        <p>${escapeHtml(result.architecture_summary)}</p>
      </div>
      <div>
        <div class="text-cyan-400 font-bold uppercase text-[11px] mb-1">Fonctionnement du Code</div>
        <p class="whitespace-pre-line">${escapeHtml(result.how_it_works)}</p>
      </div>
      <div class="space-y-2">
        <div class="text-cyan-400 font-bold uppercase text-[11px]">Améliorations Programmables</div>
        ${impHtml}
        ${batchBtnHtml}
      </div>
    `;
  } catch (e) {
    out.innerHTML = `<div class="text-rose-400">Erreur d'audit : ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyser avec l'Agent";
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

  if (selectedIndexes.length === 0) {
    alert("Coche au moins une amélioration à appliquer.");
    return;
  }

  const combinedPrompt = selectedIndexes
    .map((idx, i) => {
      const imp = lastAuditImprovements[idx];
      return `### Amélioration ${i + 1} : ${imp.title}\n${imp.ready_prompt}`;
    })
    .join("\n\n");

  switchHudTab("prompt");
  document.getElementById("hud-prompt-input").value =
    `Applique conjointement les améliorations suivantes en veillant à leur cohérence globale :\n\n${combinedPrompt}`;
}

function applySurgicalHunks(originalContent, hunks, filePath) {
  let updated = originalContent.replace(/\r\n/g, "\n");
  for (let i = 0; i < hunks.length; i++) {
    const searchBlock = (hunks[i].search || "").replace(/\r\n/g, "\n");
    const replaceBlock = (hunks[i].replace || "").replace(/\r\n/g, "\n");

    if (!searchBlock) {
      throw new Error(`Bloc 'search' vide dans le patch #${i + 1} pour ${filePath}.`);
    }
    const idx = updated.indexOf(searchBlock);
    if (idx === -1) {
      throw new Error(`Le bloc cible #${i + 1} dans '${filePath}' est introuvable dans le fichier original (correspondance exacte requise). Réessaie ou coche le fichier.`);
    }
    updated = updated.slice(0, idx) + replaceBlock + updated.slice(idx + searchBlock.length);
  }
  return updated;
}

async function proposeCodeChanges() {
  if (!currentRepo) return;
  const promptText = document.getElementById("hud-prompt-input").value.trim();
  if (!promptText) return alert("Écris d'abord une instruction pour l'agent.");

  const btn = document.getElementById("btn-generate-changes");
  const statusEl = document.getElementById("hud-prompt-status");
  btn.disabled = true;
  btn.textContent = "Analyse et génération des patchs chirurgicaux...";
  statusEl.textContent = "L'agent inspecte le code et prépare les modifications ciblées...";

  try {
    const context = await gatherSelectedContext(currentRepo, true);
    const sys = `Tu es un ingénieur logiciel autonome (style Antigravity / Claude Code).
Pour chaque fichier à modifier, crée une opération de type "patch" ou "create" dans le tableau "operations". Ne t'arrête pas au premier point, traite l'ensemble de la liste fournie.
Pour modifier un fichier EXISTANT, utilise UNIQUEMENT action: "patch" avec une liste "hunks" contenant des paires { "search": "extrait exact de 3 à 15 lignes du fichier existant", "replace": "nouveau code remplaçant cet extrait" }.
RÈGLES STRICTES :
1. Ne réécris JAMAIS un fichier existant en entier : utilise toujours "patch" avec le code exact copié caractère pour caractère dans "search" (indentation comprise).
2. Utilise action: "create" (avec "content" complet) UNIQUEMENT pour créer un tout nouveau fichier qui n'existe pas encore dans l'arborescence.
3. Utilise action: "delete" pour supprimer un fichier.
4. Si tu crées un workflow GitHub Actions, inclus toujours 'workflow_dispatch:'.`;

    const userMsg = `${context}\n\nINSTRUCTION À APPLIQUER :\n${promptText}`;
    const res = await callSelectedAgent(sys, userMsg, PATCH_CHANGES_SCHEMA);

    const compiledFiles = [];
    const diffPreviewHtml = [];

    for (const op of res.operations || []) {
      if (op.action === "delete") {
        compiledFiles.push({ path: op.path, action: "delete", content: "" });
        diffPreviewHtml.push(`
          <details class="bg-slate-900 rounded-lg border border-rose-500/30 p-2">
            <summary class="cursor-pointer font-mono text-[11px] font-bold text-rose-400">[DELETE] ${escapeHtml(op.path)}</summary>
            <div class="mt-1 text-[10px] text-rose-300">Ce fichier sera supprimé du dépôt.</div>
          </details>
        `);
      } else if (op.action === "create") {
        const content = op.content || "";
        compiledFiles.push({ path: op.path, action: "upsert", content });
        diffPreviewHtml.push(`
          <details class="bg-slate-900 rounded-lg border border-emerald-500/30 p-2" open>
            <summary class="cursor-pointer font-mono text-[11px] font-bold text-emerald-300">[NOUVEAU FICHIER] ${escapeHtml(op.path)} (${content.split("\n").length} lignes)</summary>
            <pre class="mt-2 p-2 bg-slate-950 rounded text-[10px] text-emerald-200 overflow-x-auto max-h-48">${escapeHtml(content)}</pre>
          </details>
        `);
      } else if (op.action === "patch") {
        const original = await fetchFileContent(currentRepo, op.path);
        const hunks = op.hunks || [];
        const patchedContent = applySurgicalHunks(original, hunks, op.path);
        compiledFiles.push({ path: op.path, action: "upsert", content: patchedContent });

        const hunksHtml = hunks.map((h, idx) => `
          <div class="mt-1.5 border border-slate-800 rounded overflow-hidden text-[10px] font-mono">
            <div class="bg-slate-800/80 px-2 py-0.5 text-slate-300">Bloc modifié #${idx + 1}</div>
            <pre class="p-1.5 bg-rose-950/40 text-rose-300 overflow-x-auto whitespace-pre-wrap">- ${escapeHtml(h.search)}</pre>
            <pre class="p-1.5 bg-emerald-950/40 text-emerald-300 overflow-x-auto whitespace-pre-wrap">+ ${escapeHtml(h.replace)}</pre>
          </div>
        `).join("");

        diffPreviewHtml.push(`
          <details class="bg-slate-900 rounded-lg border border-cyan-500/30 p-2" open>
            <summary class="cursor-pointer font-mono text-[11px] font-bold text-cyan-300">
              [PATCH] ${escapeHtml(op.path)} (${hunks.length} bloc(s) • ${original.split("\n").length} → ${patchedContent.split("\n").length} lignes)
            </summary>
            ${hunksHtml}
          </details>
        `);
      }
    }

    if (compiledFiles.length === 0) {
      throw new Error("L'agent n'a retourné aucune modification applicable.");
    }

    stagedChanges = {
      summary: res.summary,
      commit_message: res.commit_message,
      files: compiledFiles
    };

    document.getElementById("hud-staged-box").classList.remove("hidden");
    document.getElementById("hud-staged-count").textContent = `${compiledFiles.length} fichier(s)`;
    document.getElementById("hud-staged-summary").textContent = res.summary;
    document.getElementById("hud-commit-msg").value = res.commit_message || "Mise à jour via Neural Dev Hub";
    document.getElementById("hud-staged-files").innerHTML = diffPreviewHtml.join("");

    statusEl.textContent = "";
  } catch (e) {
    statusEl.textContent = `Erreur génération : ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "1. Générer les modifications (Diff avant Commit)";
  }
}

// ============================================================================
// 8. COMMIT ATOMIQUE MULTI-FICHIERS AVEC BACKUP AUTOMATIQUE PRÉALABLE
// ============================================================================
async function commitFilesAtomically(owner, repoName, branch, commitMessage, filesArray, isEmptyRepo = false, autoBackup = true) {
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

  // Création systématique d'une sauvegarde Git avant toute écriture de code ou workflow
  let createdBackupTag = null;
  if (autoBackup && !isEmptyRepo) {
    const hasWorkflowChange = filesArray.some(f => f.path.startsWith(".github/workflows"));
    const tagPrefix = hasWorkflowChange ? "backup-wf" : "backup";
    createdBackupTag = await createGitBackupSnapshot(owner, repoName, latestCommitSha, tagPrefix);
  }

  const commitRes = await ghFetch(`/repos/${owner}/${repoName}/git/commits/${latestCommitSha}`);
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  const treeEntries = [];
  for (const file of filesArray) {
    if (file.action === "delete") {
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: null });
    } else {
      const blobRes = await ghFetch(`/repos/${owner}/${repoName}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: "utf-8" })
      });
      if (!blobRes.ok) throw new Error(`Erreur création blob pour ${file.path}: ${await blobRes.text()}`);
      const blobData = await blobRes.json();
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blobData.sha });
    }
  }

  const newTreeRes = await ghFetch(`/repos/${owner}/${repoName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
  });
  if (!newTreeRes.ok) throw new Error(`Erreur création git/tree : ${await newTreeRes.text()}`);
  const newTree = await newTreeRes.json();

  const createCommitRes = await ghFetch(`/repos/${owner}/${repoName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha]
    })
  });
  if (!createCommitRes.ok) throw new Error(`Erreur création commit : ${await createCommitRes.text()}`);
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

async function commitStagedChanges() {
  if (!currentRepo || !stagedChanges) return;
  const btn = document.getElementById("btn-commit-push");
  const msg = document.getElementById("hud-commit-msg").value.trim() || "Update via Neural Dev Hub";
  btn.disabled = true;
  btn.textContent = "Création Backup & Push en cours...";

  try {
    const result = await commitFilesAtomically(
      currentRepo.owner.login,
      currentRepo.name,
      currentRepo.default_branch,
      msg,
      stagedChanges.files,
      currentRepoIsEmpty,
      true
    );
    const backupNote = result.backupTag ? `\nSauvegarde créée : ${result.backupTag}` : "";
    alert(`Commit poussé avec succès sur GitHub !${backupNote}`);
    refreshCurrentProject();
  } catch (e) {
    if (String(e.message).startsWith("WORKFLOW_SCOPE_MISSING:")) {
      const retryWithoutWf = confirm(
        "Ton token GitHub n'a pas la case 'workflow' cochée pour pousser des fichiers .github/workflows/*.yml.\n\nVeux-tu pousser tous les autres fichiers de code immédiatement sans le fichier workflow ?"
      );
      if (retryWithoutWf) {
        const filtered = stagedChanges.files.filter(f => !f.path.startsWith(".github/workflows"));
        const res = await commitFilesAtomically(currentRepo.owner.login, currentRepo.name, currentRepo.default_branch, msg, filtered, currentRepoIsEmpty, false);
        alert(`Code poussé avec succès (hors fichier workflow) !`);
        refreshCurrentProject();
      }
    } else {
      alert(`Erreur lors du commit : ${e.message}`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "2. Créer Backup Auto & Pousser sur GitHub";
  }
}

// ============================================================================
// 9. CRÉATION D'UN NOUVEAU DÉPÔT DE ZÉRO PAR PROMPT (AVEC POLLING ANTI-RACE)
// ============================================================================
async function waitForDefaultBranchReady(owner, repo, branch, maxTries = 7) {
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
        description: `Généré par prompt via Neural Dev Hub`
      })
    });
    if (!createRes.ok) throw new Error(`Création refusée (${createRes.status}): ${await createRes.text()}`);
    const newRepo = await createRes.json();

    logEl.textContent += `2/4 Attente de synchronisation de la branche '${newRepo.default_branch}'...\n`;
    await waitForDefaultBranchReady(newRepo.owner.login, newRepo.name, newRepo.default_branch);

    logEl.textContent += `3/4 Génération complète des fichiers par l'Agent IA...\n`;
    const sys = `Tu es un architecte logiciel senior. Génère l'intégralité des fichiers nécessaires pour ce nouveau dépôt GitHub (${name}). Inclus un README.md clair, tous les fichiers de code complets sans aucune troncature, les fichiers de dépendances (ex: requirements.txt ou package.json) et, si pertinent, un workflow GitHub Actions (.github/workflows/main.yml incluant obligatoirement 'workflow_dispatch:'). Tous les fichiers ont action: "upsert".`;
    const generated = await callSelectedAgent(sys, promptText, NEW_REPO_SCHEMA);

    logEl.textContent += `4/4 Commit atomique de ${generated.files.length} fichier(s) sur GitHub...\n`;
    try {
      await commitFilesAtomically(
        newRepo.owner.login,
        newRepo.name,
        newRepo.default_branch,
        generated.commit_message || "Initialisation complète via Neural Dev Hub",
        generated.files,
        false,
        true
      );
    } catch (e) {
      if (String(e.message).startsWith("WORKFLOW_SCOPE_MISSING:")) {
        logEl.textContent += `⚠️ Scope 'workflow' absent sur le token : commit du code sans .github/workflows...\n`;
        const noWf = generated.files.filter(f => !f.path.startsWith(".github/workflows"));
        await commitFilesAtomically(newRepo.owner.login, newRepo.name, newRepo.default_branch, "Initial commit", noWf, false, false);
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
// DÉMARRAGE AUTOMATIQUE (COMPATIBLE CHARGEMENT DYNAMIQUE)
// ============================================================================
function startApp() {
  const creds = getCreds();
  document.getElementById("cfg-storage-mode").value = creds.mode;
  document.getElementById("cfg-owner").value = creds.owner;
  document.getElementById("cfg-github-token").value = creds.githubToken;
  document.getElementById("cfg-gemini-key").value = creds.geminiKey;
  document.getElementById("cfg-groq-key").value = creds.groqKey;

  initBrain3D();
  detectLocalOllama();
  loadAllRepositories();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
