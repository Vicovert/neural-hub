let graph3D = null;
const nodesMap = new Map();

export function initBrain3D() {
  const elem = document.getElementById("3d-graph");
  if (!elem || typeof ForceGraph3D === 'undefined') return;
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
    });

  const scene = graph3D.scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
  dLight.position.set(100, 140, 90);
  scene.add(dLight);

  window.addEventListener("resize", () => {
    graph3D.width(window.innerWidth);
    graph3D.height(window.innerHeight);
  });
}

export function updateNodeColor3D(repoName, hexColor) {
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

export function focusNodeLeftOfHud(node) {
  if (!graph3D) return;
  const dist = 105;
  const ratio = 1 + dist / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
  const lookAtTarget = { x: (node.x || 0) + 18, y: node.y || 0, z: node.z || 0 };
  graph3D.cameraPosition(
    { x: (node.x || 1) * ratio, y: (node.y || 1) * ratio, z: (node.z || 1) * ratio },
    lookAtTarget,
    950
  );
}

export function resetCamera() {
  if (!graph3D) return;
  graph3D.cameraPosition({ x: 0, y: 0, z: 270 }, { x: 0, y: 0, z: 0 }, 900);
}
