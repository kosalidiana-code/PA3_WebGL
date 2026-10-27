# PA3 — Augmented Reality Website with Hit-Testing

## Student Information

- Student ID: 241629
- Product variant: Standing Desk
- Device used for testing: Samsung Galaxy A35 5G
- Browser: Google Chrome for Android
- Browser version: [Enter the version shown in Chrome Settings → About Chrome]

## Variant Parameters

The project uses the personal variant assigned to Student ID 241629.

- Product: Standing desk
- Tabletop dimensions: 1.40 m wide × 0.70 m deep
- Tabletop height: 1.10 m
- Placement mode: Multi
- Maximum number of products: 5
- Surface tolerance: 8 degrees from world up
- Facing rule: Preserve the hit-pose orientation

When a sixth product is placed, the oldest product should be removed.

## Technologies

- HTML and CSS
- JavaScript ES modules
- Three.js 0.186.1
- WebXR Device API
- WebXR Hit Test module
- WebXR Anchors module when available

The project does not use ARButton, A-Frame, external 3D model files, or third-party AR frameworks.

## How to Run

### Local Development

1. Open the project folder in Visual Studio Code.
2. Start the page using Live Server.
3. Open the page in a compatible browser and AR-capable device.
4. Allow the required camera and AR permissions.
5. Press START AR to begin the session.

### Online Deployment

The project can be hosted using GitHub Pages.

The published website must use HTTPS. The repository must contain `index.html` and `index.js` in the appropriate published directory.

## Controls

- START AR: Start an immersive AR session.
- STOP AR: End the active AR session.
- Clear: Remove all placed products and delete their anchors.
- Tap or select: Request placement at the current valid hit-test location.

A green reticle means that placement is allowed. A red reticle means that the detected surface exceeds the allowed tilt angle.

## Porting Notes

### 1. WebGLRenderer Constructor

The older Chapter 7 example creates a WebGL context manually and passes it to `THREE.WebGLRenderer`.

This project lets Three.js 0.186.1 create and manage its rendering context. This avoids using the outdated context setup from the book's example.

### 2. Geometry Constructors

The project uses the current `THREE.BoxGeometry` and `THREE.RingGeometry` constructors for the product and reticle.

These replace the older geometry constructor names used in the original Chapter 7 example.

### 3. Hit-Test Source Lifecycle

The viewer reference space and hit-test source are requested once when the AR session starts.

The same hit-test source is reused in the render loop through `frame.getHitTestResults(hitTestSource)`. It is cancelled when the session ends.

This avoids creating a new hit-test source on every frame.

## Product Model and Scale

The standing desk is constructed from Three.js box primitives grouped into one `THREE.Group`.

Its intended dimensions are approximately:

- X: 1.40 m
- Y: 1.10 m
- Z: 0.70 m

The project measures the model using `THREE.Box3().setFromObject(product).getSize(...)`. The console output should be checked to confirm that each dimension is within ±2 cm of the assignment requirements.

The scene uses a hemisphere light and a directional light with `MeshStandardMaterial`.

## Testing

Device used: Samsung Galaxy A35 5G.

Observed during testing:
- The immersive AR camera view opened.
- Green and red reticle states were observed.
- The Clear button was tapped.
- Camera performance was laggy during the test.

Additional checks should confirm:
- Product placement on a valid surface.
- The five-product limit and removal of the oldest product.
- Anchor creation, tracking, and deletion when anchors are available.
- Clear removes every placed product.
- STOP AR and system-driven session termination reset the application.
- A new AR session can be started after the previous session ends.
- Tracking loss blocks product placement.

Only record a test as successful after observing the result on the device.

## Submission Checklist

- [ ] Confirm the product dimensions in the browser console.
- [ ] Test product placement and the multi-placement limit.
- [ ] Test Clear, STOP AR, and restarting the AR session.
- [ ] Record the required 45–90 second device demonstration.
- [ ] Include screenshots and actual measurements in the English write-up.
- [ ] Complete the E1–E6 sections and the development log.
- [ ] Make at least five meaningful PA3 commits across at least two different days.
- [ ] Include `index.html`, `index.js`, `README.md`, `writeup.pdf`, and `demo.mp4` in the submission ZIP.
- [ ] Ensure the ZIP matches the final committed project.

## Files

- `index.html` — Page structure and AR controls.
- `index.js` — Three.js scene, WebXR lifecycle, hit testing, product placement, anchors, and status overlay.
- `README.md` — Variant parameters, setup instructions, porting notes, and testing record.
- `writeup.pdf` — E1–E6 explanations and development log.
- `demo.mp4` — Required AR demonstration recorded on the device.
