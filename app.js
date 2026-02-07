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
const nextPoseEl = document.getElementById("nextPose");
const currentAudioEl = document.getElementById("currentAudio");
const audioRemainingEl = document.getElementById("audioRemaining");
const speedSlowBtn = document.getElementById("speedSlowBtn");
const speedNormalBtn = document.getElementById("speedNormalBtn");
const speedFastBtn = document.getElementById("speedFastBtn");
const speedSuperFastBtn = document.getElementById("speedSuperFastBtn");
const speedStatusEl = document.getElementById("speedStatus");
labelContainer = document.getElementById("label-container");

// --- Stable-class settings ---
const BASE_STABLE_SECONDS = 5.0; // must persist this long
const PROB_THRESHOLD = 0.85;     // "valid" if >= this confidence
const TOPK = 1;                  // use top-1 class
let speedMultiplier = 1.0;

function getStableSeconds() {
  return BASE_STABLE_SECONDS / speedMultiplier;
}

function renderStableRule() {
  stableRuleEl.textContent =
    `Updates when top-${TOPK} class stays ≥ ${PROB_THRESHOLD} for ${getStableSeconds().toFixed(1)}s`;
}

function renderSpeedStatus() {
  speedStatusEl.textContent = `${speedMultiplier.toFixed(1)}x`;
}

function applySpeed(multiplier) {
  speedMultiplier = multiplier;
  audioPlayer.playbackRate = speedMultiplier;
  renderStableRule();
  renderSpeedStatus();
}

renderStableRule();
renderSpeedStatus();

// Stable state
let stableLabel = "—";
let candidateLabel = null;
let candidateSinceMs = 0;

// Audio sequence logic
const POSE_SEQUENCE = ["Oben", "Links", "Rechts"];
let sequenceIndex = 0;
let audioPlaying = false;
let waitingForPose = false;
let poseTimeoutId = null;
let poseTimeoutDeadlineMs = null;
let poseCountdownTimerId = null;
let audioUiTimerId = null;

const BASE_POSE_TIMEOUT_MS = 15000; // 15s Timeout

function getPoseTimeoutMs() {
  return BASE_POSE_TIMEOUT_MS / speedMultiplier;
}

// --- Audio setup ---
const AUDIO_MAP = {
  "Oben": "./audio/oben.mp3",
  "Links": "./audio/links.mp3",
  "Rechts": "./audio/rechts.mp3",
};

const audioPlayer = new Audio();
audioPlayer.preload = "auto";

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  return `${seconds.toFixed(1)} s`;
}

function getFileNameFromSrc(src) {
  if (!src) return "—";
  try {
    const url = new URL(src, window.location.href);
    return url.pathname.split("/").pop() || src;
  } catch {
    return src;
  }
}

function clearAudioUiTimer() {
  if (!audioUiTimerId) return;
  clearInterval(audioUiTimerId);
  audioUiTimerId = null;
}

function updateAudioPlaybackUi() {
  if (!audioPlaying) {
    currentAudioEl.textContent = "—";
    audioRemainingEl.textContent = "—";
    return;
  }

  currentAudioEl.textContent = getFileNameFromSrc(audioPlayer.currentSrc || audioPlayer.src);
  if (!Number.isFinite(audioPlayer.duration)) {
    audioRemainingEl.textContent = "loading...";
    return;
  }

  const remaining = Math.max(0, audioPlayer.duration - audioPlayer.currentTime);
  audioRemainingEl.textContent = formatSeconds(remaining);
}

function startAudioUiTimer() {
  clearAudioUiTimer();
  audioUiTimerId = setInterval(updateAudioPlaybackUi, 200);
}

audioPlayer.addEventListener("ended", () => {
  audioPlaying = false;
  clearAudioUiTimer();
  updateAudioPlaybackUi();
  waitingForPose = true;
  renderNextExpectedPose();
  // Start timeout for next pose
  if (poseTimeoutId) clearTimeout(poseTimeoutId);
  poseTimeoutDeadlineMs = performance.now() + getPoseTimeoutMs();
  poseTimeoutId = setTimeout(() => {
    resetSequence();
  }, getPoseTimeoutMs());
  startPoseCountdownTimer();
});

function getNextExpectedPoseText() {
  if (!running || sequenceIndex >= POSE_SEQUENCE.length) return "—";
  return POSE_SEQUENCE[sequenceIndex];
}

function renderNextExpectedPose() {
  const base = getNextExpectedPoseText();
  if (waitingForPose && poseTimeoutDeadlineMs) {
    const remainingMs = Math.max(0, poseTimeoutDeadlineMs - performance.now());
    nextPoseEl.textContent = `${base} (Timeout in ${formatSeconds(remainingMs / 1000)})`;
  } else {
    nextPoseEl.textContent = base;
  }
}

function clearPoseCountdownTimer() {
  if (!poseCountdownTimerId) return;
  clearInterval(poseCountdownTimerId);
  poseCountdownTimerId = null;
}

function startPoseCountdownTimer() {
  clearPoseCountdownTimer();
  poseCountdownTimerId = setInterval(renderNextExpectedPose, 200);
}

function resetSequence() {
  sequenceIndex = 0;
  waitingForPose = running;
  audioPlaying = false;
  stableLabel = "—";
  stableClassEl.textContent = stableLabel;
  renderNextExpectedPose();
  if (poseTimeoutId) clearTimeout(poseTimeoutId);
  poseTimeoutId = null;
  poseTimeoutDeadlineMs = null;
  clearPoseCountdownTimer();
}

// Buttons
startBtn.addEventListener("click", () => {
//   playAudioForClass("test"); // Audio erst nach User-Interaktion
  init();
});
stopBtn.addEventListener("click", () => {
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  stop();
});
speedSlowBtn.addEventListener("click", () => applySpeed(0.8));
speedNormalBtn.addEventListener("click", () => applySpeed(1.0));
speedFastBtn.addEventListener("click", () => applySpeed(1.3));
speedSuperFastBtn.addEventListener("click", () => applySpeed(3.0));

let lastPlayedClass = null;

function playAudioForClass(className) {
  const src = AUDIO_MAP[className];
  if (!src) {
    // Fallback: if no audio file exists, still allow pose matching to continue.
    waitingForPose = true;
    audioPlaying = false;
    clearAudioUiTimer();
    updateAudioPlaybackUi();
    return;
  }
  if (audioPlaying) return;
  lastPlayedClass = className;
  audioPlayer.src = src;
  audioPlayer.currentTime = 0;
  audioPlayer.playbackRate = speedMultiplier;
  audioPlaying = true;
  waitingForPose = false;
  updateAudioPlaybackUi();
  startAudioUiTimer();
  audioPlayer.play().catch((err) => {
    console.warn("Audio konnte nicht abgespielt werden (Autoplay/Permission):", err);
    audioPlaying = false;
    clearAudioUiTimer();
    updateAudioPlaybackUi();
  });
}

// playAudioForClass("test"); // initialer Aufruf entfernt, Autoplay-Block

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
  sequenceIndex = 0;
  waitingForPose = true;
  audioPlaying = false;
  if (poseTimeoutId) clearTimeout(poseTimeoutId);
  renderNextExpectedPose();

  // Start loop
  rafId = window.requestAnimationFrame(loop);
}

function stop() {
  running = false;
  audioPlaying = false;
  waitingForPose = false;
  clearAudioUiTimer();
  clearPoseCountdownTimer();
  updateAudioPlaybackUi();

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
  renderNextExpectedPose();
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

  // Nur die erwartete Pose in der Sequenz zählt
  const expectedPose = POSE_SEQUENCE[sequenceIndex];

  if (!valid || !audioPlaying && !waitingForPose) {
    candidateLabel = null;
    candidateSinceMs = 0;
    return;
  }

  if (candidateLabel !== className) {
    candidateLabel = className;
    candidateSinceMs = nowMs;
    return;
  }

  const heldForMs = nowMs - candidateSinceMs;
  // Während Audio läuft, keine Pose-Wechsel
  if (audioPlaying) return;

  // Nach Audio: Nur die richtige Pose zählt
  if (waitingForPose && className === expectedPose && heldForMs >= getStableSeconds() * 1000) {
    stableLabel = className;
    stableClassEl.textContent = stableLabel;
    waitingForPose = false;
    if (poseTimeoutId) clearTimeout(poseTimeoutId);
    poseTimeoutId = null;
    poseTimeoutDeadlineMs = null;
    clearPoseCountdownTimer();
    // Spiele die Audio zur erkannten Pose (nicht zur nächsten)
    playAudioForClass(className);
    // Danach zur nächsten erwarteten Pose wechseln
    sequenceIndex++;
    renderNextExpectedPose();
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
