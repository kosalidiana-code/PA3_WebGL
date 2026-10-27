import * as THREE from "three";

// PA3 — Student ID 241629
const STUDENT_ID = "241629";
const VARIANT = "Standing Desk";

const PLACEMENT_MODE = "multi";
const MAX_PRODUCTS = 5;
const SURFACE_TOLERANCE_DEG = 8;
const ORIENTATION_RULE = "hit-pose";

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

const placedProducts = [];

loadScene();

function loadScene() {
  startButton = document.querySelector("#start");
  clearButton = document.querySelector("#clear");
  statusElement = document.querySelector("#status");
  fallbackElement = document.querySelector("#fallback");
  trackingElement = document.querySelector("#tracking");
  overlayElement = document.querySelector("#overlay");

  // Let Three.js create its own WebGL2 context.
  // Lower the rendering load on mobile devices.
  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true
  });

  renderer.setPixelRatio(1);
  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
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

  scene.add(
    new THREE.HemisphereLight(
      0xffffff,
      0x8a91a1,
      2
    )
  );

  const keyLight = new THREE.DirectionalLight(
    0xffffff,
    2.5
  );

  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);

  // Horizontal reticle ring.
  const reticleGeometry = new THREE.RingGeometry(
    0.08,
    0.13,
    32
  );

  reticleGeometry.rotateX(-Math.PI / 2);

  reticle = new THREE.Mesh(
    reticleGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x00ff55,
      side: THREE.DoubleSide
    })
  );

  reticle.matrixAutoUpdate = false;
  reticle.visible = false;

  scene.add(reticle);

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  startButton.addEventListener(
    "click",
    onStartStopClick
  );

  clearButton.addEventListener(
    "click",
    clearProducts
  );

  // Prevent DOM-overlay taps from triggering placement.
  overlayElement.addEventListener(
    "beforexrselect",
    (event) => {
      event.preventDefault();
    }
  );

  window.addEventListener("resize", onResize);

  onResize();
  checkARSupport();
  updateOverlay();
}

function onResize() {
  if (!renderer || !camera) return;

  camera.aspect =
    window.innerWidth / Math.max(window.innerHeight, 1);

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
}

async function checkARSupport() {
  if (!navigator.xr) {
    showFallback(
      "WebXR is unavailable. Open this page in a compatible " +
      "AR browser using HTTPS or localhost."
    );
    return;
  }

  try {
    const supported =
      await navigator.xr.isSessionSupported("immersive-ar");

    if (!supported) {
      showFallback(
        "Immersive AR is not supported on this device/browser."
      );
      return;
    }

    arSupported = true;
    startButton.disabled = false;
    startButton.textContent = "START AR";

    fallbackElement.style.display = "none";

    updateOverlay();
  } catch (error) {
    showFallback(
      `Could not check AR support: ${error.message}`
    );
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

  if (!arSupported || !navigator.xr) return;

  startButton.disabled = true;
  fallbackElement.style.display = "none";

  try {
    const session = await navigator.xr.requestSession(
      "immersive-ar",
      {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["anchors", "dom-overlay"],
        domOverlay: {
          root: overlayElement
        }
      }
    );

    await onSessionStarted(session);
  } catch (error) {
    console.error("Could not start immersive AR:", error);

    fallbackElement.textContent =
      `Could not start AR: ${error.message}`;

    fallbackElement.style.display = "block";

    startButton.disabled = !arSupported;
    startButton.textContent =
      arSupported ? "START AR" : "AR unavailable";

    updateOverlay();
  }
}

async function onSessionStarted(session) {
  xrSession = session;

  // Reset hit-test state for a new session.
  hitTestSource = null;
  localSpace = null;
  placeRequested = false;
  trackingLost = false;
  resetCurrentHit();

  // Both STOP and system termination use this handler.
  session.addEventListener(
    "end",
    () => onSessionEnd(session),
    { once: true }
  );

  try {
    await renderer.xr.setSession(session);

    if (xrSession !== session) return;

    localSpace = renderer.xr.getReferenceSpace();

    if (!localSpace) {
      throw new Error("Local reference space is unavailable.");
    }

    const enabledFeatures =
      new Set(session.enabledFeatures || []);

    anchorsEnabled = enabledFeatures.has("anchors");

    // Request one viewer-space hit-test source per session.
    const viewerSpace =
      await session.requestReferenceSpace("viewer");

    if (xrSession !== session) return;

    hitTestSource =
      await session.requestHitTestSource({
        space: viewerSpace
      });

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

    try {
      await session.end();
    } catch {
      // The session may already have ended.
    }

    if (xrSession === session) {
      onSessionEnd(session);
    }

    fallbackElement.textContent =
      `AR setup failed: ${error.message}`;

    fallbackElement.style.display = "block";
  }
}

function onSelect() {
  // Placement is performed inside the next XR frame.
  placeRequested = true;
}

function render(_time, frame) {
  if (frame && xrSession && localSpace) {
    updateTracking(frame);
    updateReticle(frame);

    if (placeRequested) {
      placeRequested = false;

      if (
        !trackingLost &&
        currentSurfaceValid &&
        currentHitPose &&
        currentHitResult
      ) {
        placeProduct(
          currentHitResult,
          currentHitPose
        );
      }
    }

    updateAnchoredProducts(frame);
    updateOverlay();
  }

  renderer.render(scene, camera);
}

function updateTracking(frame) {
  const viewerPose = frame.getViewerPose(localSpace);

  trackingLost =
    !viewerPose ||
    viewerPose.emulatedPosition === true;

  trackingElement.style.display =
    trackingLost ? "block" : "none";

  if (trackingLost) {
    resetCurrentHit();
  }
}

function resetCurrentHit() {
  reticle.visible = false;

  currentHitPose = null;
  currentHitResult = null;
  currentSurfaceAngle = null;
  currentSurfaceValid = false;
}

function updateReticle(frame) {
  if (trackingLost || !hitTestSource) {
    resetCurrentHit();
    return;
  }

  const results =
    frame.getHitTestResults(hitTestSource);

  if (results.length === 0) {
    resetCurrentHit();
    return;
  }

  const hit = results[0];
  const pose = hit.getPose(localSpace);

  if (!pose) {
    resetCurrentHit();
    return;
  }

  currentHitPose = pose;
  currentHitResult = hit;

  // The y-axis column of the pose matrix is the surface normal.
  const matrix = pose.transform.matrix;

  const normal = new THREE.Vector3(
    matrix[4],
    matrix[5],
    matrix[6]
  ).normalize();

  const cosine = THREE.MathUtils.clamp(
    normal.dot(new THREE.Vector3(0, 1, 0)),
    -1,
    1
  );

  currentSurfaceAngle =
    THREE.MathUtils.radToDeg(
      Math.acos(cosine)
    );

  currentSurfaceValid =
    currentSurfaceAngle <= SURFACE_TOLERANCE_DEG;

  reticle.matrix.fromArray(matrix);
  reticle.matrixWorldNeedsUpdate = true;

  reticle.material.color.setHex(
    currentSurfaceValid ? 0x00ff55 : 0xff3030
  );

  reticle.visible = true;
}

function buildProduct() {
  const product = new THREE.Group();

  product.name = "Standing desk";

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
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      material
    );

    mesh.name = name;
    mesh.position.set(...position);
    product.add(mesh);
  }

  // Tabletop: 1.40 x 0.70 m.
  // Top surface at y = 1.10 m.
  addBox(
    "tabletop",
    [1.4, 0.08, 0.7],
    [0, 1.06, 0],
    topMaterial
  );

  addBox(
    "left support leg",
    [0.075, 1.02, 0.075],
    [-0.52, 0.55, 0],
    legMaterial
  );

  addBox(
    "right support leg",
    [0.075, 1.02, 0.075],
    [0.52, 0.55, 0],
    legMaterial
  );

  // Corrected feet: narrow along X and extended along Z.
  addBox(
    "left floor foot",
    [0.12, 0.05, 0.48],
    [-0.52, 0.025, 0],
    footMaterial
  );

  addBox(
    "right floor foot",
    [0.12, 0.05, 0.48],
    [0.52, 0.025, 0],
    footMaterial
  );

  // Check the product's real-world dimensions.
  product.updateMatrixWorld(true);

  const size = new THREE.Box3()
    .setFromObject(product)
    .getSize(new THREE.Vector3());

  console.log(
    "Standing desk size (X, Y, Z), metres:",
    size.toArray()
  );

  product.matrixAutoUpdate = false;

  return product;
}

function placeProduct(hit, hitPose) {
  // Multi mode: a sixth placement removes the oldest product.
  if (
    PLACEMENT_MODE === "multi" &&
    placedProducts.length >= MAX_PRODUCTS
  ) {
    removeProduct(placedProducts[0]);
  }

  const product = buildProduct();

  const poseMatrix = new THREE.Matrix4()
    .fromArray(hitPose.transform.matrix);

  // This variant preserves the orientation of the hit pose.
  if (ORIENTATION_RULE === "hit-pose") {
    product.matrix.copy(poseMatrix);
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

  if (
    anchorsEnabled &&
    typeof hit.createAnchor === "function"
  ) {
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

        console.warn(
          "Anchor creation failed; using hit-pose placement:",
          error
        );
      });
  }
}

function updateAnchoredProducts(frame) {
  if (!anchorsEnabled || !localSpace) return;

  for (const record of placedProducts) {
    if (!record.anchor) continue;

    const pose = frame.getPose(
      record.anchor.anchorSpace,
      localSpace
    );

    if (!pose) continue;

    record.object.matrix.fromArray(
      pose.transform.matrix
    );

    record.object.matrixWorldNeedsUpdate = true;
  }
}

function removeProduct(record) {
  if (!record) return;

  record.removed = true;

  if (record.anchor) {
    try {
      record.anchor.delete();
    } catch (error) {
      console.warn("Could not delete anchor:", error);
    }

    record.anchor = null;
  }

  scene.remove(record.object);

  // Dispose geometry once and dispose each shared material once.
  const geometries = new Set();
  const materials = new Set();

  record.object.traverse((child) => {
    if (!child.isMesh) return;

    geometries.add(child.geometry);

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => {
        materials.add(material);
      });
    } else {
      materials.add(child.material);
    }
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());

  const index = placedProducts.indexOf(record);

  if (index !== -1) {
    placedProducts.splice(index, 1);
  }
}

function clearProducts() {
  for (const record of [...placedProducts]) {
    removeProduct(record);
  }

  updateOverlay();
}

async function endXRSession() {
  const session = xrSession;

  if (!session) return;

  try {
    await session.end();
  } catch (error) {
    console.warn(
      "Session may already have ended:",
      error
    );

    if (xrSession === session) {
      onSessionEnd(session);
    }
  }
}

function onSessionEnd(endedSession) {
  // Ignore stale or duplicate end events.
  if (!endedSession || xrSession !== endedSession) return;

  renderer.setAnimationLoop(null);

  if (hitTestSource) {
    try {
      hitTestSource.cancel();
    } catch (error) {
      console.warn(
        "Hit-test source cleanup failed:",
        error
      );
    }
  }

  hitTestSource = null;

  for (const record of [...placedProducts]) {
    removeProduct(record);
  }

  xrSession = null;
  localSpace = null;

  placeRequested = false;
  anchorsEnabled = false;
  trackingLost = false;

  resetCurrentHit();

  trackingElement.style.display = "none";

  startButton.disabled = !arSupported;
  startButton.textContent =
    arSupported ? "START AR" : "AR unavailable";

  updateOverlay();
}

function updateOverlay() {
  if (!statusElement) return;

  let reticleState = "none";

  if (currentSurfaceAngle !== null) {
    reticleState =
      `${currentSurfaceValid ? "valid" : "too tilted"} ` +
      `(${currentSurfaceAngle.toFixed(1)}°, ` +
      `limit ${SURFACE_TOLERANCE_DEG}°)`;
  }

  const sessionState =
    xrSession ? "active" : "not active";

  const anchorState =
    xrSession
      ? (anchorsEnabled ? "on" : "off")
      : "not in session";

  const visibleReticleState =
    trackingLost ? "tracking lost" : reticleState;

  statusElement.textContent =
    `Student ID: ${STUDENT_ID} | Variant: ${VARIANT}\n` +
    `Session: ${sessionState}\n` +
    `Reticle: ${visibleReticleState}\n` +
    `Anchors: ${anchorState}\n` +
    `Products: ${placedProducts.length}/${MAX_PRODUCTS}`;
}