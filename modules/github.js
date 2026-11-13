import { getCreds, getStore } from './auth.js';

let grantedScopes = "";
let repositories = [];

export async function ghFetch(endpoint, options = {}) {
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
    if (badge) {
      badge.classList.remove("hidden");
      const hasWorkflow = scopes.includes("workflow");
      badge.textContent = `Scopes: ${scopes || "aucun"}`;
      badge.className = hasWorkflow
        ? "text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30"
        : "text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40";
    }
  }
  return resp;
}

export async function loadAllRepositories() {
  const creds = getCreds();
  const stats = document.getElementById("stats-counter");
  if (!stats) return;
  if (!creds.githubToken && !creds.owner) {
    stats.textContent = "Configure tes clés en haut à droite";
    const drawer = document.getElementById("settings-drawer");
    if (drawer) drawer.classList.remove("hidden");
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
        const ownerInput = document.getElementById("cfg-owner");
        if (ownerInput) ownerInput.value = owner;
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

export function buildBrainGraph(owner, repos) {
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

  if (window.graph3D) {
    window.graph3D.graphData({ nodes, links });
  }
}
