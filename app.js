// ============================================================================
// NEURAL DEV HUB V5 — MOTEUR 3D, GITHUB GIT DATA API & ROUTEUR MULTI-AGENTS
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
  graph3D.cameraPosition({ x: 0, y: 0, z: 270 }, { x: 0, y: 0, z: 0 }, 900);
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

// Lazy Loading en 1 seul appel API
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
// 4. OUVERTURE DU HUD PROJET (SANTÉ, ACTIONS, METRICS, ARBRE GIT)
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

// Rollback propre en Fast-Forward (restaure l'arbre du commit parent sans force-push)
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
// 5. LECTURE DE L'ARBORESCENCE ET DES FICHIERS (GESTION 409 DÉPÔT VIDE)
// ============================================================================
function isUsefulTextFile(filePath, size = 0) {
  const lower = filePath.toLowerCase();
  if (size > 60000) return false;
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

  ctxEl.innerHTML = currentRepoTree.map(f => {
    const checked = isUsefulTextFile(f.path, f.size) ? "checked" : "";
    return `
      <label class="flex items-center gap-2 cursor-pointer hover:bg-slate-900 px-1.5 py-0.5 rounded">
        <input type="checkbox" class="ctx-file-cb" value="${escapeHtml(f.path)}" ${checked} />
        <span class="truncate text-slate-300">${escapeHtml(f.path)}</span>
      </label>
    `;
  }).join("");
}

function toggleAllContextFiles(onlyUseful) {
  document.querySelectorAll(".ctx-file-cb").forEach(cb => {
    cb.checked = onlyUseful ? isUsefulTextFile(cb.value, 1000) : true;
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

async function gatherSelectedContext(repo) {
  const checkedPaths = Array.from(document.querySelectorAll(".ctx-file-cb:checked")).map(cb => cb.value).slice(0, 12);
  let bundle = `PROJET : ${repo.name}\nARBORESCENCE COMPLÈTE :\n${currentRepoTree.map(f => "- " + f.path).join("\n")}\n\n`;
  for (const p of checkedPaths) {
    try {
      const code = await fetchFileContent(repo, p);
      bundle += `\n=== FICHIER : ${p} ===\n${code}\n`;
    } catch {}
  }
  return bundle;
}

// ============================================================================
// 6. ROUTEUR MULTI-AGENTS (GEMINI + FALLBACK AUTO 429, GROQ, OLLAMA LOCAL)
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
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) cleaned = match[1].trim();
  return JSON.parse(cleaned);
}

async function callSelectedAgent(systemInstruction, userPrompt, schema = null) {
  const sel = document.getElementById("agent-selector").value;
  const [provider, modelName] = sel.split(":");
  const creds = getCreds();

  if (provider === "gemini") {
    if (!creds.geminiKey) throw new Error("Clé API Gemini manquante dans 'Clés & Sécurité'.");
    return await callGeminiWithFallback(modelName, creds.geminiKey, systemInstruction, userPrompt, schema);
  }

  if (provider === "groq") {
    if (!creds.groqKey) throw new Error("Clé API Groq manquante dans 'Clés & Sécurité'.");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${creds.groqKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemInstruction + "\nRéponds UNIQUEMENT en JSON valide." },
          { role: "user", content: userPrompt }
        ]
      })
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return sanitizeJsonResponse(data.choices[0].message.content);
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

async function callGeminiWithFallback(model, apiKey, sysPrompt, userPrompt, schema) {
  const generationConfig = {
    temperature: 0.15,
    maxOutputTokens: 65536,
    responseMimeType: "application/json"
  };
  if (schema) generationConfig.responseSchema = schema;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sysPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig
    })
  });

  // Fallback automatique vers gemini-4-argon en cas de quota 429/503 ou 404
  if ((res.status === 429 || res.status === 503 || res.status === 404) && model !== "gemini-4-argon") {
    console.warn(`Erreur ${res.status} sur ${model}, bascule automatique sur gemini-4-argon...`);
    return await callGeminiWithFallback("gemini-4-argon", apiKey, sysPrompt, userPrompt, schema);
  }

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return sanitizeJsonResponse(rawText);
}

// ============================================================================
// 7. AUDIT DU PROJET & GÉNÉRATION DE CODE MULTI-FICHIERS PAR PROMPT
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

const CODE_CHANGES_SCHEMA = {
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
    const context = await gatherSelectedContext(currentRepo);
    const sys = `Tu es un ingénieur logiciel senior. Analyse ce dépôt Git sans complaisance. Explique clairement ce que fait le code et propose 3 à 4 améliorations concrètes. Réponds en français au format JSON demandé.`;
    const result = await callSelectedAgent(sys, context, AUDIT_SCHEMA);

    const impHtml = (result.improvements || []).map((imp, idx) => `
      <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
        <div class="font-bold text-cyan-300">${idx + 1}. ${escapeHtml(imp.title)}</div>
        <p class="text-slate-300 text-[11px]">${escapeHtml(imp.description)}</p>
        <button onclick="applyImprovementPrompt('${ encodeURIComponent(imp.ready_prompt) }')" class="text-[11px] bg-cyan-700 hover:bg-cyan-600 text-white px-2.5 py-1 rounded font-semibold transition">
          Coder cette amélioration →
        </button>
      </div>
    `).join("");

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
        <div class="text-cyan-400 font-bold uppercase text-[11px]">Améliorations Programmables en 1 Clic</div>
        ${impHtml}
      </div>
    `;
  } catch (e) {
    out.innerHTML = `<div class="text-rose-400">Erreur d'audit : ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyser avec l'Agent";
  }
}

function applyImprovementPrompt(encodedPrompt) {
  switchHudTab("prompt");
  document.getElementById("hud-prompt-input").value = decodeURIComponent(encodedPrompt);
}

async function proposeCodeChanges() {
  if (!currentRepo) return;
  const promptText = document.getElementById("hud-prompt-input").value.trim();
  if (!promptText) return alert("Écris d'abord une instruction pour l'agent.");

  const btn = document.getElementById("btn-generate-changes");
  const statusEl = document.getElementById("hud-prompt-status");
  btn.disabled = true;
  btn.textContent = "Génération du code complet en cours...";
  statusEl.textContent = "L'agent lit le contexte et prépare les fichiers complets...";

  try {
    const context = await gatherSelectedContext(currentRepo);
    const sys = `Tu es un ingénieur logiciel expert. RÈGLE STRICTE : Pour chaque fichier créé ou modifié (action: "upsert"), tu DOIS fournir L'INTÉGRALITÉ du code du fichier dans "content", sans JAMAIS tronquer ni écrire de commentaires du type "// ... reste du code". Si un fichier doit être supprimé, mets action: "delete" et content: "". Si tu crées un workflow GitHub Actions, inclus toujours 'workflow_dispatch:'.`;
    const userMsg = `${context}\n\nINSTRUCTION DE MODIFICATION À APPLIQUER :\n${promptText}`;

    const res = await callSelectedAgent(sys, userMsg, CODE_CHANGES_SCHEMA);
    stagedChanges = res;

    document.getElementById("hud-staged-box").classList.remove("hidden");
    document.getElementById("hud-staged-count").textContent = `${res.files.length} fichier(s)`;
    document.getElementById("hud-staged-summary").textContent = res.summary;
    document.getElementById("hud-commit-msg").value = res.commit_message || "Mise à jour via Neural Dev Hub";

    document.getElementById("hud-staged-files").innerHTML = res.files.map(f => `
      <details class="bg-slate-900 rounded-lg border border-slate-800 p-2">
        <summary class="cursor-pointer font-mono text-[11px] font-bold ${f.action === 'delete' ? 'text-rose-400' : 'text-emerald-300'}">
          [${f.action.toUpperCase()}] ${escapeHtml(f.path)}
        </summary>
        <pre class="mt-2 p-2 bg-slate-950 rounded text-[10px] text-slate-200 overflow-x-auto max-h-48">${escapeHtml(f.content)}</pre>
      </details>
    `).join("");

    statusEl.textContent = "";
  } catch (e) {
    statusEl.textContent = `Erreur génération : ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "1. Générer le code complet (Prévisualisation avant Commit)";
  }
}

// ============================================================================
// 8. COMMIT ATOMIQUE MULTI-FICHIERS (GIT DATA API + BASE_TREE + FALLBACK WORKFLOW)
// ============================================================================
async function commitFilesAtomically(owner, repoName, branch, commitMessage, filesArray, isEmptyRepo = false) {
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

  // 1. Récupérer la référence HEAD et le base_tree
  const refRes = await ghFetch(`/repos/${owner}/${repoName}/git/ref/heads/${branch}`);
  if (!refRes.ok) throw new Error(`Impossible de lire refs/heads/${branch} : ${await refRes.text()}`);
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;

  const commitRes = await ghFetch(`/repos/${owner}/${repoName}/git/commits/${latestCommitSha}`);
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // 2. Construire les entrées de l'arbre (avec support suppression sha: null)
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

  // 3. Créer le nouvel arbre avec base_tree obligatoire
  const newTreeRes = await ghFetch(`/repos/${owner}/${repoName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
  });
  if (!newTreeRes.ok) throw new Error(`Erreur création git/tree : ${await newTreeRes.text()}`);
  const newTree = await newTreeRes.json();

  // 4. Créer le commit
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

  // 5. Mettre à jour la branche
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
  return newCommit.sha;
}

async function commitStagedChanges() {
  if (!currentRepo || !stagedChanges) return;
  const btn = document.getElementById("btn-commit-push");
  const msg = document.getElementById("hud-commit-msg").value.trim() || "Update via Neural Dev Hub";
  btn.disabled = true;
  btn.textContent = "Push du commit atomique en cours...";

  try {
    await commitFilesAtomically(
      currentRepo.owner.login,
      currentRepo.name,
      currentRepo.default_branch,
      msg,
      stagedChanges.files,
      currentRepoIsEmpty
    );
    alert("Commit poussé avec succès sur GitHub !");
    refreshCurrentProject();
  } catch (e) {
    if (String(e.message).startsWith("WORKFLOW_SCOPE_MISSING:")) {
      const retryWithoutWf = confirm(
        "Ton token GitHub n'a pas la case 'workflow' cochée pour pousser des fichiers .github/workflows/*.yml.\n\nVeux-tu pousser tous les autres fichiers de code immédiatement sans le fichier workflow ?"
      );
      if (retryWithoutWf) {
        const filtered = stagedChanges.files.filter(f => !f.path.startsWith(".github/workflows"));
        await commitFilesAtomically(currentRepo.owner.login, currentRepo.name, currentRepo.default_branch, msg, filtered, currentRepoIsEmpty);
        alert("Code poussé avec succès (hors fichier workflow) !");
        refreshCurrentProject();
      }
    } else {
      alert(`Erreur lors du commit : ${e.message}`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "2. Valider & Pousser le Commit sur GitHub";
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
    const generated = await callSelectedAgent(sys, promptText, CODE_CHANGES_SCHEMA);

    logEl.textContent += `4/4 Commit atomique de ${generated.files.length} fichier(s) sur GitHub...\n`;
    try {
      await commitFilesAtomically(
        newRepo.owner.login,
        newRepo.name,
        newRepo.default_branch,
        generated.commit_message || "Initialisation complète via Neural Dev Hub",
        generated.files,
        false
      );
    } catch (e) {
      if (String(e.message).startsWith("WORKFLOW_SCOPE_MISSING:")) {
        logEl.textContent += `⚠️ Scope 'workflow' absent sur le token : commit du code sans .github/workflows...\n`;
        const noWf = generated.files.filter(f => !f.path.startsWith(".github/workflows"));
        await commitFilesAtomically(newRepo.owner.login, newRepo.name, newRepo.default_branch, "Initial commit", noWf, false);
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
// DÉMARRAGE AUTOMATIQUE
// ============================================================================
window.addEventListener("DOMContentLoaded", () => {
  const creds = getCreds();
  document.getElementById("cfg-storage-mode").value = creds.mode;
  document.getElementById("cfg-owner").value = creds.owner;
  document.getElementById("cfg-github-token").value = creds.githubToken;
  document.getElementById("cfg-gemini-key").value = creds.geminiKey;
  document.getElementById("cfg-groq-key").value = creds.groqKey;

  initBrain3D();
  detectLocalOllama();
  loadAllRepositories();
});
