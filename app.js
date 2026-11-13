// ============================================================================
// PALETTE BIO-LUMINESCENTE PAR LANGAGE / PROJET
// ============================================================================
const LANG_PALETTE = {
  Python: '#00f0ff',      // Cyan électrique
  JavaScript: '#ffbe0b',  // Or solaire
  TypeScript: '#3a86ff',  // Bleu néon
  HTML: '#ff007f',        // Magenta vif
  CSS: '#b5179e',         // Violet profond
  Rust: '#fb5607',        // Orange plasma
  C: '#8338ec',           // Indigo
  'C++': '#7209b7',
  Vue: '#06d6a0',         // Émeraude
  default: '#a855f7'      // Améthyste
};

function getProjectColor(repo, index) {
  if (repo.language && LANG_PALETTE[repo.language]) {
    return LANG_PALETTE[repo.language];
  }
  const fallbackColors = ['#00f0ff', '#ff2a85', '#06d6a0', '#ffbe0b', '#8338ec', '#3a86ff'];
  return fallbackColors[index % fallbackColors.length];
}

// ============================================================================
// ÉTAT GLOBAL DU HUB V6.0
// ============================================================================
const STATE = {
  ghToken: '',
  geminiKey: '',
  storageMode: 'none',    // 'local' (PC Principal) ou 'session' (PC Occasionnel)
  repos: [],
  activeRepo: null,
  activeBranch: 'main',
  treeFiles: [],
  backups: [],
  graph3D: null,
  orbitAngle: 0,
  orbitRadius: 210,
  cameraLockedOnNode: null, // Si non-null, la caméra est verrouillée sur cet amas projet
  cortexNode: {
    id: 'CORTEX_CORE',
    name: 'CORTEX CENTRAL',
    nodeType: 'cortex',
    fx: 0,
    fy: 0,
    fz: 0
  },
  clusterMap: new Map() // repo.full_name -> { hubNode, microNodes }
};

// ============================================================================
// DÉMARRAGE AUTOMATIQUE & GESTION DES CLÉS (PC PRINCIPAL vs OCCASIONNEL)
// ============================================================================
function bootHub() {
  bindUIEvents();
  init3DCortexGraph();
  startOrbitalAnimation();

  // Détection automatique des clés en mémoire (sans avoir à cliquer sur Reconnecter)
  const localGh = localStorage.getItem('ndh_gh_token');
  const localGem = localStorage.getItem('ndh_gemini_key');
  const sessionGh = sessionStorage.getItem('ndh_gh_token');
  const sessionGem = sessionStorage.getItem('ndh_gemini_key');

  if (localGh && localGem) {
    STATE.ghToken = localGh;
    STATE.geminiKey = localGem;
    STATE.storageMode = 'local';
    updatePersistenceBadge();
    connectAndBuildCortex();
  } else if (sessionGh && sessionGem) {
    STATE.ghToken = sessionGh;
    STATE.geminiKey = sessionGem;
    STATE.storageMode = 'session';
    updatePersistenceBadge();
    connectAndBuildCortex();
  } else {
    // Première connexion : afficher le choix PC Principal / Occasionnel
    document.getElementById('auth-overlay').classList.remove('hidden');
    setGlobalStatus('ATTENTE CLÉS', '#f59e0b');
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootHub);
} else {
  bootHub();
}

function updatePersistenceBadge() {
  const pill = document.getElementById('persistence-badge');
  if (STATE.storageMode === 'local') {
    pill.textContent = '🔒 PC PRINCIPAL (Clés permanentes)';
  } else if (STATE.storageMode === 'session') {
    pill.textContent = '⏳ PC OCCASIONNEL (Session seule)';
  } else {
    pill.textContent = 'NON CONNECTÉ';
  }
}

function bindUIEvents() {
  // Choix visuel Radio PC Principal / Occasionnel
  document.querySelectorAll('input[name="device-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      document.getElementById('opt-main-pc').classList.toggle('selected', e.target.value === 'local');
      document.getElementById('opt-temp-pc').classList.toggle('selected', e.target.value === 'session');
    });
  });

  // Validation première connexion
  document.getElementById('btn-auth-submit').addEventListener('click', () => {
    const gh = document.getElementById('gh-token-input').value.trim();
    const gem = document.getElementById('gemini-key-input').value.trim();
    const mode = document.querySelector('input[name="device-mode"]:checked').value;

    if (!gh || !gem) {
      return log('Erreur : Les deux clés (GitHub PAT et Gemini API Key) sont obligatoires.', 'log-err');
    }

    localStorage.removeItem('ndh_gh_token');
    localStorage.removeItem('ndh_gemini_key');
    sessionStorage.removeItem('ndh_gh_token');
    sessionStorage.removeItem('ndh_gemini_key');

    if (mode === 'local') {
      localStorage.setItem('ndh_gh_token', gh);
      localStorage.setItem('ndh_gemini_key', gem);
    } else {
      sessionStorage.setItem('ndh_gh_token', gh);
      sessionStorage.setItem('ndh_gemini_key', gem);
    }

    STATE.ghToken = gh;
    STATE.geminiKey = gem;
    STATE.storageMode = mode;

    updatePersistenceBadge();
    document.getElementById('auth-overlay').classList.add('hidden');
    connectAndBuildCortex();
  });

  // Bouton Déconnexion
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('ndh_gh_token');
    localStorage.removeItem('ndh_gemini_key');
    sessionStorage.removeItem('ndh_gh_token');
    sessionStorage.removeItem('ndh_gemini_key');
    location.reload();
  });

  // Sortie du focus projet par bouton Retour ou touche Échap
  document.getElementById('btn-back-cortex').addEventListener('click', unlockAndReturnToCortex);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && STATE.cameraLockedOnNode) {
      unlockAndReturnToCortex();
    }
  });

  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    document.getElementById('terminal').innerHTML = '';
  });

  document.getElementById('proj-branch-input').addEventListener('change', async (e) => {
    const b = e.target.value.trim();
    if (b && STATE.activeRepo) {
      STATE.activeBranch = b;
      await refreshActiveProjectFullState();
    }
  });

  // Navigation Onglets Sidebar
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#project-sidebar .tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('#project-sidebar .tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(btn.dataset.tab).classList.remove('hidden');
      btn.classList.add('active');
    });
  });

  // Switch Modes Agent
  document.getElementById('mode-btn-exec').addEventListener('click', () => setAgentMode('exec'));
  document.getElementById('mode-btn-audit').addEventListener('click', () => setAgentMode('audit'));

  // Actions Agent, Fichiers & Backups
  document.getElementById('btn-run-exec').addEventListener('click', runFreeExecutionPipeline);
  document.getElementById('btn-run-audit').addEventListener('click', runProjectAudit);
  document.getElementById('file-filter').addEventListener('input', filterFileCheckboxes);
  document.getElementById('btn-uncheck-all').addEventListener('click', uncheckAllFiles);
  document.getElementById('btn-manual-backup').addEventListener('click', createManualBackupTag);
}

function log(msg, cls = 'log-info') {
  const term = document.getElementById('terminal');
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `[${time}] ${msg}`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function setGlobalStatus(text, color = '#1e293b') {
  const badge = document.getElementById('global-status');
  badge.textContent = text;
  badge.style.background = color;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// RENDU 3D ESTHÉTIQUE : CORTEX MULTICOUCHE, AMAS DE MICRO-NEURONES & LABELS PERMANENTS
// ============================================================================

// Création d'un Sprite de texte 2D net qui flotte en permanence au-dessus de l'amas
function createFloatingLabelSprite(text, accentColor) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 110;

  ctx.font = 'bold 34px "JetBrains Mono", monospace';
  const textWidth = ctx.measureText(text).width;
  const boxWidth = Math.min(490, textWidth + 48);
  const startX = (512 - boxWidth) / 2;

  // Fond capsule semi-transparent
  ctx.fillStyle = 'rgba(4, 8, 18, 0.82)';
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(startX, 18, boxWidth, 64, 16);
  ctx.fill();
  ctx.stroke();

  // Texte lumineux
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = 10;
  ctx.fillText(text, 256, 51);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(46, 10, 1);
  return sprite;
}

// Création d'un halo lumineux (Glow Sprite) pour donner l'aspect neurone biologique
function createGlowSprite(hexColor, size) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.25, hexColor);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}

function buildCustomNodeObject(node) {
  // 1. CORTEX CENTRAL : Noyau énergétique multicouche + Anneaux synaptiques
  if (node.nodeType === 'cortex') {
    const group = new THREE.Group();

    // Cœur plasma interne
    const coreGeo = new THREE.IcosahedronGeometry(14, 3);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    group.add(new THREE.Mesh(coreGeo, coreMat));

    // Coque neurale filaire externe
    const shellGeo = new THREE.IcosahedronGeometry(24, 2);
    const shellMat = new THREE.MeshBasicMaterial({
      color: 0xff2a85,
      wireframe: true,
      transparent: true,
      opacity: 0.45
    });
    const shellMesh = new THREE.Mesh(shellGeo, shellMat);
    group.add(shellMesh);

    // Anneaux orbitaux du Cortex
    const ringGeo = new THREE.TorusGeometry(32, 0.35, 12, 90);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.5 });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.rotation.x = Math.PI / 2.4;
    group.add(ring1);

    const ring2 = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x8338ec, transparent: true, opacity: 0.4 }));
    ring2.rotation.y = Math.PI / 3;
    group.add(ring2);

    // Halo géant
    group.add(createGlowSprite('#00f0ff', 95));

    node.__cortexRefs = { shellMesh, ring1, ring2 };
    return group;
  }

  // 2. CŒUR D'AMAS PROJET (Porte le nom flottant visible en permanence + soma central)
  if (node.nodeType === 'clusterHub') {
    const group = new THREE.Group();
    const sphereGeo = new THREE.SphereGeometry(2.6, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: node.color });
    group.add(new THREE.Mesh(sphereGeo, sphereMat));

    // Halo lumineux du soma
    group.add(createGlowSprite(node.color, 18));

    // Étiquette flottante permanente avec le nom du dépôt
    const labelSprite = createFloatingLabelSprite(node.name, node.color);
    labelSprite.position.set(0, 14, 0);
    group.add(labelSprite);

    return group;
  }

  // 3. MICRO-NEURONE SATELLITE (Petits neurones formant l'amas du projet)
  const microGroup = new THREE.Group();
  const microGeo = new THREE.SphereGeometry(1.15, 10, 10);
  const microMat = new THREE.MeshBasicMaterial({ color: node.color });
  microGroup.add(new THREE.Mesh(microGeo, microMat));
  microGroup.add(createGlowSprite(node.color, 8.5));
  return microGroup;
}

function init3DCortexGraph() {
  const container = document.getElementById('3d-graph');

  STATE.graph3D = ForceGraph3D()(container)
    .backgroundColor('rgba(0,0,0,0)')
    .showNavInfo(false)
    .nodeThreeObject(buildCustomNodeObject)
    .nodeLabel(() => '') // Désactive l'infobulle au survol puisque les noms flottent en permanence
    .linkColor(link => link.color || 'rgba(0, 240, 255, 0.2)')
    .linkWidth(link => link.isAxon ? 1.2 : 0.55)
    .linkDirectionalParticles(link => link.isAxon ? 3 : 1)
    .linkDirectionalParticleSpeed(link => link.isAxon ? 0.006 : 0.012)
    .linkDirectionalParticleWidth(link => link.isAxon ? 2.2 : 1.1)
    .linkDirectionalParticleColor(link => link.color || '#00f0ff')
    .onNodeClick(node => {
      if (node.repoData) {
        lockCameraAndOpenProject(node.repoData);
      }
    })
    .graphData({ nodes: [STATE.cortexNode], links: [] });

  // Configuration stricte de la caméra : centrée sur le Cortex sans pouvoir trop s'éloigner ni dériver
  const controls = STATE.graph3D.controls();
  if (controls) {
    controls.enablePan = false;     // Interdit de décentrer avec clic droit
    controls.minDistance = 120;     // Distance minimale
    controls.maxDistance = 420;     // Empêche de trop s'éloigner du réseau
  }

  STATE.graph3D.cameraPosition({ x: 0, y: 75, z: 330 }, { x: 0, y: 0, z: 0 }, 0);

  // Verrouillage mathématique permanent
  STATE.graph3D.onEngineTick(() => {
    STATE.cortexNode.fx = 0;
    STATE.cortexNode.fy = 0;
    STATE.cortexNode.fz = 0;

    const ctrl = STATE.graph3D.controls();
    if (!ctrl) return;

    if (STATE.cameraLockedOnNode) {
      // Verrouillé sur l'amas du projet sélectionné
      ctrl.target.set(
        STATE.cameraLockedOnNode.fx,
        STATE.cameraLockedOnNode.fy,
        STATE.cameraLockedOnNode.fz
      );
      ctrl.enabled = false;
    } else {
      // Verrouillé sur le Cortex (0,0,0)
      ctrl.target.set(0, 0, 0);
      ctrl.enabled = true;
    }
  });
}

// Création des amas de micro-neurones (8 petits neurones interconnectés par projet)
function buildSynapticClusters(repos) {
  const nodes = [STATE.cortexNode];
  const links = [];
  STATE.clusterMap.clear();

  const N = repos.length;
  const R = STATE.orbitRadius;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const MICRO_COUNT = 8; // Nombre de petits neurones par amas de projet

  repos.forEach((repo, i) => {
    const y = N > 1 ? 1 - (i / (N - 1)) * 2 : 0;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;

    const cx = Math.cos(theta) * radiusAtY * R;
    const cz = Math.sin(theta) * radiusAtY * R;
    const cy = y * R;

    const color = getProjectColor(repo, i);

    // Nœud directeur de l'amas (porte le nom flottant)
    const hubId = `hub::${repo.full_name}`;
    const hubNode = {
      id: hubId,
      name: repo.name,
      nodeType: 'clusterHub',
      color,
      repoData: repo,
      baseX: cx,
      baseY: cy,
      baseZ: cz,
      fx: cx,
      fy: cy,
      fz: cz
    };
    nodes.push(hubNode);

    // Axone principal reliant le Cortex à l'amas
    links.push({
      source: 'CORTEX_CORE',
      target: hubId,
      color: color,
      isAxon: true
    });

    // Essaim de petits neurones autour du cœur de l'amas
    const microNodes = [];
    for (let m = 0; m < MICRO_COUNT; m++) {
      const phi = Math.acos(1 - 2 * (m + 0.5) / MICRO_COUNT);
      const subTheta = goldenAngle * m * 4;
      const spread = 11 + (m % 3) * 4;

      const ox = Math.sin(phi) * Math.cos(subTheta) * spread;
      const oy = Math.cos(phi) * spread;
      const oz = Math.sin(phi) * Math.sin(subTheta) * spread;

      const microId = `micro::${repo.full_name}::${m}`;
      const microNode = {
        id: microId,
        name: repo.name,
        nodeType: 'microNeuron',
        color,
        repoData: repo,
        offsetX: ox,
        offsetY: oy,
        offsetZ: oz,
        phase: m * 0.9,
        fx: cx + ox,
        fy: cy + oy,
        fz: cz + oz
      };

      nodes.push(microNode);
      microNodes.push(microNode);

      // Synapses internes à l'amas
      links.push({
        source: hubId,
        target: microId,
        color: color,
        isAxon: false
      });

      if (m > 0) {
        links.push({
          source: `micro::${repo.full_name}::${m - 1}`,
          target: microId,
          color: color,
          isAxon: false
        });
      }
    }

    // Fermer la boucle synaptique de l'amas
    links.push({
      source: `micro::${repo.full_name}::${MICRO_COUNT - 1}`,
      target: `micro::${repo.full_name}::0`,
      color: color,
      isAxon: false
    });

    STATE.clusterMap.set(repo.full_name, { hubNode, microNodes, color });
  });

  STATE.graph3D.graphData({ nodes, links });
}

// Animation continue : rotation du Cortex, orbite des amas et pulsation organique des micro-neurones
function startOrbitalAnimation() {
  let pulseTick = 0;

  function animate() {
    requestAnimationFrame(animate);
    if (!STATE.graph3D) return;

    pulseTick += 0.03;

    // Rotation des anneaux du Cortex central
    const cortexRefs = STATE.cortexNode.__cortexRefs;
    if (cortexRefs) {
      cortexRefs.shellMesh.rotation.y += 0.005;
      cortexRefs.shellMesh.rotation.x += 0.003;
      cortexRefs.ring1.rotation.z -= 0.008;
      cortexRefs.ring2.rotation.x += 0.007;
    }

    // Si aucun projet n'est verrouillé et que l'orbite est active, faire tourner les amas autour du Cortex
    const orbitEnabled = document.getElementById('orbit-toggle')?.checked;
    if (orbitEnabled && !STATE.cameraLockedOnNode) {
      STATE.orbitAngle += 0.0014;
    }

    const cosA = Math.cos(STATE.orbitAngle);
    const sinA = Math.sin(STATE.orbitAngle);

    STATE.clusterMap.forEach(({ hubNode, microNodes }) => {
      const hx = hubNode.baseX * cosA - hubNode.baseZ * sinA;
      const hz = hubNode.baseX * sinA + hubNode.baseZ * cosA;
      const hy = hubNode.baseY;

      hubNode.fx = hx; hubNode.fy = hy; hubNode.fz = hz;
      hubNode.x = hx;  hubNode.y = hy;  hubNode.z = hz;

      // Légère respiration synaptique des petits neurones autour de leur amas
      microNodes.forEach(m => {
        const breathe = 1 + Math.sin(pulseTick + m.phase) * 0.14;
        const mx = hx + m.offsetX * breathe;
        const my = hy + m.offsetY * breathe;
        const mz = hz + m.offsetZ * breathe;
        m.fx = mx; m.fy = my; m.fz = mz;
        m.x = mx;  m.y = my;  m.z = mz;
      });
    });

    const controls = STATE.graph3D.controls();
    if (controls) {
      if (STATE.cameraLockedOnNode) {
        controls.target.set(
          STATE.cameraLockedOnNode.fx,
          STATE.cameraLockedOnNode.fy,
          STATE.cameraLockedOnNode.fz
        );
        controls.enabled = false;
      } else {
        controls.target.set(0, 0, 0);
        controls.enabled = true;
      }
    }

    STATE.graph3D.refresh();
  }
  requestAnimationFrame(animate);
}

// ============================================================================
// FOCUS VERROUILLÉ SUR UN AMAS PROJET & RETOUR PAR ÉCHAP
// ============================================================================
async function lockCameraAndOpenProject(repo) {
  const cluster = STATE.clusterMap.get(repo.full_name);
  if (!cluster) return;

  const { hubNode, color } = cluster;
  STATE.cameraLockedOnNode = hubNode;

  // Calcul d'une position de caméra face à l'amas (à 55 unités vers l'extérieur)
  const dist = Math.hypot(hubNode.fx, hubNode.fy, hubNode.fz) || 1;
  const camRatio = (dist + 58) / dist;
  const camPos = {
    x: hubNode.fx * camRatio,
    y: hubNode.fy * camRatio + 8,
    z: hubNode.fz * camRatio
  };

  // Désactivation immédiate des mouvements souris et zoom sur l'amas
  const controls = STATE.graph3D.controls();
  if (controls) controls.enabled = false;

  STATE.graph3D.cameraPosition(
    camPos,
    { x: hubNode.fx, y: hubNode.fy, z: hubNode.fz },
    850
  );

  document.getElementById('camera-lock-hint').classList.remove('hidden');

  // Ouverture du panneau latéral du projet
  STATE.activeRepo = repo;
  STATE.activeBranch = repo.default_branch || 'main';

  const sidebar = document.getElementById('project-sidebar');
  sidebar.classList.remove('hidden');

  const dot = document.getElementById('proj-lang-dot');
  dot.style.background = color;
  dot.style.boxShadow = `0 0 10px ${color}`;

  document.getElementById('proj-title').textContent = repo.name;
  document.getElementById('proj-meta').textContent = `${repo.full_name} • ★ ${repo.stargazers_count} • ${repo.language || 'Code'}`;
  document.getElementById('proj-desc').textContent = repo.description || 'Aucune description renseignée sur GitHub.';
  document.getElementById('proj-branch-input').value = STATE.activeBranch;

  await refreshActiveProjectFullState();
}

function unlockAndReturnToCortex() {
  STATE.cameraLockedOnNode = null;
  STATE.activeRepo = null;

  document.getElementById('project-sidebar').classList.add('hidden');
  document.getElementById('camera-lock-hint').classList.add('hidden');

  const controls = STATE.graph3D.controls();
  if (controls) {
    controls.enabled = true;
    controls.target.set(0, 0, 0);
  }

  // Retour fluide automatique centré sur le Cortex (0,0,0)
  STATE.graph3D.cameraPosition(
    { x: 0, y: 75, z: 330 },
    { x: 0, y: 0, z: 0 },
    850
  );

  log('Caméra déverrouillée et recentrée sur CORTEX_CORE (0,0,0).', 'log-info');
}

// ============================================================================
// CLIENT GITHUB API & SYNCHRONISATION DES PROJETS
// ============================================================================
async function ghFetch(endpoint, options = {}) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    cache: 'no-store',
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
  try {
    setGlobalStatus('SYNCHRONISATION...', '#f59e0b');
    log('Connexion automatique à GitHub API...', 'log-step');
    const repos = await ghFetch('/user/repos?per_page=100&sort=updated');
    STATE.repos = repos;
    buildSynapticClusters(repos);
    setGlobalStatus(`${repos.length} AMAS ACTIFS`, '#10b981');
    log(`${repos.length} amas de neurones générés autour du Cortex.`, 'log-ok');
  } catch (err) {
    setGlobalStatus('ERREUR CLÉ', '#ef4444');
    log(`Échec d'authentification GitHub : ${err.message}`, 'log-err');
    document.getElementById('auth-overlay').classList.remove('hidden');
  }
}

async function refreshActiveProjectFullState() {
  if (!STATE.activeRepo) return;
  const fullName = STATE.activeRepo.full_name;
  const branch = STATE.activeBranch;

  log(`Lecture de l'état de ${fullName} (${branch})...`, 'log-step');

  try {
    const refData = await ghFetch(`/repos/${fullName}/git/ref/heads/${branch}`);
    const headSha = refData.object.sha;
    const commitData = await ghFetch(`/repos/${fullName}/git/commits/${headSha}`);
    document.getElementById('proj-last-commit').textContent = `${headSha.slice(0, 7)} — ${commitData.message.split('\n')[0]}`;

    const treeData = await ghFetch(`/repos/${fullName}/git/trees/${commitData.tree.sha}?recursive=1`);
    STATE.treeFiles = (treeData.tree || []).filter(item => item.type === 'blob');
    renderFileChecklist(STATE.treeFiles);

    const runsData = await ghFetch(`/repos/${fullName}/actions/runs?per_page=1&branch=${branch}`);
    const ciBadge = document.getElementById('proj-ci-badge');
    if (runsData.total_count > 0) {
      const latestRun = runsData.workflow_runs[0];
      const statusText = latestRun.status === 'completed' ? (latestRun.conclusion || 'DONE').toUpperCase() : latestRun.status.toUpperCase();
      ciBadge.textContent = `${statusText} (${latestRun.name})`;
      ciBadge.style.color = latestRun.conclusion === 'success' ? '#10b981' : (latestRun.conclusion === 'failure' ? '#ef4444' : '#f59e0b');
    } else {
      ciBadge.textContent = 'Aucun Workflow';
      ciBadge.style.color = '#94a3b8';
    }

    await loadProjectBackups();
    log(`État synchronisé : ${STATE.treeFiles.length} fichiers, ${STATE.backups.length} backups.`, 'log-ok');
  } catch (err) {
    log(`Erreur synchronisation projet : ${err.message}`, 'log-err');
  }
}

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
    item.style.display = item.dataset.path.toLowerCase().includes(q) ? 'flex' : 'none';
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
// BACKUPS GITHUB (TAGS backup-pre-agent-*) & RESTAURATION EN 1 CLIC
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
    container.innerHTML = '<div style="color:#64748b;font-size:11px;">Aucun backup enregistré pour ce projet.</div>';
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
    btn.addEventListener('click', () => restoreBackupTag(b.name, b.sha));

    card.appendChild(info);
    card.appendChild(btn);
    container.appendChild(card);
  });
}

async function createBackupTagOnGitHub(suffix = 'auto') {
  const fullName = STATE.activeRepo.full_name;
  const branch = STATE.activeBranch;
  const refData = await ghFetch(`/repos/${fullName}/git/ref/heads/${branch}`);
  const currentSha = refData.object.sha;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tagName = `backup-pre-agent-${stamp}-${suffix}`;

  await ghFetch(`/repos/${fullName}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/tags/${tagName}`,
      sha: currentSha
    })
  });

  log(`Tag de sauvegarde créé : ${tagName}`, 'log-ok');
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
    log(`Restauration de ${branch} vers ${tagName} (${targetSha.slice(0, 7)})...`, 'log-warn');
    await ghFetch(`/repos/${fullName}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: targetSha,
        force: true
      })
    });
    log(`Branche ${branch} restaurée sur ${tagName} !`, 'log-ok');
    await refreshActiveProjectFullState();
  } catch (err) {
    log(`Échec restauration : ${err.message}`, 'log-err');
  }
}

// ============================================================================
// CLIENT GEMINI API (responseMimeType: "text/plain" — ZÉRO JSON)
// ============================================================================
function setAgentMode(mode) {
  document.getElementById('mode-btn-exec').classList.toggle('active', mode === 'exec');
  document.getElementById('mode-btn-audit').classList.toggle('active', mode === 'audit');
  document.getElementById('view-mode-exec').classList.toggle('hidden', mode !== 'exec');
  document.getElementById('view-mode-audit').classList.toggle('hidden', mode !== 'audit');
}

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
    throw new Error(`Gemini (${model}) ${res.status}: ${errText}`);
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
// 2. ROUTING AGENT : autoSelectFilesWithFlash()
// ============================================================================
async function autoSelectFilesWithFlash(userPrompt, ciErrorLog = '') {
  const manuallyChecked = getCheckedFilePaths();
  if (manuallyChecked.length > 0 && !ciErrorLog) {
    log(`Utilisation des ${manuallyChecked.length} fichier(s) coché(s) manuellement.`, 'log-info');
    return manuallyChecked;
  }

  log('Routing Agent : Sélection des fichiers pertinents via gemini-2.5-flash...', 'log-step');
  const treePaths = STATE.treeFiles.map(f => f.path).join('\n');

  const sysInstruction = `Tu es un agent de routage de fichiers.
Analyse l'arborescence complète du dépôt GitHub et la demande utilisateur.
Identifie jusqu'à 8 fichiers pertinents à lire ou modifier.
Renvoie UNIQUEMENT des balises XML <path>chemin/du/fichier</path> en texte brut. Aucun JSON.`;

  const prompt = `ARBORESCENCE (${STATE.activeRepo.full_name}) :
${treePaths}

DEMANDE :
${userPrompt}
${ciErrorLog ? `\nTRACEBACK CI/CD À CORRIGER :\n${ciErrorLog}` : ''}`;

  const rawText = await callGeminiTextPlain('gemini-2.5-flash', sysInstruction, prompt, 0.0);
  const matches = [...rawText.matchAll(/<path>\s*([\s\S]*?)\s*<\/path>/g)];
  const selectedPaths = matches
    .map(m => m[1].trim())
    .filter(p => STATE.treeFiles.some(f => f.path === p))
    .slice(0, 8);

  uncheckAllFiles();
  document.querySelectorAll('.file-checkbox').forEach(cb => {
    if (selectedPaths.includes(cb.value)) {
      cb.checked = true;
      cb.parentElement.classList.add('auto-selected');
    }
  });

  log(`Flash a sélectionné ${selectedPaths.length} fichier(s) : ${selectedPaths.join(', ')}`, 'log-ok');
  return selectedPaths;
}

// ============================================================================
// CHOIX 1 : AUDIT DE L'ÉTAT DU PROJET & PROPOSITIONS D'AMÉLIORATIONS
// ============================================================================
async function runProjectAudit() {
  if (!STATE.activeRepo) return;
  const btn = document.getElementById('btn-run-audit');
  const output = document.getElementById('audit-output');
  btn.disabled = true;
  output.textContent = 'Sélection des fichiers clés par gemini-2.5-flash...';

  try {
    const keyPaths = await autoSelectFilesWithFlash(
      'Sélectionner les fichiers d\'architecture, README, configuration et modules principaux pour un audit complet.'
    );

    let contextBlock = '';
    for (const p of keyPaths) {
      const content = await fetchGitHubFileContent(STATE.activeRepo.full_name, p, STATE.activeBranch);
      contextBlock += `\n--- FICHIER: ${p} ---\n${content.slice(0, 6000)}\n`;
    }

    output.textContent = 'Génération du diagnostic et des propositions par gemini-2.5-pro...';
    const sysInstruction = `Tu es un Architecte Logiciel Principal.
Analyse l'état actuel du projet et propose des évolutions concrètes :
1. Synthèse de l'état actuel et de l'architecture.
2. Points faibles, bugs potentiels ou dettes techniques.
3. Propositions d'améliorations et d'évolutions concrètes (fichiers impactés et bénéfices).`;

    const report = await callGeminiTextPlain(
      'gemini-2.5-pro',
      sysInstruction,
      `PROJET : ${STATE.activeRepo.full_name}\nARBORESCENCE :\n${STATE.treeFiles.map(f => f.path).join('\n')}\n\nEXTRAITS :\n${contextBlock}`,
      0.2
    );

    output.textContent = report;
    log(`Audit terminé pour ${STATE.activeRepo.full_name}.`, 'log-ok');
  } catch (err) {
    output.textContent = `Erreur : ${err.message}`;
    log(`Erreur audit : ${err.message}`, 'log-err');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// 1. PROTOCOLE XML / CDATA BRUT (ZÉRO JSON POUR LE CODE)
// ============================================================================
async function executeCodeGenerationWithPro(userPrompt, filesContentMap, ciFailureLog = '') {
  log('Programmation via gemini-2.5-pro (Flux XML / CDATA brut)...', 'log-step');

  let filesSection = '';
  for (const [path, content] of Object.entries(filesContentMap)) {
    filesSection += `\n<source_file path="${path}">\n<![CDATA[\n${content}\n]]>\n</source_file>\n`;
  }

  const sysInstruction = `Tu es un ingénieur logiciel autonome.
N'utilise JAMAIS de JSON. Réponds uniquement en texte brut avec les balises XML/CDATA suivantes :

<commit_msg><![CDATA[Message de commit précis]]></commit_msg>

Pour créer ou remplacer intégralement un fichier (écris 100 % du code sans jamais tronquer) :
<file path="chemin/du/fichier.ext"><![CDATA[
code complet ici
]]></file>

Ou pour modifier chirurgicalement un fichier existant :
<patch path="chemin/du/fichier.ext"><![CDATA[
<<<<<<< SEARCH
code exact actuel
=======
nouveau code
>>>>>>> REPLACE
]]></patch>`;

  const fullPrompt = `DÉPÔT : ${STATE.activeRepo.full_name} (Branche : ${STATE.activeBranch})
ARBORESCENCE :
${STATE.treeFiles.map(f => f.path).join('\n')}

CONTENU FRAIS DES FICHIERS SÉLECTIONNÉS :
${filesSection}

DEMANDE UTILISATEUR :
${userPrompt}
${ciFailureLog ? `\nTRACEBACK D'ERREUR CI/CD À CORRIGER IMPÉRATIVEMENT :\n${ciFailureLog}` : ''}`;

  return await callGeminiTextPlain('gemini-2.5-pro', sysInstruction, fullPrompt, 0.1);
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

  const modifiedFiles = {};

  const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
  for (const match of rawXmlResponse.matchAll(fileRegex)) {
    const filePath = match[1].trim();
    modifiedFiles[filePath] = extractCdataContent(match[2]);
  }

  const patchRegex = /<patch\s+path="([^"]+)">([\s\S]*?)<\/patch>/g;
  for (const match of rawXmlResponse.matchAll(patchRegex)) {
    const filePath = match[1].trim();
    const patchBody = extractCdataContent(match[2]);
    let baseContent = modifiedFiles[filePath] ?? currentFilesMap[filePath];

    if (baseContent === undefined) {
      throw new Error(`Le fichier ${filePath} ciblé par <patch> n'est pas chargé.`);
    }

    const srRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
    let count = 0;
    for (const sr of patchBody.matchAll(srRegex)) {
      if (!baseContent.includes(sr[1])) {
        throw new Error(`Bloc SEARCH introuvable dans ${filePath}.`);
      }
      baseContent = baseContent.replace(sr[1], sr[2]);
      count++;
    }
    if (count === 0) {
      throw new Error(`Aucun bloc SEARCH/REPLACE valide dans <patch path="${filePath}">.`);
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
    throw new Error('Aucune balise <file> ou <patch> détectée dans la réponse.');
  }

  log(`Commit Atomique : Envoi de ${filePaths.length} blob(s) via Git Data API...`, 'log-step');

  const refData = await ghFetch(`/repos/${fullName}/git/ref/heads/${branch}`);
  const parentCommitSha = refData.object.sha;
  const parentCommit = await ghFetch(`/repos/${fullName}/git/commits/${parentCommitSha}`);
  const baseTreeSha = parentCommit.tree.sha;

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

  const newTree = await ghFetch(`/repos/${fullName}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries
    })
  });

  const newCommit = await ghFetch(`/repos/${fullName}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: commitMsg,
      tree: newTree.sha,
      parents: [parentCommitSha]
    })
  });

  await ghFetch(`/repos/${fullName}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });

  log(`Commit Atomique poussé : ${newCommit.sha.slice(0, 7)} — "${commitMsg}"`, 'log-ok');
  return newCommit.sha;
}

// ============================================================================
// 4. BOUCLE AUTO-HEAL CI/CD : waitForCIRunAndGetFailureLog() & extractFailedJobTrace()
// ============================================================================
async function waitForCIRunAndGetFailureLog(fullName, commitSha) {
  log(`Surveillance GitHub Actions (toutes les 4s) pour ${commitSha.slice(0, 7)}...`, 'log-step');

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
    log('Aucun workflow GitHub Actions configuré sur ce commit.', 'log-ok');
    return { passed: true, trace: '' };
  }

  log(`Workflow "${targetRun.name}" en cours (Run #${targetRun.id})...`, 'log-info');

  for (let poll = 0; poll < 120; poll++) {
    const runStatus = await ghFetch(`/repos/${fullName}/actions/runs/${targetRun.id}`);
    if (runStatus.status === 'completed') {
      if (runStatus.conclusion === 'success') {
        log(`Tests CI/CD validés avec succès (${runStatus.name}) !`, 'log-ok');
        return { passed: true, trace: '' };
      } else {
        log(`Échec CI/CD (${runStatus.conclusion}). Extraction des 4 500 derniers caractères...`, 'log-err');
        const trace = await extractFailedJobTrace(fullName, targetRun.id);
        return { passed: false, trace };
      }
    }
    await sleep(4000);
  }

  throw new Error('Timeout lors de la surveillance GitHub Actions.');
}

async function extractFailedJobTrace(fullName, runId) {
  const jobsData = await ghFetch(`/repos/${fullName}/actions/runs/${runId}/jobs`);
  const failedJobs = (jobsData.jobs || []).filter(j => j.conclusion === 'failure');
  let combinedTrace = '';

  for (const job of failedJobs) {
    const failedSteps = (job.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name);
    combinedTrace += `=== JOB ÉCHOUÉ: ${job.name} (Steps: ${failedSteps.join(', ')}) ===\n`;

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

    try {
      const annotations = await ghFetch(`/repos/${fullName}/check-runs/${job.id}/annotations`);
      if (annotations && annotations.length > 0) {
        annotations.forEach(a => {
          combinedTrace += `[${a.annotation_level}] ${a.path} (L.${a.start_line}): ${a.message}\n${a.raw_details || ''}\n`;
        });
      }
    } catch (_) {}
  }

  return combinedTrace.slice(-4500) || 'Échec GitHub Actions sans trace texte détaillée.';
}

// ============================================================================
// PIPELINE D'EXÉCUTION AUTONOME COMPLET
// ============================================================================
async function runFreeExecutionPipeline() {
  if (!STATE.activeRepo) return;
  const userPrompt = document.getElementById('custom-prompt').value.trim();
  if (!userPrompt) {
    return log('Écris une demande dans le champ de prompt avant de lancer.', 'log-warn');
  }

  const fullName = STATE.activeRepo.full_name;
  const branch = STATE.activeBranch;
  const autoHealEnabled = document.getElementById('auto-heal-toggle').checked;
  const maxCycles = autoHealEnabled ? 3 : 1;

  const btn = document.getElementById('btn-run-exec');
  btn.disabled = true;

  try {
    // 1. Sauvegarde automatique par tag GitHub avant modification
    await createBackupTagOnGitHub('pre-run');

    let cycle = 1;
    let ciFailureLog = '';

    while (cycle <= maxCycles) {
      log(`=== CYCLE AUTONOME #${cycle}/${maxCycles} SUR ${fullName} ===`, 'log-step');

      // 2. Tri des fichiers pertinents par gemini-2.5-flash
      const targetPaths = await autoSelectFilesWithFlash(userPrompt, ciFailureLog);

      // 3. Téléchargement frais des fichiers
      const filesContentMap = {};
      for (const path of targetPaths) {
        log(`Lecture fraîche : ${path}...`, 'log-info');
        filesContentMap[path] = await fetchGitHubFileContent(fullName, path, branch);
      }

      // 4. Génération XML/CDATA par gemini-2.5-pro
      const rawXml = await executeCodeGenerationWithPro(userPrompt, filesContentMap, ciFailureLog);
      const { commitMsg, modifiedFiles } = parseXmlCdataOperations(rawXml, filesContentMap);

      // 5. Commit Atomique Multi-Fichiers
      const newCommitSha = await pushAtomicCommit(fullName, branch, commitMsg, modifiedFiles);
      await refreshActiveProjectFullState();

      if (!autoHealEnabled) {
        log('Modifications appliquées avec succès (Auto-Heal désactivé).', 'log-ok');
        break;
      }

      // 6. Surveillance CI/CD & Boucle Auto-Heal
      const ciCheck = await waitForCIRunAndGetFailureLog(fullName, newCommitSha);
      await refreshActiveProjectFullState();

      if (ciCheck.passed) {
        log(`Pipeline validé au cycle #${cycle} : CI/CD au vert !`, 'log-ok');
        break;
      } else {
        ciFailureLog = ciCheck.trace;
        log(`Traceback récupérée (${ciFailureLog.length} car.) :\n${ciFailureLog.slice(-600)}`, 'log-warn');
        uncheckAllFiles();
        cycle++;
        if (cycle > maxCycles) {
          log(`Limite de ${maxCycles} cycles Auto-Heal atteinte. Tu peux restaurer le backup depuis l'onglet Backups.`, 'log-err');
        }
      }
    }
  } catch (err) {
    log(`Erreur pipeline : ${err.message}`, 'log-err');
  } finally {
    btn.disabled = false;
  }
}
