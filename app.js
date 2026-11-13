// ============================================================================
// ÉTAT GLOBAL & INITIALISATION
// ============================================================================
const STATE = {
  ghToken: localStorage.getItem('ndh_gh_token') || '',
  geminiKey: localStorage.getItem('ndh_gemini_key') || '',
  currentRepo: '',
  currentBranch: 'main',
  treeFiles: [], // Liste des blobs du dépôt
  graph: null,
  cortexNode: {
    id: 'CORTEX_CORE',
    name: 'CORTEX_CORE',
    group: 'core',
    fx: 0,
    fy: 0,
    fz: 0,
    val: 25
  }
};

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gh-token').value = STATE.ghToken;
  document.getElementById('gemini-key').value = STATE.geminiKey;
  init3DGraph();
  log('Système Neural Dev Hub V6.0 initialisé. En attente de connexion.', 'log-info');
});

function log(msg, type = 'log-info') {
  const term = document.getElementById('terminal');
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = type;
  line.textContent = `[${time}] ${msg}`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function setStatus(text, color = '#1e293b') {
  const badge = document.getElementById('ci-status');
  badge.textContent = text;
  badge.style.background = color;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// 5. CAMÉRA 3D & VERROUILLAGE PERMANENT SUR CORTEX_CORE
// ============================================================================
function init3DGraph() {
  const elem = document.getElementById('3d-graph');
  STATE.graph = ForceGraph3D()(elem)
    .backgroundColor('#07090e')
    .nodeLabel('name')
    .nodeVal('val')
    .nodeColor(node => {
      if (node.id === 'CORTEX_CORE') return '#00f0ff';
      if (node.status === 'modified') return '#10b981';
      if (node.status === 'selected') return '#f59e0b';
      if (node.status === 'error') return '#ef4444';
      return '#3b82f6';
    })
    .linkColor(() => 'rgba(0, 240, 255, 0.2)')
    .linkDirectionalParticles(link => link.active ? 4 : 0)
    .linkDirectionalParticleSpeed(0.01)
    .linkDirectionalParticleWidth(2)
    .graphData({ nodes: [STATE.cortexNode], links: [] });

  // Verrouillage permanent de controls().target sur les coordonnées réelles de CORTEX_CORE
  STATE.graph.onEngineTick(() => {
    const controls = STATE.graph.controls();
    if (controls && STATE.cortexNode) {
      controls.target.set(
        STATE.cortexNode.x || 0,
        STATE.cortexNode.y || 0,
        STATE.cortexNode.z || 0
      );
    }
  });
}

function recenterCortex() {
  if (!STATE.graph) return;
  STATE.graph.cameraPosition(
    { x: 0, y: 80, z: 260 },
    { x: STATE.cortexNode.x || 0, y: STATE.cortexNode.y || 0, z: STATE.cortexNode.z || 0 },
    1000
  );
}

function updateGraphSelection(selectedPaths = [], status = 'selected') {
  if (!STATE.graph) return;
  const data = STATE.graph.graphData();
  data.nodes.forEach(n => {
    if (n.id !== 'CORTEX_CORE') {
      if (selectedPaths.includes(n.id)) n.status = status;
      else if (status === 'reset') n.status = 'idle';
    }
  });
  data.links.forEach(l => {
    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
    l.active = selectedPaths.includes(targetId);
  });
  STATE.graph.nodeColor(STATE.graph.nodeColor());
  STATE.graph.linkDirectionalParticles(STATE.graph.linkDirectionalParticles());
}

// ============================================================================
// CONNEXION GITHUB & CHARGEMENT DE L'ARBORESCENCE
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
    const errText = await res.text();
    throw new Error(`GitHub API ${res.status}: ${errText}`);
  }
  return res.status === 204 ? null : res.json();
}

async function initHub() {
  STATE.ghToken = document.getElementById('gh-token').value.trim();
  STATE.geminiKey = document.getElementById('gemini-key').value.trim();
  if (!STATE.ghToken || !STATE.geminiKey) {
    return log('Erreur : GitHub PAT et clé Gemini requis.', 'log-err');
  }
  localStorage.setItem('ndh_gh_token', STATE.ghToken);
  localStorage.setItem('ndh_gemini_key', STATE.geminiKey);

  try {
    log('Connexion à GitHub API...', 'log-step');
    const repos = await ghFetch('/user/repos?per_page=100&sort=updated');
    const select = document.getElementById('repo-select');
    select.innerHTML = '<option value="">-- Sélectionner un dépôt --</option>';
    repos.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.full_name;
      opt.dataset.defaultBranch = r.default_branch;
      opt.textContent = `${r.full_name} (${r.default_branch})`;
      select.appendChild(opt);
    });
    select.disabled = false;
    log(`${repos.length} dépôts chargés avec succès.`, 'log-ok');
  } catch (err) {
    log(`Échec connexion GitHub : ${err.message}`, 'log-err');
  }
}

async function loadRepoTree() {
  const select = document.getElementById('repo-select');
  const repo = select.value;
  if (!repo) return;

  const selectedOpt = select.options[select.selectedIndex];
  const defaultBranch = selectedOpt.dataset.defaultBranch || 'main';
  const branchInput = document.getElementById('branch-input');
  branchInput.value = defaultBranch;

  STATE.currentRepo = repo;
  STATE.currentBranch = branchInput.value.trim();

  try {
    log(`Chargement de l'arborescence ${repo}@${STATE.currentBranch}...`, 'log-step');
    const refData = await ghFetch(`/repos/${repo}/git/ref/heads/${STATE.currentBranch}`);
    const commitSha = refData.object.sha;
    const commitData = await ghFetch(`/repos/${repo}/git/commits/${commitSha}`);
    const treeData = await ghFetch(`/repos/${repo}/git/trees/${commitData.tree.sha}?recursive=1`);

    STATE.treeFiles = treeData.tree.filter(item => item.type === 'blob');
    buildGraphFromTree(STATE.treeFiles);
    document.getElementById('btn-run').disabled = false;
    log(`${STATE.treeFiles.length} fichiers indexés dans le graphe 3D.`, 'log-ok');
  } catch (err) {
    log(`Erreur chargement arbre : ${err.message}`, 'log-err');
  }
}

function buildGraphFromTree(files) {
  const nodes = [STATE.cortexNode];
  const links = [];
  const folderSet = new Set();

  files.forEach(f => {
    const parts = f.path.split('/');
    let parentId = 'CORTEX_CORE';

    // Création des noeuds de dossiers intermédiaires
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join('/');
      if (!folderSet.has(folderPath)) {
        folderSet.add(folderPath);
        nodes.push({
          id: folderPath,
          name: parts[i] + '/',
          group: 'folder',
          val: 6
        });
        links.push({ source: parentId, target: folderPath, active: false });
      }
      parentId = folderPath;
    }

    // Noeud fichier
    nodes.push({
      id: f.path,
      name: parts[parts.length - 1],
      group: 'file',
      val: 3,
      status: 'idle'
    });
    links.push({ source: parentId, target: f.path, active: false });
  });

  STATE.graph.graphData({ nodes, links });
}

// Lecture UTF-8 propre d'un fichier sur GitHub
async function fetchFileContent(repo, path, branch) {
  const data = await ghFetch(`/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`);
  const binStr = atob(data.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// ============================================================================
// APPEL API GEMINI (FLASH & PRO)
// ============================================================================
async function callGemini(model, systemInstruction, userPrompt, temperature = 0.1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${STATE.geminiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API (${model}) ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ============================================================================
// 1 & 2. TRI DES FICHIERS (FLASH) & PROTOCOLE XML BRUT (PRO)
// ============================================================================
async function selectRelevantFiles(userGoal, errorContext = '') {
  log('Tri des fichiers pertinents via gemini-2.5-flash...', 'log-step');
  const allPaths = STATE.treeFiles.map(f => f.path).join('\n');

  const sysPrompt = `Tu es un routeur d'architecture logicielle.
Analyse l'arborescence du dépôt et l'objectif demandé.
Renvoie UNIQUEMENT des balises XML <read>chemin/du/fichier</read> pour les fichiers qu'il est indispensable de lire ou modifier (maximum 12 fichiers).
Aucun JSON, aucun commentaire hors balises.`;

  const prompt = `ARBORESCENCE DU DÉPÔT :\n${allPaths}\n\nOBJECTIF :\n${userGoal}\n${errorContext ? `\nERREUR CI/CD À CORRIGER :\n${errorContext}` : ''}`;

  const rawXml = await callGemini('gemini-2.5-flash', sysPrompt, prompt, 0.0);
  const matches = [...rawXml.matchAll(/<read>\s*([\s\S]*?)\s*<\/read>/g)];
  const selected = matches.map(m => m[1].trim()).filter(p => STATE.treeFiles.some(f => f.path === p));

  log(`Fichiers sélectionnés (${selected.length}) : ${selected.join(', ') || 'Aucun fichier existant'}`, 'log-info');
  return selected;
}

async function generateXmlChanges(userGoal, filesContextMap, errorContext = '') {
  log('Génération des modifications de code via gemini-2.5-pro (Protocole XML Brut)...', 'log-step');

  let contextStr = '';
  for (const [path, content] of Object.entries(filesContextMap)) {
    contextStr += `\n=== FILE: ${path} ===\n${content}\n=== END FILE: ${path} ===\n`;
  }

  const sysPrompt = `Tu es un ingénieur logiciel autonome.
Tu ne dois JAMAIS utiliser de JSON. Utilise exclusivement le protocole XML brut suivant :

<commit_msg>Message de commit clair et concis</commit_msg>

Pour créer ou remplacer intégralement un fichier :
<file path="chemin/fichier.ext">
Contenu complet du fichier ici...
</file>

Pour modifier chirurgicalement un fichier existant :
<patch path="chemin/fichier.ext">
<<<<<<< SEARCH
lignes exactes à chercher
=======
nouvelles lignes de remplacement
>>>>>>> REPLACE
</patch>

Règles strictes :
1. N'entoure PAS tes balises avec des blocsCDATA si le code contient "]]>". Écris le code brut directement entre <file...> et </file> ou <patch...> et </patch>.
2. Dans un bloc SEARCH, reproduis l'indentation exacte du fichier source.`;

  const userPrompt = `ARBORESCENCE COMPLÈTE :\n${STATE.treeFiles.map(f => f.path).join('\n')}

CONTENU DES FICHIERS SÉLECTIONNÉS :
${contextStr || '(Aucun fichier lu)'}

MISSION :
${userGoal}
${errorContext ? `\nIMPORTANT - ÉCHEC CI/CD PRÉCÉDENT À CORRIGER :\n${errorContext}` : ''}`;

  return await callGemini('gemini-2.5-pro', sysPrompt, userPrompt, 0.1);
}

// Parseur Regex tolérant aux pannes (supporte CDATA optionnel sans planter sur ]]> interne)
function stripOptionalCdata(str) {
  let clean = str.trim();
  if (clean.startsWith('<![CDATA[') && clean.endsWith(']]>')) {
    clean = clean.slice(9, -3);
  }
  return clean.replace(/^\n+|\n+$/g, '');
}

function parseXmlResponse(rawXml, existingFilesMap) {
  const commitMatch = rawXml.match(/<commit_msg>([\s\S]*?)<\/commit_msg>/);
  const commitMsg = commitMatch ? stripOptionalCdata(commitMatch[1]).trim() : 'Autonomous update via Neural Dev Hub V6.0';

  const finalFiles = {}; // path -> new full content

  // 1. Fichiers complets <file path="...">
  const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
  for (const match of rawXml.matchAll(fileRegex)) {
    const path = match[1].trim();
    const content = stripOptionalCdata(match[2]);
    finalFiles[path] = content;
  }

  // 2. Patchs chirurgicaux <patch path="...">
  const patchRegex = /<patch\s+path="([^"]+)">([\s\S]*?)<\/patch>/g;
  for (const match of rawXml.matchAll(patchRegex)) {
    const path = match[1].trim();
    const patchBody = stripOptionalCdata(match[2]);
    let currentContent = finalFiles[path] ?? existingFilesMap[path];

    if (currentContent === undefined) {
      throw new Error(`Impossible d'appliquer <patch> sur ${path} : fichier non chargé en mémoire.`);
    }

    const srRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
    let patchCount = 0;
    for (const sr of patchBody.matchAll(srRegex)) {
      const searchBlock = sr[1];
      const replaceBlock = sr[2];
      if (!currentContent.includes(searchBlock)) {
        throw new Error(`Bloc SEARCH introuvable dans ${path}:\n${searchBlock.slice(0, 120)}...`);
      }
      currentContent = currentContent.replace(searchBlock, replaceBlock);
      patchCount++;
    }

    if (patchCount === 0) {
      throw new Error(`Balise <patch> pour ${path} ne contient aucun bloc SEARCH/REPLACE valide.`);
    }
    finalFiles[path] = currentContent;
  }

  return { commitMsg, finalFiles };
}

// ============================================================================
// 3. COMMIT ATOMIQUE MULTI-FICHIERS (GIT DATA API)
// ============================================================================
async function pushAtomicCommit(repo, branch, commitMsg, filesMap) {
  const paths = Object.keys(filesMap);
  if (paths.length === 0) {
    throw new Error('Aucun fichier généré ou modifié dans la réponse XML.');
  }

  log(`Préparation du commit atomique (${paths.length} fichier(s))...`, 'log-step');

  // 1. Récupérer le dernier commit SHA de la branche
  const refData = await ghFetch(`/repos/${repo}/git/ref/heads/${branch}`);
  const latestCommitSha = refData.object.sha;
  const latestCommit = await ghFetch(`/repos/${repo}/git/commits/${latestCommitSha}`);
  const baseTreeSha = latestCommit.tree.sha;

  // 2. Construire le nouveau Tree (GitHub crée les blobs automatiquement via la propriété 'content')
  const treeItems = paths.map(path => ({
    path,
    mode: '100644',
    type: 'blob',
    content: filesMap[path]
  }));

  const newTree = await ghFetch(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeItems
    })
  });

  // 3. Créer le commit
  const newCommit = await ghFetch(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: commitMsg,
      tree: newTree.sha,
      parents: [latestCommitSha]
    })
  });

  // 4. Mettre à jour la référence de la branche
  await ghFetch(`/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });

  log(`Commit atomique poussé : ${newCommit.sha.slice(0, 7)} ("${commitMsg}")`, 'log-ok');
  return newCommit.sha;
}

// ============================================================================
// 4. BOUCLE AUTO-HEAL CI/CD (SURVEILLANCE GITHUB ACTIONS)
// ============================================================================
async function waitForCiAndExtractResult(repo, commitSha) {
  log(`Attente du déclenchement GitHub Actions pour ${commitSha.slice(0, 7)}...`, 'log-step');
  setStatus('CI: WAITING', '#f59e0b');

  let run = null;
  // Attente jusqu'à 25 secondes pour voir si un workflow se déclenche
  for (let i = 0; i < 5; i++) {
    await sleep(5000);
    const runsData = await ghFetch(`/repos/${repo}/actions/runs?head_sha=${commitSha}`);
    if (runsData.total_count > 0) {
      run = runsData.workflow_runs[0];
      break;
    }
  }

  if (!run) {
    log('Aucun workflow GitHub Actions détecté pour ce commit.', 'log-ok');
    setStatus('CI: NO WORKFLOW', '#10b981');
    return { success: true };
  }

  log(`Workflow détecté : "${run.name}" (ID: ${run.id}). Surveillance en cours...`, 'log-info');
  setStatus('CI: RUNNING', '#0077ff');

  // Polling jusqu'à complétion du workflow (max 10 minutes)
  for (let poll = 0; poll < 60; poll++) {
    const currentRun = await ghFetch(`/repos/${repo}/actions/runs/${run.id}`);
    if (currentRun.status === 'completed') {
      if (currentRun.conclusion === 'success') {
        log(`CI/CD validé avec succès (${currentRun.name}) !`, 'log-ok');
        setStatus('CI: PASS', '#10b981');
        return { success: true };
      } else {
        log(`Échec CI/CD détecté (Conclusion : ${currentRun.conclusion}). Extraction du diagnostic...`, 'log-err');
        setStatus('CI: FAILED', '#ef4444');
        const errorReport = await extractCiFailureReport(repo, run.id);
        return { success: false, errorLog: errorReport };
      }
    }
    await sleep(10000);
  }

  throw new Error('Timeout lors de la surveillance du workflow GitHub Actions.');
}

async function extractCiFailureReport(repo, runId) {
  const jobsData = await ghFetch(`/repos/${repo}/actions/runs/${runId}/jobs`);
  const failedJobs = jobsData.jobs.filter(j => j.conclusion === 'failure');
  let report = '';

  for (const job of failedJobs) {
    const failedSteps = (job.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name);
    report += `Job en échec : "${job.name}" | Étapes échouées : ${failedSteps.join(', ')}\n`;

    // 1. Récupération des annotations d'erreur (100% compatible CORS)
    try {
      const annotations = await ghFetch(`/repos/${repo}/check-runs/${job.id}/annotations`);
      if (annotations && annotations.length > 0) {
        annotations.forEach(a => {
          report += `- [${a.annotation_level}] ${a.path}:${a.start_line} -> ${a.message}\n`;
        });
      }
    } catch (_) {}

    // 2. Tentative de téléchargement des 120 dernières lignes du log brut (si CORS autorisé)
    try {
      const logRes = await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`, {
        headers: { 'Authorization': `Bearer ${STATE.ghToken}` }
      });
      if (logRes.ok) {
        const rawText = await logRes.text();
        const tailLines = rawText.split('\n').slice(-120).join('\n');
        report += `\n--- EXTRAIT DU LOG (${job.name}) ---\n${tailLines}\n`;
      }
    } catch (_) {
      report += `(Log brut bloqué par CORS navigateur, utilisation des métadonnées et annotations ci-dessus)\n`;
    }
  }

  return report || 'Le workflow a échoué sans annotation détaillée.';
}

// ============================================================================
// ORCHESTRATEUR PRINCIPAL (CYCLE AUTONOME + AUTO-HEAL)
// ============================================================================
async function triggerAutonomousCycle() {
  const userGoal = document.getElementById('prompt-input').value.trim();
  STATE.currentBranch = document.getElementById('branch-input').value.trim() || 'main';
  const autoHeal = document.getElementById('auto-heal-toggle').checked;

  if (!STATE.currentRepo || !userGoal) {
    return log('Sélectionne un dépôt et saisis une instruction.', 'log-warn');
  }

  const btnRun = document.getElementById('btn-run');
  btnRun.disabled = true;

  let attempt = 1;
  const maxAttempts = autoHeal ? 3 : 1;
  let errorContext = '';

  try {
    while (attempt <= maxAttempts) {
      log(`=== CYCLE AUTONOME #${attempt}/${maxAttempts} ===`, 'log-step');
      updateGraphSelection([], 'reset');

      // Étape 1 : Tri des fichiers avec Gemini 2.5 Flash
      const selectedPaths = await selectRelevantFiles(userGoal, errorContext);
      updateGraphSelection(selectedPaths, 'selected');

      // Étape 2 : Lecture du contenu des fichiers sélectionnés sur GitHub
      const filesContextMap = {};
      for (const path of selectedPaths) {
        log(`Lecture de ${path}...`, 'log-info');
        filesContextMap[path] = await fetchFileContent(STATE.currentRepo, path, STATE.currentBranch);
      }

      // Étape 3 : Génération XML avec Gemini 2.5 Pro
      const rawXml = await generateXmlChanges(userGoal, filesContextMap, errorContext);
      const { commitMsg, finalFiles } = parseXmlResponse(rawXml, filesContextMap);

      const modifiedPaths = Object.keys(finalFiles);
      updateGraphSelection(modifiedPaths, 'modified');

      // Étape 4 : Commit Atomique Multi-Fichiers
      const commitSha = await pushAtomicCommit(STATE.currentRepo, STATE.currentBranch, commitMsg, finalFiles);

      // Rafraîchir l'arbre si de nouveaux fichiers ont été créés
      await loadRepoTree();
      updateGraphSelection(modifiedPaths, 'modified');

      // Étape 5 : Vérification CI/CD & Boucle Auto-Heal
      if (!autoHeal) {
        log('Mission terminée (Auto-Heal désactivé).', 'log-ok');
        setStatus('DONE', '#10b981');
        break;
      }

      const ciResult = await waitForCiAndExtractResult(STATE.currentRepo, commitSha);
      if (ciResult.success) {
        log(`Mission accomplie et validée par la CI au cycle #${attempt} !`, 'log-ok');
        break;
      } else {
        updateGraphSelection(modifiedPaths, 'error');
        errorContext = ciResult.errorLog;
        log(`Diagnostic CI récupéré :\n${errorContext}`, 'log-warn');
        attempt++;
        if (attempt > maxAttempts) {
          log(`Arrêt de sécurité : Nombre maximal de tentatives Auto-Heal (${maxAttempts}) atteint.`, 'log-err');
        }
      }
    }
  } catch (err) {
    log(`Erreur critique durant le cycle : ${err.message}`, 'log-err');
    setStatus('ERROR', '#ef4444');
  } finally {
    btnRun.disabled = false;
  }
}
