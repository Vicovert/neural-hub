// ============================================================================
// ÉTAT GLOBAL DU HUB V6.0
// ============================================================================
const STATE = {
  ghToken: localStorage.getItem('ndh_gh_token') || '',
  geminiKey: localStorage.getItem('ndh_gemini_key') || '',
  repos: [],
  activeRepo: null,      // Objet repo GitHub actuellement ouvert dans le panneau latéral
  activeBranch: 'main',
  treeFiles: [],         // Tous les fichiers (blobs) du projet actif
  backups: [],           // Liste des tags backup-pre-agent-*
  graph3D: null,
  orbitAngle: 0,
  orbitRadius: 190,
  cortexNode: {
    id: 'CORTEX_CORE',
    name: '🧠 CORTEX_CORE (0,0,0)',
    type: 'cortex',
    fx: 0,
    fy: 0,
    fz: 0,
    val: 34
  }
};

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gh-token').value = STATE.ghToken;
  document.getElementById('gemini-key').value = STATE.geminiKey;
  init3DCortexGraph();
  startOrbitalAnimation();
  log('Neural Dev Hub V6.0 initialisé. Pivot 3D verrouillé sur CORTEX_CORE (0,0,0).', 'log-info');
});

function log(msg, cls = 'log-info') {
  const term = document.getElementById('terminal');
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `[${time}] ${msg}`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function clearTerminal() {
  document.getElementById('terminal').innerHTML = '';
}

function setGlobalStatus(text, color = '#1e293b') {
  const badge = document.getElementById('global-status');
  badge.textContent = text;
  badge.style.background = color;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// 5. SPHÈRE DE FIBONACCI, ROTATION DES NEURONES & VERROUILLAGE PIVOT (0,0,0)
// ============================================================================
function init3DCortexGraph() {
  const container = document.getElementById('3d-graph');

  STATE.graph3D = ForceGraph3D()(container)
    .backgroundColor('#05070b')
    .nodeLabel(n => n.type === 'cortex' ? n.name : `⚡ ${n.name}\n[${n.language || 'Repo'}] — Cliquer pour ouvrir`)
    .nodeVal(n => n.val || 10)
    .nodeColor(n => {
      if (n.id === 'CORTEX_CORE') return '#00f0ff';
      if (STATE.activeRepo && n.id === STATE.activeRepo.full_name) return '#10b981';
      if (n.ciState === 'failure') return '#ef4444';
      if (n.ciState === 'working') return '#f59e0b';
      return '#3b82f6';
    })
    .linkColor(l => {
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      if (STATE.activeRepo && targetId === STATE.activeRepo.full_name) return '#10b981';
      return 'rgba(0, 240, 255, 0.22)';
    })
    .linkWidth(l => {
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return (STATE.activeRepo && targetId === STATE.activeRepo.full_name) ? 2.2 : 0.8;
    })
    .linkDirectionalParticles(l => {
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return (STATE.activeRepo && targetId === STATE.activeRepo.full_name) ? 5 : 1;
    })
    .linkDirectionalParticleSpeed(0.008)
    .linkDirectionalParticleWidth(2.2)
    .onNodeClick(node => {
      if (node.id === 'CORTEX_CORE') {
        resetCameraToCortex();
        return;
      }
      if (node.repoData) {
        selectProjectNeuron(node.repoData);
      }
    })
    .graphData({ nodes: [STATE.cortexNode], links: [] });

  // RÈGLE 5 : Verrouillage mathématique permanent du pivot OrbitControls sur (0, 0, 0)
  STATE.graph3D.onEngineTick(() => {
    STATE.cortexNode.fx = 0;
    STATE.cortexNode.fy = 0;
    STATE.cortexNode.fz = 0;
    const controls = STATE.graph3D.controls();
    if (controls) {
      controls.target.set(0, 0, 0);
    }
  });
}

// Distribution uniforme des neurones projets sur une sphère de Fibonacci
function buildFibonacciNeurons(repos) {
  const nodes = [STATE.cortexNode];
  const links = [];
  const N = repos.length;
  const R = STATE.orbitRadius;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  repos.forEach((repo, i) => {
    const y = N > 1 ? 1 - (i / (N - 1)) * 2 : 0; // y entre -1 et 1
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;

    const x = Math.cos(theta) * radiusAtY * R;
    const z = Math.sin(theta) * radiusAtY * R;
    const yPos = y * R;

    nodes.push({
      id: repo.full_name,
      name: repo.name,
      type: 'neuron',
      language: repo.language,
      repoData: repo,
      baseX: x,
      baseY: yPos,
      baseZ: z,
      fx: x,
      fy: yPos,
      fz: z,
      val: 11,
      ciState: 'idle'
    });

    links.push({
      source: 'CORTEX_CORE',
      target: repo.full_name
    });
  });

  STATE.graph3D.graphData({ nodes, links });
}

// Rotation orbitale continue des neurones autour du CORTEX_CORE (0,0,0)
function startOrbitalAnimation() {
  function animate() {
    requestAnimationFrame(animate);
    const orbitEnabled = document.getElementById('orbit-toggle')?.checked;
    if (!orbitEnabled || !STATE.graph3D) return;

    const { nodes } = STATE.graph3D.graphData();
    if (!nodes || nodes.length <= 1) return;

    STATE.orbitAngle += 0.0018;
    const cosA = Math.cos(STATE.orbitAngle);
    const sinA = Math.sin(STATE.orbitAngle);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.id === 'CORTEX_CORE') {
        n.fx = 0; n.fy = 0; n.fz = 0;
        continue;
      }
      if (typeof n.baseX === 'number') {
        n.fx = n.baseX * cosA - n.baseZ * sinA;
        n.fz = n.baseX * sinA + n.baseZ * cosA;
        n.fy = n.baseY;
        n.x = n.fx;
        n.y = n.fy;
        n.z = n.fz;
      }
    }

    // Maintien strict du pivot sur (0,0,0) à chaque frame d'animation
    const controls = STATE.graph3D.controls();
    if (controls) {
      controls.target.set(0, 0, 0);
    }
    STATE.graph3D.refresh();
  }
  requestAnimationFrame(animate);
}

function resetCameraToCortex() {
  if (!STATE.graph3D) return;
  STATE.graph3D.cameraPosition(
    { x: 0, y: 90, z: 380 },
    { x: 0, y: 0, z: 0 },
    900
  );
}

// ============================================================================
// CLIENT API GITHUB & CHARGEMENT DES PROJETS (NEURONES)
// ============================================================================
async function ghFetch(endpoint, options = {}) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${STATE.ghToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub ${res.status}: ${txt}`);
  }
  return res.status === 204 ? null : res.json();
}

async function connectAndBuildCortex() {
  STATE.ghToken = document.getElementById('gh-token').value.trim();
  STATE.geminiKey = document.getElementById('gemini-key').value.trim();

  if (!STATE.ghToken || !STATE.geminiKey) {
    return log('Erreur : Renseigne ton GitHub PAT et ta clé API Gemini.', 'log-err');
  }

  localStorage.setItem('ndh_gh_token', STATE.ghToken);
  localStorage.setItem('ndh_gemini_key', STATE.geminiKey);

  try {
    setGlobalStatus('SYNCING...', '#f59e0b');
    log('Récupération de tous les dépôts GitHub...', 'log-step');
    const repos = await ghFetch('/user/repos?per_page=100&sort=updated');
    STATE.repos = repos;
    buildFibonacciNeurons(repos);
    setGlobalStatus(`${repos.length} NEURONES ACTIFS`, '#10b981');
    log(`${repos.length} projets positionnés en sphère de Fibonacci autour de CORTEX_CORE.`, 'log-ok');
  } catch (err) {
    setGlobalStatus('AUTH ERROR', '#ef4444');
    log(`Échec d'initialisation : ${err.message}`, 'log-err');
  }
}

// ============================================================================
// PANNEAU LATÉRAL PROJET : ÉTAT GITHUB, ARBORESCENCE & BACKUPS
// ============================================================================
async function selectProjectNeuron(repo) {
  STATE.activeRepo = repo;
  STATE.activeBranch = repo.default_branch || 'main';

  // Ouverture du panneau latéral fixe (pas un pop-up)
  const sidebar = document.getElementById('project-sidebar');
  sidebar.classList.remove('hidden');

  document.getElementById('proj-title').textContent = repo.name;
  document.getElementById('proj-meta').textContent = `${repo.full_name} • ★ ${repo.stargazers_count} • ${repo.language || 'Code'}`;
  document.getElementById('proj-desc').textContent = repo.description || 'Aucune description fournie sur GitHub.';
  document.getElementById('proj-branch-input').value = STATE.activeBranch;

  // Mise à jour visuelle du neurone actif
  STATE.graph3D.nodeColor(STATE.graph3D.nodeColor());
  STATE.graph3D.linkColor(STATE.graph3D.linkColor());
  STATE.graph3D.linkWidth(STATE.graph3D.linkWidth());
  STATE.graph3D.linkDirectionalParticles(STATE.graph3D.linkDirectionalParticles());

  await refreshActiveProjectFullState();
}

function closeProjectSidebar() {
  document.getElementById('project-sidebar').classList.add('hidden');
  STATE.activeRepo = null;
  if (STATE.graph3D) {
    STATE.graph3D.nodeColor(STATE.graph3D.nodeColor());
    STATE.graph3D.linkColor(STATE.graph3D.linkColor());
  }
}

async function onBranchChange() {
  const newBranch = document.getElementById('proj-branch-input').value.trim();
  if (!newBranch || !STATE.activeRepo) return;
  STATE.activeBranch = newBranch;
  await refreshActiveProjectFullState();
}

async function refreshActiveProjectFullState() {
  if (!STATE.activeRepo) return;
  const fullName = STATE.activeRepo.full_name;
  const branch = STATE.activeBranch;

  log(`Inspection du neurone ${fullName} (branche ${branch})...`, 'log-step');

  try {
    // 1. Dernier commit & Arborescence Git complète
    const refData = await ghFetch(`/repos/${fullName}/git/ref/heads/${branch}`);
    const headSha = refData.object.sha;
    const commitData = await ghFetch(`/repos/${fullName}/git/commits/${headSha}`);
    document.getElementById('proj-last-commit').textContent = `${headSha.slice(0, 7)} — ${commitData.message.split('\n')[0]}`;

    const treeData = await ghFetch(`/repos/${fullName}/git/trees/${commitData.tree.sha}?recursive=1`);
    STATE.treeFiles = (treeData.tree || []).filter(item => item.type === 'blob');
    renderFileChecklist(STATE.treeFiles);

    // 2. Statut GitHub Actions en temps réel
    const runsData = await ghFetch(`/repos/${fullName}/actions/runs?per_page=1&branch=${branch}`);
    const ciBadge = document.getElementById('proj-ci-badge');
    if (runsData.total_count > 0) {
      const latestRun = runsData.workflow_runs[0];
      const label = latestRun.status === 'completed' ? latestRun.conclusion.toUpperCase() : latestRun.status.toUpperCase();
      ciBadge.textContent = `${label} (${latestRun.name})`;
      ciBadge.style.color = latestRun.conclusion === 'success' ? '#10b981' : (latestRun.conclusion === 'failure' ? '#ef4444' : '#f59e0b');
    } else {
      ciBadge.textContent = 'Aucun Workflow';
      ciBadge.style.color = '#94a3b8';
    }

    // 3. Liste des Backups GitHub (tags backup-pre-agent-*)
    await loadProjectBackups();

    log(`Projet ${fullName} prêt : ${STATE.treeFiles.length} fichiers, ${STATE.backups.length} backups.`, 'log-ok');
  } catch (err) {
    log(`Erreur de lecture de l'état du projet : ${err.message}`, 'log-err');
  }
}

// Affichage des cases à cocher pour les fichiers
function renderFileChecklist(files) {
  document.getElementById('file-count').textContent = files.length;
  const container = document.getElementById('file-checklist');
  container.innerHTML = '';

  files.forEach(file => {
    const label = document.createElement('label');
    label.className = 'file-item';
    label.dataset.path = file.path;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'file-checkbox';
    checkbox.value = file.path;

    const span = document.createElement('span');
    span.textContent = file.path;

    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);
  });
}

function filterFileCheckboxes() {
  const q = document.getElementById('file-filter').value.toLowerCase();
  document.querySelectorAll('#file-checklist .file-item').forEach(item => {
    const path = item.dataset.path.toLowerCase();
    item.style.display = path.includes(q) ? 'flex' : 'none';
  });
}

function uncheckAllFiles() {
  document.querySelectorAll('.file-checkbox').forEach(cb => {
    cb.checked = false;
    cb.parentElement.classList.remove('auto-selected');
  });
}

function getCheckedFilePaths() {
  return Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
}

// ============================================================================
// GESTION DES BACKUPS GITHUB (CRÉATION DE TAGS & RESTAURATION 1-CLIC)
// ============================================================================
async function loadProjectBackups() {
  if (!STATE.activeRepo) return;
  const fullName = STATE.activeRepo.full_name;
  const refs = await ghFetch(`/repos/${fullName}/git/matching-refs/tags/backup-pre-agent-`);

  STATE.backups = (refs || []).map(r => ({
    name: r.ref.replace('refs/tags/', ''),
    sha: r.object.sha
  })).reverse();

  document.getElementById('backup-count').textContent = STATE.backups.length;
  const container = document.getElementById('backups-list');
  container.innerHTML = '';

  if (STATE.backups.length === 0) {
    container.innerHTML = '<div style="color:#64748b;font-size:11px;">Aucun backup enregistré sur ce dépôt.</div>';
    return;
  }

  STATE.backups.forEach(b => {
    const card = document.createElement('div');
    card.className = 'backup-card';

    const info = document.createElement('div');
    info.className = 'backup-info';
    info.innerHTML = `<span class="backup-name">${b.name}</span><span class="backup-sha">SHA: ${b.sha.slice(0, 10)}</span>`;

    const btn = document.createElement('button');
    btn.className = 'btn-restore';
    btn.textContent = 'Restaurer';
    btn.onclick = () => restoreBackupTag(b.name, b.sha);

    card.appendChild(info);
    card.appendChild(btn);
    container.appendChild(card);
  });
}

async function createBackupTagOnGitHub(labelSuffix = 'auto') {
  const fullName = STATE.activeRepo.full_name;
  const branch = STATE.activeBranch;
  const refData = await ghFetch(`/repos/${fullName}/git/ref/heads/${branch}`);
  const currentSha = refData.object.sha;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tagName = `backup-pre-agent-${stamp}-${labelSuffix}`;

  await ghFetch(`/repos/${fullName}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/tags/${tagName}`,
      sha: currentSha
    })
  });

  log(`Backup GitHub créé : ${tagName} (SHA ${currentSha.slice(0, 7)})`, 'log-ok');
  await loadProjectBackups();
  return { tagName, sha: currentSha };
}

async function createManualBackupTag() {
  if (!STATE.activeRepo) return;
  try {
    await createBackupTagOnGitHub('manual');
  } catch (err) {
    log(`Erreur création backup : ${err.message}`, 'log-err');
  }
}

async function restoreBackupTag(tagName, targetSha) {
  if (!STATE.activeRepo) return;
  const fullName = STATE.activeRepo.full_name;
  const branch = STATE.activeBranch;

  try {
    log(`Restauration de ${branch} vers le backup ${tagName} (${targetSha.slice(0, 7)})...`, 'log-warn');
    await ghFetch(`/repos/${fullName}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: targetSha,
        force: true
      })
    });
    log(`Branche ${branch} restaurée avec succès sur ${tagName} !`, 'log-ok');
    await refreshActiveProjectFullState();
  } catch (err) {
    log(`Échec restauration backup : ${err.message}`, 'log-err');
  }
}

// ============================================================================
// NAVIGATION SIDEBAR & CLIENT API GEMINI (responseMimeType: "text/plain")
// ============================================================================
function switchSidebarTab(tabId, btnElem) {
  document.querySelectorAll('#project-sidebar .tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('#project-sidebar .tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.remove('hidden');
  btnElem.classList.add('active');
}

function setAgentMode(mode) {
  document.getElementById('mode-btn-exec').classList.toggle('active', mode === 'exec');
  document.getElementById('mode-btn-audit').classList.toggle('active', mode === 'audit');
  document.getElementById('view-mode-exec').classList.toggle('hidden', mode !== 'exec');
  document.getElementById('view-mode-audit').classList.toggle('hidden', mode !== 'audit');
}

// RÈGLE 1 : Toujours utiliser responseMimeType: "text/plain" (Zéro JSON pour le code)
async function callGeminiTextPlain(model, systemInstruction, userPrompt, temperature = 0.15) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${STATE.geminiKey}`;
  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'text/plain'
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API (${model}) ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function fetchGitHubFileContent(fullName, path, branch) {
  const data = await ghFetch(`/repos/${fullName}/contents/${encodeURIComponent(path)}?ref=${branch}`);
  const binStr = atob(data.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// ============================================================================
// 2. SÉLECTION AUTONOME DES FICHIERS EN AMONT : autoSelectFilesWithFlash()
// ============================================================================
async function autoSelectFilesWithFlash(userPrompt, ciErrorLog = '') {
  const manuallyChecked = getCheckedFilePaths();
  if (manuallyChecked.length > 0 && !ciErrorLog) {
    log(`Utilisation des ${manuallyChecked.length} fichier(s) coché(s) manuellement.`, 'log-info');
    return manuallyChecked;
  }

  log('Routing Agent : Analyse de l\'arborescence via gemini-2.5-flash...', 'log-step');
  const treePaths = STATE.treeFiles.map(f => f.path).join('\n');

  const sysInstruction = `Tu es un agent de routage de fichiers ultra-rapide.
Analyse l'arborescence complète du dépôt GitHub et la demande de l'utilisateur.
Sélectionne jusqu'à 8 fichiers pertinents qu'il faut lire ou modifier.
Renvoie UNIQUEMENT des balises XML <path>chemin/exact/du/fichier</path> en texte brut.
Aucun JSON, aucun blabla.`;

  const prompt = `ARBORESCENCE DU DÉPÔT (${STATE.activeRepo.full_name}) :
${treePaths}

DEMANDE UTILISATEUR :
${userPrompt}
${ciErrorLog ? `\nTRACEBACK / ERREUR CI/CD À CORRIGER :\n${ciErrorLog}` : ''}`;

  const rawText = await callGeminiTextPlain('gemini-2.5-flash', sysInstruction, prompt, 0.0);
  const matches = [...rawText.matchAll(/<path>\s*([\s\S]*?)\s*<\/path>/g)];
  const selectedPaths = matches
    .map(m => m[1].trim())
    .filter(p => STATE.treeFiles.some(f => f.path === p))
    .slice(0, 8);

  // Cocher visuellement les cases dans l'interface
  uncheckAllFiles();
  document.querySelectorAll('.file-checkbox').forEach(cb => {
    if (selectedPaths.includes(cb.value)) {
      cb.checked = true;
      cb.parentElement.classList.add('auto-selected');
    }
  });

  log(`gemini-2.5-flash a sélectionné ${selectedPaths.length} fichier(s) : ${selectedPaths.join(', ')}`, 'log-ok');
  return selectedPaths;
}

// ============================================================================
// CHOIX 1 : AUDIT DE L'ÉTAT DU PROJET & PROPOSITIONS D'ÉVOLUTIONS
// ============================================================================
async function runProjectAudit() {
  if (!STATE.activeRepo) return;
  const btn = document.getElementById('btn-run-audit');
  const output = document.getElementById('audit-output');
  btn.disabled = true;
  output.textContent = 'Sélection et lecture des fichiers clés par gemini-2.5-flash...';

  try {
    const auditGoal = 'Identifier les fichiers principaux (README, point d\'entrée, configuration, architecture cœur) pour réaliser un audit technique complet et proposer des évolutions.';
    const keyPaths = await autoSelectFilesWithFlash(auditGoal);

    const filesData = {};
    for (const p of keyPaths) {
      filesData[p] = await fetchGitHubFileContent(STATE.activeRepo.full_name, p, STATE.activeBranch);
    }

    let contextBlock = '';
    for (const [p, content] of Object.entries(filesData)) {
      contextBlock += `\n--- FICHIER: ${p} ---\n${content.slice(0, 6000)}\n`;
    }

    output.textContent = 'Analyse approfondie en cours via gemini-2.5-pro...';
    const sysInstruction = `Tu es un Architecte Logiciel Principal.
Analyse l'arborescence et le code source du projet.
Rédige un rapport structuré, direct et concret comprenant :
1. État actuel de l'architecture et points forts.
2. Failles potentielles, dettes techniques ou goulets d'étranglement identifiés.
3. 3 à 5 propositions d'améliorations ou nouvelles fonctionnalités concrètes (avec les fichiers précis à modifier).`;

    const report = await callGeminiTextPlain(
      'gemini-2.5-pro',
      sysInstruction,
      `PROJET : ${STATE.activeRepo.full_name}\nARBORESCENCE :\n${STATE.treeFiles.map(f => f.path).join('\n')}\n\nEXTRAITS DE CODE :\n${contextBlock}`,
      0.2
    );

    output.textContent = report;
    log(`Audit architectural terminé pour ${STATE.activeRepo.full_name}.`, 'log-ok');
  } catch (err) {
    output.textContent = `Erreur lors de l'audit : ${err.message}`;
    log(`Erreur audit : ${err.message}`, 'log-err');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// 1. PROTOCOLE XML / CDATA BRUT (ZÉRO JSON POUR LE CODE)
// ============================================================================
async function executeCodeGenerationWithPro(userPrompt, filesContentMap, ciFailureLog = '') {
  log('Génération du code via gemini-2.5-pro (Flux XML / CDATA brut, text/plain)...', 'log-step');

  let filesPromptSection = '';
  for (const [path, content] of Object.entries(filesContentMap)) {
    filesPromptSection += `\n<source_file path="${path}">\n<![CDATA[\n${content}\n]]>\n</source_file>\n`;
  }

  const sysInstruction = `Tu es un agent de programmation autonome expert.
INTERDICTION ABSOLUE D'UTILISER DU JSON.
Réponds exclusivement en texte brut avec les balises XML et CDATA suivantes :

<commit_msg><![CDATA[Message de commit clair et précis]]></commit_msg>

Pour créer un nouveau fichier ou remplacer intégralement un fichier existant (ne tronque JAMAIS le code, écris l'intégralité du fichier) :
<file path="chemin/du/fichier.py"><![CDATA[
# Code complet du fichier ici sans aucun échappement JSON
]]></file>

Ou pour appliquer un patch chirurgical sur un fichier existant :
<patch path="chemin/du/fichier.py"><![CDATA[
<<<<<<< SEARCH
code exact actuel
=======
nouveau code
>>>>>>> REPLACE
]]></patch>`;

  const fullUserPrompt = `DÉPÔT : ${STATE.activeRepo.full_name} (Branche : ${STATE.activeBranch})
ARBORESCENCE COMPLÈTE :
${STATE.treeFiles.map(f => f.path).join('\n')}

CONTENU FRAIS DES FICHIERS SÉLECTIONNÉS :
${filesPromptSection}

DEMANDE UTILISATEUR :
${userPrompt}
${ciFailureLog ? `\nERREUR CI/CD DÉTECTÉE AU CYCLE PRÉCÉDENT (CORRIGE CE PROBLÈME) :\n${ciFailureLog}` : ''}`;

  return await callGeminiTextPlain('gemini-2.5-pro', sysInstruction, fullUserPrompt, 0.1);
}

function extractCdataContent(rawBlock) {
  const trimmed = rawBlock.trim();
  const cdataStart = trimmed.indexOf('<![CDATA[');
  const cdataEnd = trimmed.lastIndexOf(']]>');
  if (cdataStart !== -1 && cdataEnd !== -1 && cdataEnd > cdataStart) {
    return trimmed.slice(cdataStart + 9, cdataEnd).replace(/^\r?\n|\r?\n$/g, '');
  }
  return trimmed.replace(/^\r?\n|\r?\n$/g, '');
}

function parseXmlCdataOperations(rawXmlResponse, currentFilesMap) {
  const commitMatch = rawXmlResponse.match(/<commit_msg>([\s\S]*?)<\/commit_msg>/);
  const commitMsg = commitMatch
    ? extractCdataContent(commitMatch[1]).trim()
    : 'Autonomous XML/CDATA update via Neural Dev Hub V6.0';

  const modifiedFiles = {}; // path -> contenu final complet

  // Extraction des balises <file path="...">
  const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
  for (const match of rawXmlResponse.matchAll(fileRegex)) {
    const filePath = match[1].trim();
    const fileCode = extractCdataContent(match[2]);
    modifiedFiles[filePath] = fileCode;
  }

  // Extraction des balises <patch path="...">
  const patchRegex = /<patch\s+path="([^"]+)">([\s\S]*?)<\/patch>/g;
  for (const match of rawXmlResponse.matchAll(patchRegex)) {
    const filePath = match[1].trim();
    const patchBody = extractCdataContent(match[2]);
    let baseContent = modifiedFiles[filePath] ?? currentFilesMap[filePath];

    if (baseContent === undefined) {
      throw new Error(`Le fichier ${filePath} ciblé par <patch> n'a pas été chargé en amont.`);
    }

    const srRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
    let count = 0;
    for (const sr of patchBody.matchAll(srRegex)) {
      const searchPart = sr[1];
      const replacePart = sr[2];
      if (!baseContent.includes(searchPart)) {
        throw new Error(`Bloc SEARCH introuvable dans ${filePath}.`);
      }
      baseContent = baseContent.replace(searchPart, replacePart);
      count++;
    }
    if (count === 0) {
      throw new Error(`Aucun bloc SEARCH/REPLACE valide trouvé dans <patch path="${filePath}">.`);
    }
    modifiedFiles[filePath] = baseContent;
  }

  return { commitMsg, modifiedFiles };
}

// ============================================================================
// 3. COMMIT GIT ATOMIQUE MULTI-FICHIERS : pushAtomicCommit()
// (git/blobs -> git/trees -> git/commits -> git/refs/heads/branch)
// ============================================================================
async function pushAtomicCommit(fullName, branch, commitMsg, modifiedFilesMap) {
  const filePaths = Object.keys(modifiedFilesMap);
  if (filePaths.length === 0) {
    throw new Error('Aucune balise <file> ou <patch> valide générée par le modèle.');
  }

  log(`Commit Atomique : Création de ${filePaths.length} blob(s) via Git Data API...`, 'log-step');

  // 1. Récupérer la référence actuelle et le tree de base
  const refData = await ghFetch(`/repos/${fullName}/git/ref/heads/${branch}`);
  const parentCommitSha = refData.object.sha;
  const parentCommit = await ghFetch(`/repos/${fullName}/git/commits/${parentCommitSha}`);
  const baseTreeSha = parentCommit.tree.sha;

  // 2. Créer chaque blob via POST /git/blobs
  const treeEntries = [];
  for (const path of filePaths) {
    const blobRes = await ghFetch(`/repos/${fullName}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: modifiedFilesMap[path],
        encoding: 'utf-8'
      })
    });
    treeEntries.push({
      path,
      mode: '100644',
      type: 'blob',
      sha: blobRes.sha
    });
  }

  // 3. Créer le nouvel arbre via POST /git/trees
  const newTree = await ghFetch(`/repos/${fullName}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries
    })
  });

  // 4. Créer le commit unique via POST /git/commits
  const newCommit = await ghFetch(`/repos/${fullName}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: commitMsg,
      tree: newTree.sha,
      parents: [parentCommitSha]
    })
  });

  // 5. Mettre à jour la branche via PATCH /git/refs/heads/{branch}
  await ghFetch(`/repos/${fullName}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });

  log(`Commit Atomique poussé : ${newCommit.sha.slice(0, 7)} (${filePaths.length} fichiers) — "${commitMsg}"`, 'log-ok');
  return newCommit.sha;
}

// ============================================================================
// 4. BOUCLE FERMÉE D'AUTO-RÉPARATION CI/CD :
// waitForCIRunAndGetFailureLog() & extractFailedJobTrace() (4 500 derniers car.)
// ============================================================================
async function waitForCIRunAndGetFailureLog(fullName, commitSha) {
  log(`Surveillance GitHub Actions (polling 4s) pour le commit ${commitSha.slice(0, 7)}...`, 'log-step');

  let targetRun = null;
  for (let i = 0; i < 7; i++) {
    await sleep(4000);
    const runsData = await ghFetch(`/repos/${fullName}/actions/runs?head_sha=${commitSha}`);
    if (runsData.total_count > 0) {
      targetRun = runsData.workflow_runs[0];
      break;
    }
  }

  if (!targetRun) {
    log('Aucun workflow GitHub Actions déclenché sur ce commit.', 'log-ok');
    return { passed: true, trace: '' };
  }

  log(`Workflow "${targetRun.name}" actif (Run #${targetRun.id}). Attente de fin d'exécution...`, 'log-info');

  // Interrogation toutes les 4 secondes
  for (let poll = 0; poll < 120; poll++) {
    const runStatus = await ghFetch(`/repos/${fullName}/actions/runs/${targetRun.id}`);
    if (runStatus.status === 'completed') {
      if (runStatus.conclusion === 'success') {
        log(`Tests CI/CD passés au vert (${runStatus.name}) !`, 'log-ok');
        return { passed: true, trace: '' };
      } else {
        log(`Échec CI/CD (${runStatus.conclusion}). Téléchargement de la Traceback...`, 'log-err');
        const trace = await extractFailedJobTrace(fullName, targetRun.id);
        return { passed: false, trace };
      }
    }
    await sleep(4000);
  }

  throw new Error('Timeout lors de l\'attente du workflow GitHub Actions.');
}

async function extractFailedJobTrace(fullName, runId) {
  const jobsData = await ghFetch(`/repos/${fullName}/actions/runs/${runId}/jobs`);
  const failedJobs = (jobsData.jobs || []).filter(j => j.conclusion === 'failure');
  let combinedTrace = '';

  for (const job of failedJobs) {
    const failedSteps = (job.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name);
    combinedTrace += `=== JOB ÉCHOUÉ: ${job.name} (Steps: ${failedSteps.join(', ')}) ===\n`;

    // Tentative de lecture directe du log brut du job
    try {
      const res = await fetch(`https://api.github.com/repos/${fullName}/actions/jobs/${job.id}/logs`, {
        headers: { 'Authorization': `Bearer ${STATE.ghToken}` }
      });
      if (res.ok) {
        const fullLogText = await res.text();
        combinedTrace += fullLogText.slice(-4500) + '\n';
        continue;
      }
    } catch (_) {}

    // Repli automatique sur les annotations si la redirection Azure Blob est bloquée par CORS
    try {
      const annotations = await ghFetch(`/repos/${fullName}/check-runs/${job.id}/annotations`);
      if (annotations && annotations.length > 0) {
        annotations.forEach(a => {
          combinedTrace += `[${a.annotation_level}] ${a.path} (ligne ${a.start_line}): ${a.message}\n${a.raw_details || ''}\n`;
        });
      }
    } catch (_) {}
  }

  // RÈGLE 4 : Renvoyer exactement les 4 500 derniers caractères du journal d'erreur
  return combinedTrace.slice(-4500) || 'Échec du job GitHub Actions sans trace texte détaillée.';
}

// ============================================================================
// PIPELINE PRINCIPAL D'EXÉCUTION AUTONOME (BACKUP -> FLASH -> PRO -> COMMIT -> CI)
// ============================================================================
async function runFreeExecutionPipeline() {
  if (!STATE.activeRepo) return;
  const userPrompt = document.getElementById('custom-prompt').value.trim();
  if (!userPrompt) {
    return log('Écris une consigne dans la zone de prompt avant de lancer le pipeline.', 'log-warn');
  }

  const fullName = STATE.activeRepo.full_name;
  const branch = STATE.activeBranch;
  const autoHealEnabled = document.getElementById('auto-heal-toggle').checked;
  const maxCycles = autoHealEnabled ? 3 : 1;

  const btn = document.getElementById('btn-run-exec');
  btn.disabled = true;
  setNeuronVisualState(fullName, 'working');

  try {
    // 1. Création systématique d'un tag de Backup GitHub avant toute modification
    await createBackupTagOnGitHub('pre-run');

    let cycle = 1;
    let ciFailureLog = '';

    while (cycle <= maxCycles) {
      log(`--- CYCLE D'EXÉCUTION AUTONOME #${cycle}/${maxCycles} SUR ${fullName} ---`, 'log-step');

      // 2. Sélection des fichiers utiles par gemini-2.5-flash (si rien n'est coché ou si en mode réparation CI)
      const targetPaths = await autoSelectFilesWithFlash(userPrompt, ciFailureLog);

      // 3. Téléchargement du contenu frais depuis GitHub
      const filesContentMap = {};
      for (const path of targetPaths) {
        log(`Téléchargement frais : ${path}...`, 'log-info');
        filesContentMap[path] = await fetchGitHubFileContent(fullName, path, branch);
      }

      // 4. Programmation principale via gemini-2.5-pro en XML/CDATA brut
      const rawXml = await executeCodeGenerationWithPro(userPrompt, filesContentMap, ciFailureLog);
      const { commitMsg, modifiedFiles } = parseXmlCdataOperations(rawXml, filesContentMap);

      // 5. Commit Git Atomique Multi-Fichiers
      const newCommitSha = await pushAtomicCommit(fullName, branch, commitMsg, modifiedFiles);

      // Rafraîchir l'état du panneau projet (arborescence & dernier commit)
      await refreshActiveProjectFullState();

      if (!autoHealEnabled) {
        setNeuronVisualState(fullName, 'idle');
        log('Modifications poussées avec succès (Auto-Heal CI/CD désactivé).', 'log-ok');
        break;
      }

      // 6. Surveillance GitHub Actions & Auto-Heal
      const ciCheck = await waitForCIRunAndGetFailureLog(fullName, newCommitSha);
      await refreshActiveProjectFullState();

      if (ciCheck.passed) {
        setNeuronVisualState(fullName, 'idle');
        log(`Pipeline terminé avec succès au cycle #${cycle} : CI/CD au vert !`, 'log-ok');
        break;
      } else {
        setNeuronVisualState(fullName, 'failure');
        ciFailureLog = ciCheck.trace;
        log(`Traceback CI récupérée (${ciFailureLog.length} car.) :\n${ciFailureLog.slice(-600)}`, 'log-warn');
        // Décocher pour laisser Flash re-sélectionner les fichiers impliqués dans la Traceback
        uncheckAllFiles();
        cycle++;
        if (cycle > maxCycles) {
          log(`Limite de ${maxCycles} cycles Auto-Heal atteinte. Utilise l'onglet Backups si tu souhaites restaurer l'état initial.`, 'log-err');
        }
      }
    }
  } catch (err) {
    setNeuronVisualState(fullName, 'failure');
    log(`Erreur pipeline : ${err.message}`, 'log-err');
  } finally {
    btn.disabled = false;
  }
}

function setNeuronVisualState(fullName, state) {
  if (!STATE.graph3D) return;
  const { nodes } = STATE.graph3D.graphData();
  const node = nodes.find(n => n.id === fullName);
  if (node) {
    node.ciState = state;
    STATE.graph3D.nodeColor(STATE.graph3D.nodeColor());
  }
}
