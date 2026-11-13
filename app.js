// ============================================================================
// NEURAL DEV HUB V5.4 — MOTEUR 3D, GITHUB GIT DATA API & ROUTEUR MULTI-AGENTS
// ============================================================================

import { getStore, getCreds, saveCredentials, clearCredentials } from './modules/auth.js';
import { b64DecodeUtf8, b64EncodeUtf8, escapeHtml } from './modules/utils.js';
import { initBrain3D, updateNodeColor3D, focusNodeLeftOfHud, resetCamera } from './modules/brain.js';
import { ghFetch, loadAllRepositories, buildBrainGraph } from './modules/github.js';

window.getStore = getStore;
window.getCreds = getCreds;
window.saveCredentials = saveCredentials;
window.clearCredentials = clearCredentials;
window.b64DecodeUtf8 = b64DecodeUtf8;
window.b64EncodeUtf8 = b64EncodeUtf8;
window.escapeHtml = escapeHtml;
window.initBrain3D = initBrain3D;
window.updateNodeColor3D = updateNodeColor3D;
window.focusNodeLeftOfHud = focusNodeLeftOfHud;
window.resetCamera = resetCamera;
window.ghFetch = ghFetch;
window.loadAllRepositories = loadAllRepositories;
window.buildBrainGraph = buildBrainGraph;

console.log('Neural Dev Hub initialisé avec succès.');
