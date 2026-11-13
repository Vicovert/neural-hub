/* ============================================================================
 * NEURAL DEV HUB V6.0 — FUSION ULTIME (AMAS SYNAPTIQUES 3D + MOTEUR XML/CDATA)
 * ============================================================================ */

window.__NDH_BOOTED__ = true;

// Palette bio-luminescente par langage
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

// État global unifié
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
  cameraLockedOnNode: null,
  abortController: null,
  cortexNode: {
    id: 'CORTEX_CORE',
    name: 'CORTEX CENTRAL',
    nodeType: 'cortex',
    fx: 0,
    fy: 0,
    fz: 0
  },
  clusterMap: new Map() // repo.full_name -> { hubNode, microNodes, color }
};

// ============================================================================
// DÉTECTION MULTI-CLÉS & CONNEXION AUTOMATIQUE (PC PRINCIPAL vs OCCASIONNEL)
// ============================================================================
function detectStoredCredentials() {
  const sessionGh = (sessionStorage.getItem('ndh_gh_token') || '').trim();
  const sessionGem = (sessionStorage.getItem('ndh_gemini_key') || '').trim();
  if (sessionGh && sessionGem) {
    return { ghToken: sessionGh, geminiKey: sessionGem, mode: 'session' };
  }

  const localGh = (
    localStorage.getItem('ndh_gh_token') ||
    localStorage.getItem('gh_token') ||
    localStorage.getItem('github_token') ||
    localStorage.getItem('GITHUB_TOKEN') ||
    ''
  ).trim();

  const localGem = (
    localStorage.getItem('ndh_gemini_key') ||
    localStorage.getItem('gemini_key') ||
    localStorage.getItem('gemini_api_key') ||
    localStorage.getItem('GEMINI_API_KEY') ||
    ''
  ).trim();

  if (localGh && localGem) {
    return { ghToken: localGh, geminiKey: localGem, mode: 'local' };
  }

  return { ghToken: '', geminiKey: '', mode: 'none' };
}

function bootHub() {
  bindUIEvents();
  init3DCortexGraph();
  startOrbitalAnimation();

  const creds = detectStoredCredentials();
  if (creds.ghToken && creds.geminiKey) {
    STATE.ghToken = creds.ghToken;
    STATE.geminiKey = creds.geminiKey;
    STATE.storageMode = creds.mode;
    updatePersistenceBadge();
    connectAndBuildCortex();
  } else {
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
    pill.textContent = '🔒 PC PRINCIPAL (Permanent)';
  } else if (STATE.storageMode === 'session') {
    pill.textContent = '⏳ PC OCCASIONNEL (Session)';
  } else {
    pill.textContent = 'NON CONNECTÉ';
  }
}

function bindUIEvents() {
  // Choix Radio PC Principal / PC Occasionnel
  document.querySelectorAll('input[name="device-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      document.getElementById('opt-main-pc').classList.toggle('selected', e.target.value === 'local');
      document.getElementById('opt-temp-pc').classList.toggle('selected', e.target.value === 'session');
    });
  });

  // Validation des clés API
  document.getElementById('btn-auth-submit').addEventListener('click', () => {
    const gh = document.getElementById('gh-token-input').value.trim();
    const gem = document.getElementById('gemini-key-input').value.trim();
    const mode = document.querySelector('input[name="device-mode"]:checked').value;

    if (!gh || !gem) {
      return log('Erreur : Le Token GitHub et la clé Gemini sont tous deux requis.', 'log-err');
    }

    clearAllStoredKeys();

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

  // Ouverture manuelle de la configuration des clés
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    document.getElementById('gh-token-input').value = STATE.ghToken;
    document.getElementById('gemini-key-input').value = STATE.geminiKey;
    document.getElementById('btn-auth-cancel').classList.remove('hidden');
    document.getElementById('auth-overlay').classList.remove('hidden');
  });

  document.getElementById('btn-auth-cancel').addEventListener('click', () => {
    document.getElementById('auth-overlay').classList.add('hidden');
  });

  // Déconnexion complète
  document.getElementById('btn-logout').addEventListener('click', () => {
    clearAllStoredKeys();
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

  // Navigation par onglets dans le panneau projet
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#project-sidebar .tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('#project-sidebar .tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(btn.dataset.tab).classList.remove('hidden');
      btn.classList.add('active');
    });
  });

  // Bascule entre Demande Libre et Audit
  document.getElementById('mode-btn-exec').addEventListener('click', () => setAgentMode('exec'));
  document.getElementById('mode-btn-audit').addEventListener('click', () => setAgentMode('audit'));

  // Actions principales
  document.getElementById('btn-run-exec').addEventListener('click', runFreeExecutionPipeline);
  document.getElementById('btn-stop-agent').addEventListener('click', () => {
    if (STATE.abortController) {
      STATE.abortController.abort();
      log('Arrêt du cycle demandé par l\'utilisateur.', 'log-warn');
      setStepStatus('Interrompu');
    }
  });
  document.getElementById('btn-run-audit').addEventListener('click', runProjectAudit);
  document.getElementById('file-filter').addEventListener('input', filterFileCheckboxes);
  document.getElementById('btn-uncheck-all').addEventListener('click', uncheckAllFiles);
  document.getElementById('btn-refresh-tree').addEventListener('click', () => {
    if (STATE.activeRepo) refreshActiveProjectFullState();
  });
  document.getElementById('btn-manual-backup').addEventListener('click', createManualBackupTag);
}

function clearAllStoredKeys() {
  ['ndh_gh_token', 'gh_token', 'github_token', 'GITHUB_TOKEN', 'ndh_gemini_key', 'gemini_key', 'gemini_api_key', 'GEMINI_API_KEY'].forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
}

function log(msg, cls = 'log-info') {
  const term = document.getElementById('terminal');
  if (!term) return;
  const time = new Date().toLocaleTimeString('fr-FR', { hour12: false });
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `[${time}] ${msg}`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function setStepStatus(text) {
  const pill = document.getElementById('agent-step-indicator');
  if (pill) pill.textContent = text;
}

function setGlobalStatus(text, color = '#1e293b') {
  const badge = document.getElementById('global-status');
  if (badge) {
    badge.textContent = text;
    badge.style.background = color;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// RENDU 3D BIO-LUMINESCENT : CORTEX MULTICOUCHE, AMAS DE MICRO-NEURONES & LABELS
// ============================================================================
function createFloatingLabelSprite(text, accentColor) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 110;

  ctx.font = 'bold 34px "JetBrains Mono", monospace';
  const textWidth = ctx.measureText(text).width;
  const boxWidth = Math.min(490, textWidth + 48);
  const startX = (512 - boxWidth) / 2;

  ctx.fillStyle = 'rgba(4, 8, 18, 0.84)';
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(startX, 18, boxWidth, 64, 16);
  ctx.fill();
  ctx.stroke();

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

    const coreGeo = new THREE.IcosahedronGeometry(14, 3);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00a8ff,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.8
    });
    group.add(new THREE.Mesh(coreGeo, coreMat));

    const shellGeo = new THREE.IcosahedronGeometry(24, 2);
    const shellMat = new THREE.MeshBasicMaterial({
      color: 0xff2a85,
      wireframe: true,
      transparent: true,
      opacity: 0.48
    });
    const shellMesh = new THREE.Mesh(shellGeo, shellMat);
    group.add(shellMesh);

    const ringGeo = new THREE.TorusGeometry(32, 0.4, 12, 90);
    const ring1 = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.55 }));
    ring1.rotation.x = Math.PI / 2.4;
    group.add(ring1);

    const ring2 = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x8338ec, transparent: true, opacity: 0.45 }));
    ring2.rotation.y = Math.PI / 3;
    group.add(ring2);

    group.add(createGlowSprite('#00f0ff', 95));

    node.__cortexRefs = { shellMesh, ring1, ring2 };
    return group;
  }

  // 2. CŒUR D'AMAS PROJET (Soma central + Nom flottant permanent)
  if (node.nodeType === 'clusterHub') {
    const group = new THREE.Group();
    const sphereGeo = new THREE.SphereGeometry(2.8, 18, 18);
    const sphereMat = new THREE.MeshBasicMaterial({ color: node.color });
    group.add(new THREE.Mesh(sphereGeo, sphereMat));

    group.add(createGlowSprite(node.color, 19));

    const labelSprite = createFloatingLabelSprite(node.name, node.color);
    labelSprite.position.set(0, 14, 0);
    group.add(labelSprite);

    return group;
  }

  // 3. MICRO-NEURONE SATELLITE (Petits neurones de l'amas)
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
    .nodeLabel(() => '')
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

  // Éclairage Three.js pour sublimer le noyau Cortex
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  const dirLight = new THREE.DirectionalLight(0x00f0ff, 1.3);
  dirLight.position.set(120, 180, 140);
  STATE.graph3D.scene().add(ambientLight, dirLight);

  // Bridage strict de la caméra autour du Cortex (impossible de décentrer ou de partir trop loin)
  const controls = STATE.graph3D.controls();
  if (controls) {
    controls.enablePan = false;
    controls.minDistance = 120;
    controls.maxDistance = 420;
  }

  STATE.graph3D.cameraPosition({ x: 0, y: 75, z: 330 }, { x: 0, y: 0, z: 0 }, 0);

  STATE.graph3D.onEngineTick(() => {
    STATE.cortexNode.fx = 0;
    STATE.cortexNode.fy = 0;
    STATE.cortexNode.fz = 0;

    const ctrl = STATE.graph3D.controls();
    if (!ctrl) return;

    if (STATE.cameraLockedOnNode) {
      ctrl.target.set(
        STATE.cameraLockedOnNode.fx,
        STATE.cameraLockedOnNode.fy,
        STATE.cameraLockedOnNode.fz
      );
      ctrl.enabled = false;
    } else {
      ctrl.target.set(0, 0, 0);
      ctrl.enabled = true;
    }
  });

  window.addEventListener('resize', () => {
    STATE.graph3D.width(window.innerWidth);
    STATE.graph3D.height(window.innerHeight);
  });
}

function buildSynapticClusters(repos) {
  const nodes = [STATE.cortexNode];
  const links = [];
  STATE.clusterMap.clear();

  const N = repos.length;
  const R = STATE.orbitRadius;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const MICRO_COUNT = 8;

  repos.forEach((repo, i) => {
    const y = N > 1 ? 1 - (i / (N - 1)) * 2 : 0;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;

    const cx = Math.cos(theta) * radiusAtY * R;
    const cz = Math.sin(theta) * radiusAtY * R;
    const cy = y * R;

    const color = getProjectColor(repo, i);

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

    links.push({
      source: 'CORTEX_CORE',
      target: hubId,
      color,
      isAxon: true
    });

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

      links.push({
        source: hubId,
        target: microId,
        color,
        isAxon: false
      });

      if (m > 0) {
        links.push({
          source: `micro::${repo.full_name}::${m - 1}`,
          target: microId,
          color,
          isAxon: false
        });
      }
    }

    links.push({
      source: `micro::${repo.full_name}::${MICRO_COUNT - 1}`,
      target: `micro::${repo.full_name}::0`,
      color,
      isAxon: false
    });

    STATE.clusterMap.set(repo.full_name, { hubNode, microNodes, color });
  });

  STATE.graph3D.graphData({ nodes, links });
}

function startOrbitalAnimation() {
  let pulseTick = 0;

  function animate() {
    requestAnimationFrame(animate);
    if (!STATE.graph3D) return;

    pulseTick += 0.03;

    const cortexRefs = STATE.cortexNode.__cortexRefs;
    if (cortexRefs) {
      cortexRefs.shellMesh.rotation.y += 0.005;
      cortexRefs.shellMesh.rotation.x += 0.003;
      cortexRefs.ring1.rotation.z -= 0.008;
      cortexRefs.ring2.rotation.x += 0.007;
    }

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
// FOCUS CAMÉRA VERROUILLÉ SUR L'AMAS PROJET & RETOUR PAR ÉCHAP
// ============================================================================
async function lockCameraAndOpenProject(repo) {
  const cluster = STATE.clusterMap.get(repo.full_name);
  if (!cluster) return;

  const { hubNode, color } = cluster;
  STATE.cameraLockedOnNode = hubNode;

  const dist = Math.hypot(hubNode.fx, hubNode.fy, hubNode.fz) || 1;
  const camRatio = (dist + 58) / dist;
  const camPos = {
    x: hubNode.fx * camRatio,
    y: hubNode.fy * camRatio + 8,
    z: hubNode.fz * camRatio
  };

  const controls = STATE.graph3D.controls();
  if (controls) controls.enabled = false;

  STATE.graph3D.cameraPosition(
    camPos,
    { x: hubNode.fx, y: hubNode.fy, z: hubNode.fz },
    850
  );

  document.getElementById('camera-lock-hint').classList.remove('hidden');

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

  STATE.graph3D.cameraPosition(
    { x: 0, y: 75, z: 330 },
    { x: 0, y: 0, z: 0 },
    850
  );

  log('Caméra libérée et recentrée sur le Cortex Central (0,0,0).', 'log-info');
}

// ============================================================================
// CLIENT GITHUB API & FILTRAGE INTELLIGENT DES FICHIERS TEXTE
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
    throw new Error(`GitHub ${res.status} (${endpoint}): ${txt}`);
  }
  return res.status === 204 ? null : res.json();
}

function isUsefulTextFile(path, size = 0) {
  if (size > 350000) return false;
  const ignoredDirs = ['node_modules/', '.git/', '__pycache__/', '.venv/', 'venv/', 'dist/', 'build/', '.pytest_cache/'];
  if (ignoredDirs.some(d => path.includes(d))) return false;
  const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.pyc', '.woff', '.woff2', '.ttf', '.glb', '.gltf', '.mp4', '.mp3'];
  return !binaryExts.some(ext => path.toLowerCase().endsWith(ext));
}

async function connectAndBuildCortex() {
  try {
    setGlobalStatus('SYNCHRONISATION...', '#f59e0b');
    log('Connexion automatique à GitHub API...', 'log-step');
    const repos = await ghFetch('/user/repos?per_page=100&sort=updated');
    STATE.repos = repos;
    buildSynapticClusters(repos);
    setGlobalStatus(`${repos.length} AMAS ACTIFS`, '#10b981');
    log(`${repos.length} amas synaptiques générés en orbite autour du Cortex.`, 'log-ok');
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

  log(`Synchronisation de l'état de ${fullName} (${branch})...`, 'log-step');

  try {
    const refData = await ghFetch(`/repos/${fullName}/git/ref/heads/${branch}`);
    const headSha = refData.object.sha;
    const commitData = await ghFetch(`/repos/${fullName}/git/commits/${headSha}`);
    document.getElementById('proj-last-commit').textContent = `${headSha.slice(0, 7)} — ${commitData.message.split('\n')[0]}`;

    const treeData = await ghFetch(`/repos/${fullName}/git/trees/${commitData.tree.sha}?recursive=1`);
    STATE.treeFiles = (treeData.tree || []).filter(item => item.type === 'blob' && isUsefulTextFile(item.path, item.size));
    renderFileChecklist(STATE.treeFiles);

    await refreshCIStatusBadge(fullName, branch);
    await loadProjectBackups();

    log(`Projet prêt : ${STATE.treeFiles.length} fichiers texte utiles, ${STATE.backups.length} tags de restauration.`, 'log-ok');
  } catch (err) {
    log(`Erreur synchronisation projet : ${err.message}`, 'log-err');
  }
}

async function refreshCIStatusBadge(fullName, branch) {
  const ciBadge = document.getElementById('proj-ci-badge');
  try {
    const runsData = await ghFetch(`/repos/${fullName}/actions/runs?per_page=1&branch=${branch}`);
    if (runsData.total_count > 0 && runsData.workflow_runs?.[0]) {
      const latestRun = runsData.workflow_runs[0];
      if (latestRun.status !== 'completed') {
        ciBadge.textContent = `EN COURS (${latestRun.status})`;
        ciBadge.style.color = '#f59e0b';
      } else if (latestRun.conclusion === 'success') {
        ciBadge.textContent = `PASS ✓ (${latestRun.name})`;
        ciBadge.style.color = '#10b981';
      } else {
        ciBadge.textContent = `ÉCHEC (${latestRun.conclusion})`;
        ciBadge.style.color = '#ef4444';
      }
      return latestRun;
    } else {
      ciBadge.textContent = 'Aucun Workflow';
      ciBadge.style.color = '#94a3b8';
      return null;
    }
  } catch {
    return null;
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

    const spanPath = document.createElement('span');
    spanPath.textContent = file.path;

    const spanSize = document.createElement('span');
    spanSize.className = 'file-size';
    spanSize.textContent = `${((file.size || 0) / 1024).toFixed(1)} Ko`;

    label.appendChild(checkbox);
    label.appendChild(spanPath);
    label.appendChild(spanSize);
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
// BACKUPS GITHUB (TAGS) & RESTAURATION EN 1 CLIC
// ============================================================================
async function loadProjectBackups() {
  if (!STATE.activeRepo) return;
  const fullName = STATE.activeRepo.full_name;

  try {
    const tags = await ghFetch(`/repos/${fullName}/tags?per_page=15`);
    STATE.backups = (tags || []).map(t => ({
      name: t.name,
      sha: t.commit.sha
    }));
  } catch {
    STATE.backups = [];
  }

  document.getElementById('backup-count').textContent = STATE.backups.length;
  const container = document.getElementById('backups-list');
  container.innerHTML = '';

  if (STATE.backups.length === 0) {
    container.innerHTML = '<div style="color:#64748b;font-size:11px;">Aucun tag de sauvegarde sur ce dépôt.</div>';
    return;
  }

  STATE.backups.forEach(b => {
    const card = document.createElement('div');
    card.className = 'backup-card';

    const info = document.createElement('div');
    info.className = 'backup-info';
    info.innerHTML = `<span class="backup-name">🏷️ ${b.name}</span><span class="backup-sha">SHA: ${b.sha.slice(0, 10)}</span>`;

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

  log(`Point de restauration créé : ${tagName} (${currentSha.slice(0, 7)})`, 'log-ok');
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
    log(`Restauration de la branche ${branch} sur ${tagName} (${targetSha.slice(0, 7)})...`, 'log-warn');
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
    log(`Échec restauration : ${err.message}`, 'log-err');
  }
}

// ============================================================================
// CLIENT GEMINI API (text/plain + 65 536 tokens + AbortSignal)
// ============================================================================
function setAgentMode(mode) {
  document.getElementById('mode-btn-exec').classList.toggle('active', mode === 'exec');
  document.getElementById('mode-btn-audit').classList.toggle('active', mode === 'audit');
  document.getElementById('view-mode-exec').classList.toggle('hidden', mode !== 'exec');
  document.getElementById('view-mode-audit').classList.toggle('hidden', mode !== 'audit');
}

async function callGeminiTextPlain(model, systemInstruction, userPrompt, temperature = 0.15, signal = undefined) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${STATE.geminiKey}`;
  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 65536,
      responseMimeType: 'text/plain'
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini (${model}) ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

async function fetchGitHubFileContent(fullName, path, branch) {
  const data = await ghFetch(`/repos/${fullName}/contents/${encodeURIComponent(path)}?ref=${branch}`);
  const binStr = atob((data.content || '').replace(/\n/g, ''));
  const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// ============================================================================
// ROUTING AGENT : autoSelectFilesWithFlash() (Avec tailles et fallback)
// ============================================================================
async function autoSelectFilesWithFlash(userPrompt, ciErrorLog = '', signal = undefined) {
  const manuallyChecked = getCheckedFilePaths();
  if (manuallyChecked.length > 0 && !ciErrorLog) {
    log(`Utilisation des ${manuallyChecked.length} fichier(s) coché(s) manuellement.`, 'log-info');
    return manuallyChecked;
  }

  setStepStatus('Tri IA Flash...');
  log('Routing Agent : Analyse de l\'arborescence via gemini-2.5-flash...', 'log-step');
  const treePaths = STATE.treeFiles.map(f => `${f.path} (${f.size || 0} B)`).join('\n');

  const sysInstruction = `Tu es un routeur d'analyse de dépôt Git.
Analyse l'arborescence complète du projet et l'objectif utilisateur.
Sélectionne TOUS les fichiers pertinents à lire ou modifier (jusqu'à 8 fichiers).
Réponds UNIQUEMENT avec des balises XML <path>chemin/du/fichier</path>, une par ligne. Aucun JSON.`;

  const prompt = `PROJET : ${STATE.activeRepo.full_name}
ARBORESCENCE :
${treePaths}

DEMANDE UTILISATEUR :
${userPrompt}
${ciErrorLog ? `\nTRACEBACK CI/CD À CORRIGER :\n${ciErrorLog}` : ''}`;

  try {
    const rawText = await callGeminiTextPlain('gemini-2.5-flash', sysInstruction, prompt, 0.0, signal);
    const matches = [...rawText.matchAll(/<path>\s*([^<]+?)\s*<\/path>/gi)];
    const selectedPaths = matches
      .map(m => m[1].trim())
      .filter(p => STATE.treeFiles.some(f => f.path === p))
      .slice(0, 8);

    if (selectedPaths.length > 0) {
      uncheckAllFiles();
      document.querySelectorAll('.file-checkbox').forEach(cb => {
        if (selectedPaths.includes(cb.value)) {
          cb.checked = true;
          cb.parentElement.classList.add('auto-selected');
        }
      });
      log(`Fichiers ciblés par Flash (${selectedPaths.length}) : ${selectedPaths.join(', ')}`, 'log-ok');
      return selectedPaths;
    }
  } catch (e) {
    log(`Avertissement tri Flash : ${e.message}. Utilisation du repli automatique.`, 'log-warn');
  }

  const fallback = STATE.treeFiles.slice(0, 6).map(f => f.path);
  return fallback;
}

// ============================================================================
// CHOIX 1 : AUDIT DE L'ÉTAT DU PROJET & PROPOSITIONS D'AMÉLIORATIONS
// ============================================================================
async function runProjectAudit() {
  if (!STATE.activeRepo) return;
  const btn = document.getElementById('btn-run-audit');
  const output = document.getElementById('audit-output');
  const selectedModel = document.getElementById('agent-model-select').value;

  btn.disabled = true;
  setStepStatus('Audit en cours...');
  output.textContent = 'Sélection des fichiers clés par gemini-2.5-flash...';

  try {
    const keyPaths = await autoSelectFilesWithFlash(
      'Sélectionner les fichiers d\'architecture, README, configuration et modules principaux pour réaliser un audit complet.'
    );

    let contextBlock = '';
    for (const p of keyPaths) {
      const content = await fetchGitHubFileContent(STATE.activeRepo.full_name, p, STATE.activeBranch);
      contextBlock += `\n--- FICHIER: ${p} ---\n${content.slice(0, 6500)}\n`;
    }

    output.textContent = `Génération du diagnostic et des propositions par ${selectedModel}...`;
    const sysInstruction = `Tu es un Architecte Logiciel Principal.
Analyse l'état actuel du projet et propose des évolutions concrètes :
1. Synthèse de l'état actuel et de l'architecture.
2. Failles potentielles, bugs ou dettes techniques identifiés.
3. 3 à 5 propositions d'améliorations et d'évolutions concrètes (fichiers impactés et bénéfices).`;

    const report = await callGeminiTextPlain(
      selectedModel,
      sysInstruction,
      `PROJET : ${STATE.activeRepo.full_name}\nARBORESCENCE :\n${STATE.treeFiles.map(f => f.path).join('\n')}\n\nEXTRAITS :\n${contextBlock}`,
      0.2
    );

    output.textContent = report;
    setStepStatus('Audit terminé ✓');
    log(`Audit terminé pour ${STATE.activeRepo.full_name}.`, 'log-ok');
  } catch (err) {
    output.textContent = `Erreur : ${err.message}`;
    setStepStatus('Erreur Audit');
    log(`Erreur audit : ${err.message}`, 'log-err');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// CHOIX 2 : PROTOCOLE XML / CDATA BRUT & PATCH TOLÉRANT AUX ESPACES
// ============================================================================
async function executeCodeGeneration(model, userPrompt, filesContentMap, ciFailureLog = '', signal = undefined) {
  let filesSection = '';
  for (const [path, content] of Object.entries(filesContentMap)) {
    filesSection += `\n==============================\nFICHIER : ${path}\n==============================\n${content}\n`;
  }

  const sysInstruction = `Tu es un ingénieur logiciel senior autonome.
Tu dois traiter INTÉGRALEMENT toutes les demandes de l'utilisateur en une seule passe, sur autant de fichiers que nécessaire.
INTERDICTION ABSOLUE D'UTILISER DU JSON. Réponds UNIQUEMENT avec le protocole XML strict ci-dessous.

Inclus toujours un message de commit clair :
<commit_msg>feat(module): description précise</commit_msg>

Pour remplacer ou créer un fichier complet (écris 100 % du code sans jamais tronquer) :
<file path="chemin/du/fichier.py"><![CDATA[
...code complet du fichier sans aucune troncature...
]]></file>

Pour modifier chirurgicalement une ou plusieurs parties d'un fichier existant :
<patch path="chemin/du/fichier.py">
<search><![CDATA[
...lignes exactes existantes à remplacer...
]]></search>
<replace><![CDATA[
...nouvelles lignes complètes...
]]></replace>
</patch>

RÈGLES STRICTES :
1. Traite TOUS les points demandés par l'utilisateur.
2. N'utilise jamais de commentaires paresseux du type "# reste du code inchangé" dans <file>. Utilise <patch> pour les modifications ciblées.`;

  const fullPrompt = `DÉPÔT : ${STATE.activeRepo.full_name} (Branche : ${STATE.activeBranch})
ARBORESCENCE COMPLÈTE :
${STATE.treeFiles.map(f => '- ' + f.path).join('\n')}

CONTENU FRAIS DES FICHIERS SÉLECTIONNÉS :
${filesSection}

${ciFailureLog ? `\n⚠️ ERREUR CI/CD DU CYCLE PRÉCÉDENT À CORRIGER IMPÉRATIVEMENT :\n${ciFailureLog}\n` : ''}

INSTRUCTIONS DE L'UTILISATEUR À APPLIQUER INTÉGRALEMENT :
${userPrompt}`;

  log(`Envoi du contexte (${(fullPrompt.length / 1024).toFixed(1)} Ko) à ${model}...`, 'log-info');
  return await callGeminiTextPlain(model, sysInstruction, fullPrompt, 0.15, signal);
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

// Application tolérante aux différences de fins de lignes (\r\n vs \n) et d'espaces de fin de ligne
function applyHunkTolerant(originalContent, searchStr, replaceStr) {
  const normOrig = originalContent.replace(/\r\n/g, '\n');
  const normSearch = searchStr.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
  const normReplace = replaceStr.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');

  if (normOrig.includes(normSearch)) {
    return normOrig.replace(normSearch, normReplace);
  }

  const origLines = normOrig.split('\n');
  const searchLines = normSearch.split('\n');

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
      return [...before, normReplace, ...after].join('\n');
    }
  }

  throw new Error(`Bloc <search> introuvable (ligne: "${searchLines[0]?.slice(0, 60)}")`);
}

// Parseur universel : accepte <search>/<replace> ET <<<<<<< SEARCH / >>>>>>> REPLACE
function parseXmlOperationsUniversal(rawXmlResponse) {
  const cleaned = rawXmlResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const commitMatch = cleaned.match(/<commit_msg>([\s\S]*?)<\/commit_msg>/i);
  const commitMsg = commitMatch
    ? extractCdataContent(commitMatch[1]).trim()
    : 'feat(agent): autonomous XML/CDATA update';

  const fullFiles = [];
  const fileRegex = /<file\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/file>/gi;
  for (const match of cleaned.matchAll(fileRegex)) {
    const path = match[1].trim();
    const content = extractCdataContent(match[2]) + '\n';
    fullFiles.push({ path, content });
  }

  const patches = [];
  const patchRegex = /<patch\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/patch>/gi;
  for (const match of cleaned.matchAll(patchRegex)) {
    const path = match[1].trim();
    const body = match[2];
    const hunks = [];

    // Format 1 : <search>...</search><replace>...</replace>
    const xmlHunkRegex = /<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>/gi;
    for (const hm of body.matchAll(xmlHunkRegex)) {
      hunks.push({
        search: extractCdataContent(hm[1]),
        replace: extractCdataContent(hm[2])
      });
    }

    // Format 2 (Fallback) : <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE
    if (hunks.length === 0) {
      const cleanBody = extractCdataContent(body);
      const gitHunkRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
      for (const gm of cleanBody.matchAll(gitHunkRegex)) {
        hunks.push({ search: gm[1], replace: gm[2] });
      }
    }

    if (hunks.length > 0) {
      patches.push({ path, hunks });
    }
  }

  return { commitMsg, fullFiles, patches };
}

// ============================================================================
// 3. COMMIT GIT ATOMIQUE MULTI-FICHIERS : pushAtomicCommit()
// ============================================================================
async function pushAtomicCommit(fullName, branch, commitMsg, modifiedFilesMap) {
  const filePaths = Object.keys(modifiedFilesMap);
  if (filePaths.length === 0) {
    throw new Error('Aucune balise <file> ou <patch> valide détectée dans la réponse.');
  }

  log(`Commit Atomique : Envoi de ${filePaths.length} fichier(s) via Git Data API...`, 'log-step');

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
async function waitForCIRunAndGetFailureLog(fullName, branch, commitSha, signal) {
  setStepStatus('Attente CI/CD GitHub...');
  log(`Surveillance GitHub Actions (toutes les 4s) pour le commit ${commitSha.slice(0, 7)}...`, 'log-step');

  await sleep(4500);

  for (let attempt = 1; attempt <= 35; attempt++) {
    if (signal?.aborted) throw new Error('Cycle interrompu par l\'utilisateur.');

    const runsData = await ghFetch(`/repos/${fullName}/actions/runs?head_sha=${commitSha}&per_page=5`);
    const run = runsData.workflow_runs?.[0];

    if (!run) {
      if (attempt >= 5) {
        log('Aucun workflow GitHub Actions déclenché sur ce commit.', 'log-ok');
        return { passed: true, trace: '' };
      }
      await sleep(3500);
      continue;
    }

    await refreshCIStatusBadge(fullName, branch);

    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        log(`GitHub Actions : TOUS LES TESTS SONT AU VERT ✓ (${run.name})`, 'log-ok');
        return { passed: true, trace: '' };
      } else {
        log(`GitHub Actions en échec (${run.conclusion}). Extraction des 4 500 derniers caractères...`, 'log-err');
        const trace = await extractFailedJobTrace(fullName, run.id);
        return { passed: false, trace };
      }
    }

    log(`CI en cours d'exécution (${run.status})... [${attempt * 4}s]`, 'log-info');
    await sleep(4000);
  }

  return { passed: true, trace: '' };
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
        headers: {
          'Authorization': `Bearer ${STATE.ghToken}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (res.ok) {
        const fullLogText = await res.text();
        combinedTrace += fullLogText.slice(-4500) + '\n';
        continue;
      }
    } catch (_) {}

    // Fallback CORS sur les annotations du check-run
    try {
      const annotations = await ghFetch(`/repos/${fullName}/check-runs/${job.id}/annotations`);
      if (annotations && annotations.length > 0) {
        annotations.forEach(a => {
          combinedTrace += `[${a.annotation_level}] ${a.path} (L.${a.start_line}): ${a.message}\n${a.raw_details || ''}\n`;
        });
      }
    } catch (_) {}
  }

  return combinedTrace.slice(-4500) || 'Le workflow CI a échoué sans trace texte disponible.';
}

// ============================================================================
// PIPELINE D'EXÉCUTION AUTONOME COMPLET
// ============================================================================
async function runFreeExecutionPipeline() {
  if (!STATE.activeRepo) return;
  const userPrompt = document.getElementById('custom-prompt').value.trim();
  if (!userPrompt) {
    return log('Écris une instruction dans la zone de prompt avant de lancer.', 'log-warn');
  }

  const fullName = STATE.activeRepo.full_name;
  const branch = STATE.activeBranch;
  const selectedModel = document.getElementById('agent-model-select').value;
  const autoHealEnabled = document.getElementById('auto-heal-toggle').checked;
  const maxCycles = autoHealEnabled ? 3 : 1;

  const btnRun = document.getElementById('btn-run-exec');
  const btnStop = document.getElementById('btn-stop-agent');
  btnRun.disabled = true;
  btnStop.classList.remove('hidden');

  STATE.abortController = new AbortController();
  const signal = STATE.abortController.signal;

  try {
    // 1. Tag de backup automatique sur GitHub avant toute modification
    setStepStatus('Backup Git...');
    await createBackupTagOnGitHub('pre-run');

    let cycle = 1;
    let ciFailureLog = '';

    while (cycle <= maxCycles) {
      if (signal.aborted) break;

      log(`=== CYCLE AUTONOME #${cycle}/${maxCycles} SUR ${fullName} (${selectedModel}) ===`, 'log-step');

      // 2. Sélection des fichiers pertinents par gemini-2.5-flash
      const targetPaths = await autoSelectFilesWithFlash(userPrompt, ciFailureLog, signal);

      // 3. Lecture fraîche des fichiers ciblés
      setStepStatus(`Cycle ${cycle}/${maxCycles} — Lecture...`);
      const originalFilesMap = {};
      for (const path of targetPaths) {
        if (signal.aborted) break;
        log(`Lecture fraîche : ${path}...`, 'log-info');
        originalFilesMap[path] = await fetchGitHubFileContent(fullName, path, branch);
      }

      // 4. Génération XML/CDATA par le modèle sélectionné
      setStepStatus(`Cycle ${cycle}/${maxCycles} — Génération...`);
      const rawXml = await executeCodeGeneration(selectedModel, userPrompt, originalFilesMap, ciFailureLog, signal);
      const { commitMsg, fullFiles, patches } = parseXmlOperationsUniversal(rawXml);

      const updatedFilesMap = {};

      for (const f of fullFiles) {
        updatedFilesMap[f.path] = f.content;
        log(`Fichier complet généré : ${f.path} (${f.content.split('\n').length} lignes)`, 'log-ok');
      }

      for (const p of patches) {
        let baseContent = updatedFilesMap[p.path] ?? originalFilesMap[p.path];
        if (baseContent === undefined) {
          baseContent = await fetchGitHubFileContent(fullName, p.path, branch);
        }
        for (const hunk of p.hunks) {
          baseContent = applyHunkTolerant(baseContent, hunk.search, hunk.replace);
        }
        updatedFilesMap[p.path] = baseContent;
        log(`Patch chirurgical appliqué sur ${p.path} (${p.hunks.length} bloc(s))`, 'log-ok');
      }

      // 5. Commit Atomique Multi-Fichiers
      setStepStatus(`Cycle ${cycle}/${maxCycles} — Push Atomique...`);
      const newCommitSha = await pushAtomicCommit(fullName, branch, commitMsg, updatedFilesMap);
      await refreshActiveProjectFullState();

      if (!autoHealEnabled) {
        setStepStatus('Terminé ✓');
        log('Modifications poussées avec succès (Auto-Heal désactivé).', 'log-ok');
        break;
      }

      // 6. Surveillance CI/CD & Boucle Auto-Heal
      const ciCheck = await waitForCIRunAndGetFailureLog(fullName, branch, newCommitSha, signal);
      await refreshActiveProjectFullState();

      if (ciCheck.passed) {
        setStepStatus('Terminé & CI Validée ✓');
        log(`Pipeline validé au cycle #${cycle} : CI/CD au vert !`, 'log-ok');
        break;
      } else {
        ciFailureLog = ciCheck.trace;
        log(`Traceback CI récupérée (${ciFailureLog.length} car.) :\n${ciFailureLog.slice(-700)}`, 'log-err');
        uncheckAllFiles();
        cycle++;
        if (cycle > maxCycles) {
          setStepStatus('Échec Auto-Heal');
          log(`Limite de ${maxCycles} cycles Auto-Heal atteinte. Utilise l'onglet Backups pour restaurer si besoin.`, 'log-err');
        }
      }
    }
  } catch (err) {
    setStepStatus('Erreur');
    log(`Erreur pipeline : ${err.message}`, 'log-err');
  } finally {
    btnRun.disabled = false;
    btnStop.classList.add('hidden');
  }
}
