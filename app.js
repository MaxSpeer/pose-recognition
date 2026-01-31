// Teachable Machine Pose model folder (relative to index.html)
const URL = "./my_model/";

// Webcam/model
let model, webcam, ctx, labelContainer, maxPredictions;
let rafId = null;
let running = false;

// Canvas
const canvas = document.getElementById("canvas");
ctx = canvas.getContext("2d");

// UI
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const liveClassEl = document.getElementById("liveClass");
const liveConfEl = document.getElementById("liveConf");
const stableClassEl = document.getElementById("stableClass");
const stableRuleEl = document.getElementById("stableRule");
labelContainer = document.getElementById("label-container");

// --- Stable-class settings ---
const STABLE_SECONDS = 2.0;      // must persist this long
const PROB_THRESHOLD = 0.85;     // "valid" if >= this confidence
const TOPK = 1;                  // use top-1 class

stableRuleEl.textContent =
  `Updates when top-${TOPK} class stays ≥ ${PROB_THRESHOLD} for ${STABLE_SECONDS.toFixed(1)}s`;

// Stable state
let stableLabel = "—";
let candidateLabel = null;
let candidateSinceMs = 0;

// Buttons
startBtn.addEventListener("click", init);
stopBtn.addEventListener("click", stop);

async function init() {
  if (running) return;
  running = true;

  startBtn.disabled = true;
  stopBtn.disabled = false;

  const modelURL = URL + "model.json";
  const metadataURL = URL + "metadata.json";

  // Load model + metadata
  model = await window.tmPose.load(modelURL, metadataURL);
  maxPredictions = model.getTotalClasses();

  // Setup webcam
  const size = 320;
  const flip = true;
  webcam = new window.tmPose.Webcam(size, size, flip);

  await webcam.setup(); // prompts camera permission
  await webcam.play();

  // Match canvas to webcam
  canvas.width = size;
  canvas.height = size;

  // Setup label list UI
  labelContainer.innerHTML = "";
  for (let i = 0; i < maxPredictions; i++) {
    labelContainer.appendChild(document.createElement("div"));
  }

  // Reset stable logic
  stableLabel = "—";
  candidateLabel = null;
  candidateSinceMs = 0;
  stableClassEl.textContent = stableLabel;

  // Start loop
  rafId = window.requestAnimationFrame(loop);
}

function stop() {
  running = false;

  startBtn.disabled = false;
  stopBtn.disabled = true;

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (webcam) {
    // tmPose webcam wraps a <video>; stop tracks to release camera
    const stream = webcam.webcam; // underlying video element
    if (stream && stream.srcObject) {
      stream.srcObject.getTracks().forEach((t) => t.stop());
      stream.srcObject = null;
    }
  }

  liveClassEl.textContent = "—";
  liveConfEl.textContent = "—";
}

async function loop() {
  if (!running) return;

  webcam.update();
  await predict();

  rafId = window.requestAnimationFrame(loop);
}

async function predict() {
  // 1) Pose estimation
  const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);

  // 2) Classification
  const prediction = await model.predict(posenetOutput);

  // Render all class probabilities
  for (let i = 0; i < maxPredictions; i++) {
    const p = prediction[i];
    labelContainer.childNodes[i].textContent =
      `${p.className}: ${p.probability.toFixed(2)}`;
  }

  // Find top prediction
  const top = getTopPrediction(prediction);
  const nowMs = performance.now();

  liveClassEl.textContent = top.className;
  liveConfEl.textContent = top.probability.toFixed(2);

  updateStableClass(top.className, top.probability, nowMs);

  drawPose(pose);
}

function getTopPrediction(predictionArr) {
  let best = predictionArr[0];
  for (const p of predictionArr) {
    if (p.probability > best.probability) best = p;
  }
  return best;
}

/**
 * Stable class logic:
 * - Only consider a class "valid" if probability >= PROB_THRESHOLD
 * - If the top class stays the same and valid for STABLE_SECONDS, it becomes stableLabel
 * - Otherwise stableLabel stays unchanged (reduces flakiness)
 */
function updateStableClass(className, prob, nowMs) {
  const valid = prob >= PROB_THRESHOLD;

  if (!valid) {
    // Don’t advance candidate timer when confidence is low
    candidateLabel = null;
    candidateSinceMs = 0;
    return;
  }

  if (candidateLabel !== className) {
    // New candidate starts now
    candidateLabel = className;
    candidateSinceMs = nowMs;
    return;
  }

  const heldForMs = nowMs - candidateSinceMs;
  if (heldForMs >= STABLE_SECONDS * 1000 && stableLabel !== className) {
    stableLabel = className;
    stableClassEl.textContent = stableLabel;
  }
}

function drawPose(pose) {
  if (!webcam?.canvas) return;

  ctx.drawImage(webcam.canvas, 0, 0);

  if (pose) {
    const minPartConfidence = 0.5;
    window.tmPose.drawKeypoints(pose.keypoints, minPartConfidence, ctx);
    window.tmPose.drawSkeleton(pose.keypoints, minPartConfidence, ctx);
  }
}
