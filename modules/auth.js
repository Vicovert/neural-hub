export function getStore() {
  const mode = localStorage.getItem("ndh_storage_mode") || "session";
  return mode === "local" ? localStorage : sessionStorage;
}

export function getCreds() {
  const s = getStore();
  return {
    mode: localStorage.getItem("ndh_storage_mode") || "session",
    owner: (s.getItem("ndh_owner") || "").trim(),
    githubToken: (s.getItem("ndh_gh_token") || "").trim(),
    geminiKey: (s.getItem("ndh_gemini_key") || "").trim(),
    groqKey: (s.getItem("ndh_groq_key") || "").trim()
  };
}

export function saveCredentials() {
  const mode = document.getElementById("cfg-storage-mode").value;
  localStorage.setItem("ndh_storage_mode", mode);
  const s = mode === "local" ? localStorage : sessionStorage;
  s.setItem("ndh_owner", document.getElementById("cfg-owner").value.trim());
  s.setItem("ndh_gh_token", document.getElementById("cfg-github-token").value.trim());
  s.setItem("ndh_gemini_key", document.getElementById("cfg-gemini-key").value.trim());
  s.setItem("ndh_groq_key", document.getElementById("cfg-groq-key").value.trim());
  document.getElementById("settings-drawer").classList.add("hidden");
  if (typeof window.loadAllRepositories === 'function') {
    window.loadAllRepositories();
  }
}

export function clearCredentials() {
  sessionStorage.clear();
  ["ndh_owner", "ndh_gh_token", "ndh_gemini_key", "ndh_groq_key", "ndh_storage_mode"].forEach(k => localStorage.removeItem(k));
  alert("Toutes les clés ont été purgées de ce navigateur.");
  location.reload();
}
