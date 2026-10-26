import * as THREE from "three";

// PA3 personal variant, derived from student ID 241629.
const STUDENT_ID = "241629";
const VARIANT = "Standing Desk";
const PLACEMENT_MODE = "multi"; // ID digit 2: 2 % 2 = 0
const MAX_PRODUCTS = 5;
const SURFACE_TOLERANCE_DEG = 8; // ID digit 6: 6 % 3 = 0
const ORIENTATION_RULE = "hit-pose"; // ID digit 1: 1 % 2 = 1

let renderer;
let scene;
let camera;
let controller;
let reticle;
let startButton;
let clearButton;
let statusElement;
let fallbackElement;
let trackingElement;
let overlayElement;

let xrSession = null;
let localSpace = null;
let hitTestSource = null;
let placeRequested = false;
let anchorsEnabled = false;
let arSupported = false;
let trackingLost = false;
let currentHitPose = null;
let currentHitResult = null;
let currentSurfaceAngle = null;
let currentSurfaceValid = false;

// Each entry is { object, anchor, anchorPending, removed }.
const placedProducts = [];

loadScene();

function loadScene() {
  startButton = document.querySelector("#start");
  clearButton = document.querySelector("#clear");
  statusElement = document.querySelector("#status");
  fallbackElement = document.querySelector("#fallback");
  trackingElement = document.querySelector("#tracking");
  overlayElement = document.querySelector("#overlay");

  // Three.js r163+ requires WebGL2. Let the r186 renderer create its own context;
  // passing a manually-created WebGL1 context (as in the old Ch. 7 listing) throws.
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / Math.max(window.innerHeight, 1),
    0.01,
    100
  );

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a91a1, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);

  // Current names are BoxGeometry/RingGeometry, not the removed BufferGeometry names.
  const reticleGeometry = new THREE.RingGeometry(0.08, 0.13, 32);
  reticleGeometry.rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(
    reticleGeometry,
    new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  startButton.addEventListener("click", onStartStopClick);
  clearButton.addEventListener("click", clearProducts);

  // Prevent taps on DOM-overlay controls from also becoming XR select events.
  overlayElement.addEventListener("beforexrselect", (event) => {
    event.preventDefault();
  });

  window.addEventListener("resize", onResize);
  onResize();
  checkARSupport();
  updateOverlay();
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function checkARSupport() {
  if (!navigator.xr) {
    showFallback("WebXR is unavailable in this browser. Use a supported AR device and a secure HTTPS or localhost page.");
    return;
  }

  try {
    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    if (!supported) {
      showFallback("Immersive AR is not supported on this device/browser. Use Android Chrome with ARCore or an accepted Quest browser.");
      return;
    }

    arSupported = true;
    startButton.disabled = false;
    startButton.textContent = "START AR";
    fallbackElement.style.display = "none";
    updateOverlay();
  } catch (error) {
    showFallback(`Could not check AR support: ${error.message}`);
  }
}

function showFallback(message) {
  fallbackElement.textContent = message;
  fallbackElement.style.display = "block";
  startButton.disabled = true;
  startButton.textContent = "AR unavailable";
  updateOverlay();
}

async function onStartStopClick() {
  if (xrSession) {
    await endXRSession();
    return;
  }

  startButton.disabled = true;
  try {
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["anchors", "dom-overlay"],
      domOverlay: { root: overlayElement }
    });
    await onSessionStarted(session);
  } catch (error) {
    console.error("Could not start immersive AR:", error);
    fallbackElement.textContent = `Could not start AR: ${error.message}`;
    fallbackElement.style.display = "block";
    startButton.disabled = !arSupported;
    startButton.textContent = arSupported ? "START AR" : "AR unavailable";
    updateOverlay();
  }
}

async function onSessionStarted(session) {
  xrSession = session;
  session.addEventListener("end", onSessionEnd, { once: true });

  try {
    await renderer.xr.setSession(session);
    localSpace = renderer.xr.getReferenceSpace();
    const enabled = new Set(session.enabledFeatures || []);
    anchorsEnabled = enabled.has("anchors");

    // Create exactly one viewer-space hit-test source for this session.
    const viewerSpace = await session.requestReferenceSpace("viewer");
    if (xrSession !== session) return;
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    if (xrSession !== session) {
      hitTestSource.cancel();
      hitTestSource = null;
      return;
    }

    startButton.disabled = false;
    startButton.textContent = "STOP AR";
    renderer.setAnimationLoop(render);
    updateOverlay();
  } catch (error) {
    console.error("AR session setup failed:", error);
    try { await session.end(); } catch { /* The session may already have ended. */ }
    onSessionEnd();
  }
}

function onSelect() {
  // Actual placement is deferred to render(), where the current XRFrame is available.
  placeRequested = true;
}

function render(_time, frame) {
  if (frame && xrSession && localSpace) {
    updateTracking(frame);
    updateReticle(frame);

    if (placeRequested) {
      placeRequested = false;
      if (!trackingLost && currentSurfaceValid && currentHitPose && currentHitResult) {
        placeProduct(frame, currentHitResult, currentHitPose);
      }
    }

    updateAnchoredProducts(frame);
    updateOverlay();
  }

  renderer.render(scene, camera);
}

function updateTracking(frame) {
  const viewerPose = frame.getViewerPose(localSpace);
  trackingLost = !viewerPose || viewerPose.emulatedPosition === true;
  trackingElement.style.display = trackingLost ? "block" : "none";

  if (trackingLost) {
    reticle.visible = false;
    currentHitPose = null;
    currentHitResult = null;
    currentSurfaceAngle = null;
    currentSurfaceValid = false;
  }
}

function updateReticle(frame) {
  if (trackingLost || !hitTestSource) {
    reticle.visible = false;
    currentHitPose = null;
    currentHitResult = null;
    currentSurfaceAngle = null;
    currentSurfaceValid = false;
    return;
  }

  const results = frame.getHitTestResults(hitTestSource);
  if (results.length === 0) {
    reticle.visible = false;
    currentHitPose = null;
    currentHitResult = null;
    currentSurfaceAngle = null;
    currentSurfaceValid = false;
    return;
  }

  const hit = results[0];
  const pose = hit.getPose(localSpace);
  if (!pose) {
    reticle.visible = false;
    currentHitPose = null;
    currentHitResult = null;
    currentSurfaceAngle = null;
    currentSurfaceValid = false;
    return;
  }

  currentHitPose = pose;
  currentHitResult = hit;

  // The y-axis (indices 4,5,6) of the pose matrix is the surface normal.
  const matrix = pose.transform.matrix;
  const normal = new THREE.Vector3(matrix[4], matrix[5], matrix[6]).normalize();
  const cosine = THREE.MathUtils.clamp(
    normal.dot(new THREE.Vector3(0, 1, 0)),
    -1,
    1
  );
  currentSurfaceAngle = THREE.MathUtils.radToDeg(Math.acos(cosine));
  currentSurfaceValid = currentSurfaceAngle <= SURFACE_TOLERANCE_DEG;

  reticle.matrix.fromArray(matrix);
  reticle.matrixWorldNeedsUpdate = true;
  reticle.material.color.setHex(currentSurfaceValid ? 0x00ff55 : 0xff3030);
  reticle.visible = true;
}

function buildProduct() {
  const product = new THREE.Group();
  product.name = "Standing desk (metres; origin at centre of base)";

  const topMaterial = new THREE.MeshStandardMaterial({
    color: 0x9b6b43,
    roughness: 0.72
  });
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x303943,
    metalness: 0.35,
    roughness: 0.48
  });
  const footMaterial = new THREE.MeshStandardMaterial({
    color: 0x20262d,
    metalness: 0.2,
    roughness: 0.55
  });

  function addBox(name, size, position, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    product.add(mesh);
  }

  // Desk: 1.40 m wide, 0.70 m deep, work surface at 1.10 m.
  addBox("tabletop", [1.4, 0.08, 0.7], [0, 1.06, 0], topMaterial);
  addBox("left support leg", [0.075, 1.02, 0.075], [-0.52, 0.55, 0], legMaterial);
  addBox("right support leg", [0.075, 1.02, 0.075], [0.52, 0.55, 0], legMaterial);
  addBox("left floor foot", [0.48, 0.05, 0.12], [-0.52, 0.025, 0], footMaterial);
  addBox("right floor foot", [0.48, 0.05, 0.12], [0.52, 0.025, 0], footMaterial);

  product.updateMatrixWorld(true);
  const size = new THREE.Box3()
    .setFromObject(product)
    .getSize(new THREE.Vector3());
  console.log("Standing desk size in metres; expected about 1.40 x 1.10 x 0.70:", size.toArray());

  product.matrixAutoUpdate = false;
  return product;
}

function placeProduct(_frame, hit, hitPose) {
  if (PLACEMENT_MODE === "single") {
    clearProducts();
  } else if (placedProducts.length >= MAX_PRODUCTS) {
    // Multi variant: the sixth placement removes the oldest product.
    removeProduct(placedProducts[0]);
  }

  const product = buildProduct();
  const poseMatrix = new THREE.Matrix4().fromArray(hitPose.transform.matrix);

  if (ORIENTATION_RULE === "hit-pose") {
    product.matrix.copy(poseMatrix);
  } else {
    const position = new THREE.Vector3().setFromMatrixPosition(poseMatrix);
    const yaw = getFacingYaw(position);
    product.matrix.compose(
      position,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(1, 1, 1)
    );
  }

  product.matrixWorldNeedsUpdate = true;
  scene.add(product);

  const record = {
    object: product,
    anchor: null,
    anchorPending: false,
    removed: false
  };
  placedProducts.push(record);

  if (anchorsEnabled && typeof hit.createAnchor === "function") {
    record.anchorPending = true;
    hit.createAnchor()
      .then((anchor) => {
        record.anchorPending = false;
        if (record.removed || xrSession === null) {
          anchor.delete();
          return;
        }
        record.anchor = anchor;
      })
      .catch((error) => {
        record.anchorPending = false;
        console.warn("Anchor creation failed; keeping the hit-pose placement:", error);
      });
  }
}

function getFacingYaw(position) {
  const viewerPosition = new THREE.Vector3();
  renderer.xr.getCamera(camera).getWorldPosition(viewerPosition);
  const direction = viewerPosition.sub(position);
  return Math.atan2(direction.x, direction.z);
}

function updateAnchoredProducts(frame) {
  if (!anchorsEnabled || !localSpace) return;

  for (const record of placedProducts) {
    if (!record.anchor) continue;

    const pose = frame.getPose(record.anchor.anchorSpace, localSpace);
    if (!pose) continue;

    const anchorMatrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
    if (ORIENTATION_RULE === "hit-pose") {
      record.object.matrix.copy(anchorMatrix);
    } else {
      const position = new THREE.Vector3().setFromMatrixPosition(anchorMatrix);
      const yaw = getFacingYaw(position);
      record.object.matrix.compose(
        position,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(1, 1, 1)
      );
    }
    record.object.matrixWorldNeedsUpdate = true;
  }
}

function removeProduct(record) {
  if (!record) return;
  record.removed = true;

  if (record.anchor) {
    try { record.anchor.delete(); }
    catch (error) { console.warn("Could not delete anchor:", error); }
    record.anchor = null;
  }

  scene.remove(record.object);
  record.object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else {
      child.material.dispose();
    }
  });

  const index = placedProducts.indexOf(record);
  if (index !== -1) placedProducts.splice(index, 1);
}

function clearProducts() {
  for (const record of [...placedProducts]) removeProduct(record);
  updateOverlay();
}

async function endXRSession() {
  const session = xrSession;
  if (!session) return;

  try {
    await session.end();
  } catch (error) {
    console.warn("Session may already have ended:", error);
    onSessionEnd();
  }
}

function onSessionEnd() {
  // Handles both the STOP button and system-driven session termination.
  renderer.setAnimationLoop(null);

  if (hitTestSource) {
    try { hitTestSource.cancel(); }
    catch (error) { console.warn("Hit-test source cleanup failed:", error); }
  }
  hitTestSource = null;

  for (const record of [...placedProducts]) removeProduct(record);

  xrSession = null;
  localSpace = null;
  placeRequested = false;
  anchorsEnabled = false;
  trackingLost = false;
  currentHitPose = null;
  currentHitResult = null;
  currentSurfaceAngle = null;
  currentSurfaceValid = false;
  reticle.visible = false;
  trackingElement.style.display = "none";
  startButton.disabled = false;
  startButton.textContent = "START AR";
  updateOverlay();
}

function updateOverlay() {
  if (!statusElement) return;

  let reticleState = "none";
  if (currentSurfaceAngle !== null) {
    reticleState =
      `${currentSurfaceValid ? "valid" : "too tilted"} ` +
      `(${currentSurfaceAngle.toFixed(1)}°, limit ${SURFACE_TOLERANCE_DEG}°)`;
  }

  const sessionState = xrSession ? "active" : "not active";
  const anchorState = xrSession
    ? (anchorsEnabled ? "on" : "off")
    : "not in session";

  statusElement.textContent =
    `Student ID: ${STUDENT_ID} | Variant: ${VARIANT}\n` +
    `Session: ${sessionState}\n` +
    `Reticle: ${trackingLost ? "tracking lost" : reticleState}\n` +
    `Anchors: ${anchorState}\n` +
    `Products: ${placedProducts.length}/${PLACEMENT_MODE === "multi" ? MAX_PRODUCTS : 1}`;
}