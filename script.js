/* =====================================================================
   Bird Maze — 摄像头手势控制小鸟迷宫
   ---------------------------------------------------------------------
   核心思路：
   1. 摄像头视频 → MediaPipe Gesture Recognizer（老师提供的
      gesture_recognizer.task）识别「握拳 / Closed_Fist」；
   2. 握拳后跟随手掌的实际移动方向和速度，手停则停止；
      松拳后可以自由调整手的位置，再握拳继续移动；
   3. MediaPipe Face Landmarker 识别人脸关键点，用上下嘴唇距离判断
      「张嘴 / 闭嘴」；完成一次 张嘴 → 闭嘴 且小鸟离水果足够近，
      才算吃到水果；
   4. 简单模式：碰墙挡住移动，可沿墙滑动；5 次生命，持续贴墙不会重复扣命。
   5. 到达出口 = 胜利。
   全程在浏览器本地处理，摄像头画面不上传任何服务器。
   ===================================================================== */
"use strict";

/* =====================================================================
   1. 配置参数（想调节手感，改这里即可）
   ===================================================================== */
const CONFIG = {
  // ---- 摄像头 / 显示 ----
  MIRROR_VIDEO: true,        // 摄像头画面按「镜子」方式显示；左右控制方向会自动适配

  // ---- 手部移动控制 ----
  HAND_DEAD_ZONE: 0.001,    // 相邻识别帧的小幅抖动过滤
  HAND_MOVEMENT_GAIN: 1100, // 手掌归一化位移 → 游戏像素，按识别间隔换算速度
  BIRD_MAX_SPEED: 120,       // 手势最大速度（像素/秒）
  MANUAL_SPEED: 100,         // 提高键盘 / 触控速度，避免移动迟缓
  VELOCITY_SMOOTHING: 0.30,  // 速度平滑系数（0~1，越小越平滑）
  HAND_SMOOTHING: 0.55,      // 拳头中心平滑系数（越小越抗抖，但反应越慢）

  // ---- 小鸟 ----
  BIRD_RADIUS: 8,            // 更小的碰撞范围，转弯更宽容
  START_LIVES: 5,            // 撞墙容错次数
  WALL_GRACE_SECONDS: 2,     // 撞墙后保护时间

  // ---- 水果 ----
  EAT_DISTANCE: 50,          // 放宽吃水果距离

  // ---- 嘴部识别 ----
  MOUTH_OPEN_THRESHOLD: 0.055,   // 嘴高/脸高 比例超过该值 → 判定张嘴
  MOUTH_CLOSED_THRESHOLD: 0.04,  // 比例低于该值 → 判定闭嘴（两个阈值之间为滞回区）

  // ---- 手势识别 ----
  GESTURE_MIN_SCORE: 0.55,   // 手势类别最低置信度
  TRACK_FPS: 30,             // AI 识别帧率上限（节流，避免太吃性能）
  USE_CPU_ONLY: false,        // 调为 true 可关闭 GPU 加速（GPU 报错时切换到 CPU 推理）

  // ---- 模型路径（与 index.html 同级，离线可用）----
  GESTURE_MODEL: "gesture_recognizer.task",
  FACE_MODEL: "face_landmarker.task",
  // 人脸模型 CDN 兜底（本地文件丢失时自动使用）
  FACE_MODEL_FALLBACK: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
  // MediaPipe WASM 运行库回退：jsdelivr（有 CORS 头，国内可用）→ unpkg → npmmirror
  MEDIAPIPE_WASM_URL: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  MEDIAPIPE_WASM_NPM: "https://unpkg.com/@mediapipe/tasks-vision@0.10.14/wasm",
  MEDIAPIPE_WASM_FALLBACK: "https://registry.npmmirror.com/@mediapipe/tasks-vision/0.10.14/files/wasm",
};

/* =====================================================================
   2. 迷宫数据
   外圈墙与迷宫外区域均为边界；碰墙停住，生命耗尽才结束。
   起点 S(1,1) → 出口 E(13,20)，8 个水果位于可行走格子。
   ===================================================================== */
const MAZE_MAP = [
  "######################",
  "#S#         #        #",
  "# # ##### # ### #### #",
  "# # # #   #   #      #",
  "# # # # ##### # ###  #",
  "# #   # #   # #   #  #",
  "# ##### # ### # ###  #",
  "#   #   #     # #    #",
  "### # ##### ##### #  #",
  "#   #     #       #  #",
  "# ####### #########  #",
  "#   #     #   #      #",
  "### # ##### # # #### #",
  "#     #     #       E#",
  "######################",
];

// 水果位置 [行, 列]（全部在可行走格子上，已校验）
const FRUIT_POSITIONS = [
  [9, 3], [13, 3], [9, 9], [5, 7],
  [1, 11], [7, 11], [7, 17], [11, 17],
];

// 水果贴图（已上传到 Cloudinary CDN）
const FRUIT_CDN = "https://res.cloudinary.com/kjd0jh3m/image/upload/v1792315516/";
const FRUIT_FILES = ["apple", "banana", "caomei", "chengzi", "putao"];
const FRUIT_IMAGES = FRUIT_FILES.map((n) => {
  const im = new Image();
  im.src = FRUIT_CDN + n + ".webp";
  return im;
});

const EXIT_POS = [13, 20]; // 出口格子（行, 列）：右下角紧贴右墙

/* =====================================================================
   3. 画布 / 网格常量
   ===================================================================== */
const COLS = MAZE_MAP[0].length; // 22
const ROWS = MAZE_MAP.length;    // 15
const CELL = 40;                 // 每格像素（canvas 880 x 600 = 22x15 格）

const GRID = MAZE_MAP.map((row) => row.split("")); // 字符网格，用于碰撞检测

const gameCanvas = document.getElementById("gameCanvas");
const ctx = gameCanvas.getContext("2d");
gameCanvas.width = COLS * CELL;
gameCanvas.height = ROWS * CELL;

const CAM_W = 320, CAM_H = 240;
const cameraCanvas = document.getElementById("cameraCanvas");
const camCtx = cameraCanvas.getContext("2d");

// 小鸟贴图（img 文件夹里的 fly R）
const birdImg = new Image();
birdImg.src = "https://res.cloudinary.com/kjd0jh3m/image/upload/v1792315516/fly_R.webp";

/* =====================================================================
   4. DOM 元素
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const menuScreen = $("menuScreen");
const loadingScreen = $("loadingScreen");
const permissionScreen = $("permissionScreen");
const gameOverScreen = $("gameOverScreen");
const winScreen = $("winScreen");
const loadingTitle = $("loadingTitle");
const loadingDetail = $("loadingDetail");
const scoreEl = $("score");
const overScoreEl = $("overScore");
const winScoreEl = $("winScore");
const chipCam = $("chipCam");
const chipAi = $("chipAi");
const chipHand = $("chipHand");
const chipGesture = $("chipGesture");
const chipMouth = $("chipMouth");
const chipControl = $("chipControl");
const debugLine = $("debugLine");
const camStatusDot = $("camStatusDot");
const camStatusText = $("camStatusText");
const cameraPanel = $("cameraPanel");
const video = $("camVideo");

/* =====================================================================
   5. 全局状态
   ===================================================================== */
const state = {
  hasActiveGame: false,   // 暂停或切换失败时仍保留当前局
  inputMode: "gesture",   // gesture / manual
  mode: "MENU",          // MENU / LOADING / WAITING / PLAYING / SWITCHING / ERROR / GAME_OVER / WIN
  cameraOk: false,
  camStatus: "--",
  aiReady: false,
  aiError: "",

  // 识别结果
  handSeen: false,
  handLandmarks: null,   // 21 个手部关键点（本次识别）
  handUpdated: false,    // 是否有新的识别数据到达（AI 30fps / 渲染 60fps+，对齐用）
  isFist: false,
  gestureLabel: "NONE",
  gestureConf: 0,

  faceSeen: false,
  faceLandmarks: null,   // 468 个人脸关键点
  mouthState: "closed",  // open / closed
  mouthLabel: "--",
  mouthWasOpened: false, // 张嘴 → 闭嘴 状态机标记
  mar: 0,                // 嘴高/脸高 比例（调试用）

  controlActive: false,
  waitingForPlayer: false,
  waitStart: 0,

  score: 0,
  lives: CONFIG.START_LIVES,
  wallGrace: 0,
  wallHitPosition: null,
  fruits: [],
  birdDead: false,
  chewTimer: 0,
  shakeTime: 0,
  effects: { particles: [], floatTexts: [] },
};

/* 小鸟对象 */
const bird = { x: 0, y: 0, vx: 0, vy: 0 };

/* 手部运动追踪：比较相邻识别帧的真实位移。 */
const hand = {
  baselined: false, // 是否已经建立基准（握拳刚出现的第一帧只建基准，不产生位移）
  sx: 0, sy: 0,     // 平滑后的拳头中心（归一化 0~1）
  px: 0, py: 0,     // 上一次识别到的拳头中心
  sampleTime: 0,    // 上一次位置采样时间，避免识别帧率改变移动手感
  dxRaw: 0, dyRaw: 0, // 相邻帧位移（调试用）
  tvx: 0, tvy: 0,   // 当前目标速度（px/s），新识别帧刷新，渲染帧复用
};

/* MediaPipe 模型实例 */
let vision = null;          // FilesetResolver 返回的命名空间
let gestureRecognizer = null;
let faceLandmarker = null;
let lastVideoTime = -1;
let lastTrackingAt = 0;
let resultOverlayTimer = null;
let controlSwitchVersion = 0;
const manualInput = { pointers: new Map(), keys: new Set() };
const keyDirections = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};

function resetManualInput() {
  manualInput.pointers.clear();
  manualInput.keys.clear();
  document.querySelectorAll("[data-direction]").forEach((button) => button.classList.remove("pressed"));
  stopControl();
}

function startManualGame() {
  if (!["MENU", "ERROR"].includes(state.mode)) return;
  initAudio();
  releaseCamera();
  if (state.hasActiveGame) {
    resumeWithInput("manual");
    return;
  }
  state.inputMode = "manual";
  $("manualControls").hidden = false;
  cameraPanel.classList.add("hidden");
  $("toggleCameraBtn").setAttribute("aria-expanded", "false");
  beginGame();
}

function updateManualMotion() {
  const directions = new Set([...manualInput.pointers.values(), ...[...manualInput.keys].map((key) => keyDirections[key])]);
  const x = Number(directions.has("right")) - Number(directions.has("left"));
  const y = Number(directions.has("down")) - Number(directions.has("up"));
  const length = Math.hypot(x, y);
  if (!length) { stopControl(); return; }
  state.controlActive = true;
  // 触屏上的通道较窄，较低速度便于准确转弯，斜向保持同样速度。
  hand.tvx = x / length * CONFIG.MANUAL_SPEED;
  hand.tvy = y / length * CONFIG.MANUAL_SPEED;
}

/** 清除过期的控制输入，避免丢失识别后继续移动。 */
function stopControl() {
  state.controlActive = false;
  state.handUpdated = false;
  hand.baselined = false;
  hand.tvx = hand.tvy = hand.dxRaw = hand.dyRaw = 0;
  bird.vx = bird.vy = 0;
}

function clearTracking() {
  stopControl();
  state.handSeen = state.isFist = state.faceSeen = false;
  state.handLandmarks = state.faceLandmarks = null;
  state.gestureLabel = "NONE";
  state.gestureConf = 0;
  state.mouthState = "closed";
  state.mouthWasOpened = false;
  state.mouthLabel = "--";
  state.mar = 0;
}

function releaseCamera() {
  state.cameraOk = false;
  const stream = video.srcObject;
  video.srcObject = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  state.camStatus = "Stopped";
  setCamDot("dot-gray");
  clearTracking();
}

/* 音效 */
let audioCtx = null;

/* =====================================================================
   6. 音效（Web Audio API 生成，无需外部音频文件）
   ===================================================================== */
function initAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

/** 播放一个简单音符 */
function tone(freq, dur, type, gain, delay = 0) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** 音效文件（已上传到 Cloudinary CDN）；加载失败时自动回退到合成音 */
const SFX_FILES = {
  eat: "https://res.cloudinary.com/kjd0jh3m/video/upload/v1792316004/eat.mp3",
  hit: "https://res.cloudinary.com/kjd0jh3m/video/upload/v1792316005/hit.mp3",
  win: "https://res.cloudinary.com/kjd0jh3m/video/upload/v1792316005/win.mp3",
};
const SFX_AUDIO = {};
for (const k of Object.keys(SFX_FILES)) {
  SFX_AUDIO[k] = new Audio(SFX_FILES[k]);
  SFX_AUDIO[k].volume = 0.6;
}

/** 播放游戏音效：eat 吃水果 / hit 撞墙 / win 胜利 / start 开始 */
function playSound(name) {
  // 优先播放真实音效文件
  if (SFX_AUDIO[name]) {
    try {
      const a = SFX_AUDIO[name];
      a.currentTime = 0;
      a.play().catch(() => playSynth(name)); // 播放失败（如未授权）用合成音兜底
      return;
    } catch { /* 落到合成音 */ }
  }
  playSynth(name);
}

/** 合成音效兜底（Web Audio API 实时生成） */
function playSynth(name) {
  if (!audioCtx) return;
  switch (name) {
    case "eat": // 轻快的上升音
      tone(520, 0.09, "sine", 0.22);
      tone(760, 0.12, "sine", 0.22, 0.07);
      tone(1040, 0.10, "sine", 0.16, 0.14);
      break;
    case "hit": { // 低沉撞击 + 噪声
      tone(150, 0.28, "sawtooth", 0.4);
      const len = audioCtx.sampleRate * 0.18;
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const g = audioCtx.createGain();
      g.gain.value = 0.35;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      src.connect(filter).connect(g).connect(audioCtx.destination);
      src.start();
      break;
    }
    case "win": // 上行琶音
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "triangle", 0.25, i * 0.13));
      break;
    case "start": // 开始提示
      tone(660, 0.1, "sine", 0.2);
      tone(990, 0.14, "sine", 0.2, 0.1);
      break;
  }
}

/* =====================================================================
   7. 摄像头初始化
   ===================================================================== */
async function initializeCamera() {
  if (state.cameraOk) return true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("浏览器无法访问摄像头，请使用 localhost 或 HTTPS 地址打开页面");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 }, height: { ideal: 480 },
        facingMode: "user", frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    lastVideoTime = -1;
    lastTrackingAt = performance.now();
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        controlSwitchVersion++;
        releaseCamera();
        state.mode = "ERROR";
        state.waitingForPlayer = false;
        hideAllOverlays();
        permissionScreen.querySelector("h2").textContent = "摄像头已断开";
        permissionScreen.querySelector(".sub").textContent = "请重新连接摄像头并重新加载页面。";
        showOverlay(permissionScreen);
      }, { once: true });
    }
    state.cameraOk = true;
    state.camStatus = "Active";
    return true;
  } catch (err) {
    releaseCamera();
    console.error("摄像头初始化失败:", err);
    state.cameraOk = false;
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      state.camStatus = "NoCamera";
      permissionScreen.querySelector(".sub").innerHTML =
        "未检测到摄像头。<br>请连接摄像头后重新加载页面。";
    } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      state.camStatus = "Denied";
      permissionScreen.querySelector(".sub").innerHTML =
        "Camera permission is required to play this game.<br>Please allow camera access and reload the page.";
    } else {
      state.camStatus = "Error";
      permissionScreen.querySelector(".sub").innerHTML =
        "摄像头启动失败：" + escapeHtml(describeError(err)) +
        "<br>电脑本机可用 localhost；手机和平板访问部署页面时请使用 HTTPS，并在浏览器设置中允许摄像头。";
    }
    return false;
  }
}

/* =====================================================================
   8. AI 模型加载（手势识别 + 人脸关键点）
   ===================================================================== */
/** 等待 index.html 中的 ESM 模块把 MediaPipe 类挂载到 window.__mp */
function waitForMediaPipe(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (window.__mp) return resolve(window.__mp);
      if (window.__mpError) {
        return reject(new Error("MediaPipe 运行库加载失败：" + window.__mpError));
      }
      if (Date.now() - t0 > timeoutMs) {
        return reject(new Error("MediaPipe 运行库加载超时，请检查网络后重试"));
      }
      setTimeout(poll, 100);
    })();
  });
}

async function initializeAI() {
  if (state.aiReady) return;
  state.aiError = "";
  try {
    const mp = await waitForMediaPipe();

    loadingDetail.textContent = "加载 MediaPipe WASM 运行库…";
    // 按配置顺序尝试三个 CDN 来源。
    const wasmSources = [CONFIG.MEDIAPIPE_WASM_URL, CONFIG.MEDIAPIPE_WASM_NPM, CONFIG.MEDIAPIPE_WASM_FALLBACK];
    let wasmOk = false;
    for (const base of wasmSources) {
      try {
        vision = await mp.FilesetResolver.forVisionTasks(base);
        wasmOk = true;
        break;
      } catch (eWasm) {
        console.warn("WASM 运行库加载失败，换下一个来源:", base, eWasm);
      }
    }
    if (!wasmOk) throw new Error("WASM 运行库三个 CDN 来源都加载失败");

    loadingDetail.textContent = "加载手势识别模型 gesture_recognizer.task…";
    await ensureModelFile(CONFIG.GESTURE_MODEL);
    try {
      gestureRecognizer = await createGestureRecognizer(mp);
    } catch (e) {
      console.error("手势模型创建失败:", e);
      throw new Error("手势模型加载失败：" + describeError(e));
    }

    loadingDetail.textContent = "加载人脸关键点模型 face_landmarker.task…";
    try {
      faceLandmarker = await createFaceLandmarker(mp);
    } catch (e) {
      console.error("人脸模型创建失败:", e);
      throw new Error("人脸模型加载失败：" + describeError(e));
    }

    state.aiReady = true;
    console.log("AI 模型加载完成 ✅（手势识别 + 人脸关键点）");
  } catch (err) {
    gestureRecognizer?.close();
    faceLandmarker?.close();
    gestureRecognizer = faceLandmarker = null;
    state.aiReady = false;
    console.error("AI 模型加载失败:", err);
    state.aiError = String(err.message || err);
    throw err;
  }
}

/** 把各种异常对象（Error / Event / EventTarget）转成可读字符串 */
function describeError(e) {
  if (!e) return String(e);
  const parts = [];
  if (e.name) parts.push(e.name);
  if (e.message) parts.push(e.message);
  if (e.type) parts.push("type=" + e.type);
  if (e.target && e.target.status) parts.push("HTTP " + e.target.status);
  if (e.detail) parts.push("detail=" + JSON.stringify(e.detail));
  return parts.length ? parts.join(" | ") : String(e);
}

/** 预先确认模型文件能被 HTTP 访问，把模糊的 fetch 错误变成明确的 404/500 */
async function ensureModelFile(path) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let r;
    try {
      r = await fetch(path, { method: "HEAD", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
  } catch (e) {
    throw new Error("文件 " + path + " 无法访问（" + describeError(e) + "）");
  }
}

/** 手势识别：GPU 优先，失败自动回退 CPU */
async function createGestureRecognizer(mp) {
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: CONFIG.GESTURE_MODEL, delegate },
    runningMode: "VIDEO",
    numHands: 1,
  });
  if (CONFIG.USE_CPU_ONLY) {
    return await mp.GestureRecognizer.createFromOptions(vision, opts("CPU"));
  }
  try {
    return await mp.GestureRecognizer.createFromOptions(vision, opts("GPU"));
  } catch (e) {
    console.warn("手势识别 GPU 推理失败，回退 CPU:", describeError(e));
    return await mp.GestureRecognizer.createFromOptions(vision, opts("CPU"));
  }
}

/** 人脸关键点：优先本地模型文件，失败自动用 CDN 兜底 */
async function createFaceLandmarker(mp) {
  const opts = (modelPath, delegate) => ({
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
  });
  for (const delegate of CONFIG.USE_CPU_ONLY ? ["CPU"] : ["GPU", "CPU"]) {
    try {
      return await mp.FaceLandmarker.createFromOptions(vision, opts(CONFIG.FACE_MODEL, delegate));
    } catch (e) {
      console.warn("本地人脸模型加载失败:", delegate, describeError(e));
    }
  }
  return await mp.FaceLandmarker.createFromOptions(
    vision, opts(CONFIG.FACE_MODEL_FALLBACK, "CPU"));
}

/* =====================================================================
   9. 手势识别：判断是否握拳（Closed_Fist）
   ===================================================================== */
/** 每帧识别回调：把 MediaPipe 结果翻译成「是否握拳」 */
function detectFist(result) {
  // 没有检测到手
  if (!result.landmarks || result.landmarks.length === 0) {
    state.handSeen = false;
    state.handLandmarks = null;
    state.isFist = false;
    state.gestureLabel = "NONE";
    state.gestureConf = 0;
    return false;
  }

  state.handSeen = true;
  state.handLandmarks = result.landmarks[0]; // 只跟踪一只手

  // 方式一：直接使用模型输出的手势类别（老师模型支持 Closed_Fist）
  const g = result.gestures && result.gestures[0] && result.gestures[0][0];
  if (g && typeof g.categoryName === "string" && g.categoryName) {
    state.gestureConf = g.score;
    if (g.categoryName === "None" || g.score < CONFIG.GESTURE_MIN_SCORE) {
      state.gestureLabel = g.categoryName === "None" ? "NONE" : "NONE(低置信)";
      state.isFist = false;
      return false;
    }
    state.gestureLabel =
      g.categoryName === "Closed_Fist" ? "FIST" : "OPEN(" + g.categoryName + ")";
    state.isFist = g.categoryName === "Closed_Fist";
    return state.isFist;
  }

  // 方式二（兜底）：如果模型不输出手势类别（例如被换成了只有关键点的
  // hand_landmarker 模型），则用关键点几何启发式判断握拳 —— 同样是真实逻辑。
  const fist = landmarkFistCheck(state.handLandmarks);
  state.gestureLabel = fist ? "FIST (landmark)" : "OPEN (landmark)";
  state.gestureConf = fist ? 1 : 0;
  state.isFist = fist;
  return fist;
}

/** 纯关键点握拳判断：4 根手指指尖是否向掌心弯曲 */
function landmarkFistCheck(lm) {
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  let curled = 0;
  // [指尖, 指根]：食指 8/5、中指 12/9、无名指 16/13、小指 20/17
  for (const [tip, mcp] of [[8, 5], [12, 9], [16, 13], [20, 17]]) {
    if (d(tip, 0) < d(mcp, 0) * 0.85) curled++; // 指尖比指根更靠近手腕 = 弯曲
  }
  // 拇指：指尖靠近食指根部 = 收拢
  const thumbCurled = d(4, 5) < d(3, 5) * 0.95;
  return curled >= 3 && (curled >= 4 || thumbCurled);
}

/** 拳头中心：手腕 + 四指根部（MCP）的平均位置 */
function palmCenter(lm) {
  return {
    x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5,
    y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5,
  };
}

/* =====================================================================
   10. 嘴部识别：张嘴 / 闭嘴
   ===================================================================== */
/** 嘴高/脸高比例：上唇内沿(13)到 下唇内沿(14) / 额头(10)到下巴(152) */
function mouthAspectRatio(faceLm) {
  const y13 = faceLm[13].y, y14 = faceLm[14].y;
  const y10 = faceLm[10].y, y152 = faceLm[152].y;
  const faceH = Math.max(1e-6, Math.abs(y152 - y10));
  return Math.abs(y14 - y13) / faceH;
}

/** 处理人脸关键点 → 嘴部状态（带滞回，避免抖动） */
function processMouthState() {
  if (!state.faceSeen || !state.faceLandmarks) {
    state.mouthLabel = "NO FACE";
    state.mouthState = "closed";
    state.mouthWasOpened = false;
    state.mar = 0;
    return;
  }
  const mar = mouthAspectRatio(state.faceLandmarks);
  // 平滑
  state.mar = state.mar === 0 ? mar : state.mar * 0.7 + mar * 0.3;

  // 滞回判断：张嘴阈值高、闭嘴阈值低，中间区间保持原状态，防止嘴唇抖动误判
  let newState;
  if (state.mar > CONFIG.MOUTH_OPEN_THRESHOLD) newState = "open";
  else if (state.mar < CONFIG.MOUTH_CLOSED_THRESHOLD) newState = "closed";
  else newState = state.mouthState;

  // 状态机：张嘴 → 闭嘴 才算一次有效「吃水果动作」
  if (newState === "open") state.mouthWasOpened = true;
  if (newState === "closed" && state.mouthWasOpened) {
    state.mouthWasOpened = false; // 本次张嘴动作已消耗
    attemptEatFruit();            // 距离足够近才会真正吃掉
  }

  state.mouthState = newState;
  state.mouthLabel = newState === "open" ? "OPEN" : "CLOSED";
}

/* =====================================================================
   11. 小鸟移动：手势位移 → 平滑速度 → 带碰撞的移动
   ===================================================================== */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function applyDeadZone(v, zone) {
  const a = Math.abs(v);
  return a < zone ? 0 : (a - zone) * Math.sign(v);
}

/** 跟随拳头的实际移动；手保持不动时清零速度，不会持续飞行。 */
function updateHandMotion() {
  if (!state.handSeen || !state.isFist) {
    // 没有手 / 没有握拳 → 不产生移动，并且下次握拳时重新建立基准
    stopControl();
    return;
  }

  // 没有新的识别数据（AI 30fps、渲染 60fps+）：保持上一帧的目标速度
  if (!state.handUpdated) return;
  state.handUpdated = false;

  const raw = palmCenter(state.handLandmarks);
  const now = performance.now();

  // 握拳刚出现的第 1 帧：只建立基准，不产生位移（避免瞬移）
  if (!hand.baselined) {
    hand.sx = hand.px = raw.x;
    hand.sy = hand.py = raw.y;
    hand.sampleTime = now;
    hand.baselined = true;
    state.controlActive = true;
    return;
  }

  const dt = clamp((now - hand.sampleTime) / 1000, 1 / 120, 0.1);
  const dx = raw.x - hand.px;
  const dy = raw.y - hand.py;
  hand.dxRaw = dx;
  hand.dyRaw = dy;
  hand.px = hand.sx = raw.x;
  hand.py = hand.sy = raw.y;
  hand.sampleTime = now;

  // 死区：手轻微抖动时忽略
  const ddx = applyDeadZone(dx, CONFIG.HAND_DEAD_ZONE);
  const ddy = applyDeadZone(dy, CONFIG.HAND_DEAD_ZONE);

  // 镜像显示时，屏幕上的左右与摄像头原画面的左右相反，所以水平方向取反
  const mirrorSign = CONFIG.MIRROR_VIDEO ? -1 : 1;

  let vx = ddx * CONFIG.HAND_MOVEMENT_GAIN / dt * mirrorSign;
  let vy = ddy * CONFIG.HAND_MOVEMENT_GAIN / dt;
  const scale = Math.min(1, CONFIG.BIRD_MAX_SPEED / (Math.hypot(vx, vy) || 1));
  vx *= scale;
  vy *= scale;
  // 移动时平滑速度；某方向已经停手时立即清零，避免平滑产生拖尾。
  hand.tvx = ddx === 0 ? 0 : hand.tvx + (vx - hand.tvx) * CONFIG.HAND_SMOOTHING;
  hand.tvy = ddy === 0 ? 0 : hand.tvy + (vy - hand.tvy) * CONFIG.HAND_SMOOTHING;
  state.controlActive = true;
}

/** 更新小鸟位置（含墙壁碰撞检测） */
function updateBirdMovement(dt) {
  state.wallGrace = Math.max(0, state.wallGrace - dt);
  if (state.inputMode === "manual") updateManualMotion();
  else updateHandMotion();

  if (state.controlActive) {
    if (state.inputMode === "gesture") {
      if (hand.tvx === 0) bird.vx = 0;
      if (hand.tvy === 0) bird.vy = 0;
    }
    if (hand.tvx === 0 && hand.tvy === 0) bird.vx = bird.vy = 0;
    // 有目标速度 → 向目标速度平滑靠拢（每个渲染帧都执行，直到下一次识别刷新）
    const smoothing = 1 - Math.pow(1 - CONFIG.VELOCITY_SMOOTHING, dt * 60);
    bird.vx += (hand.tvx - bird.vx) * smoothing;
    bird.vy += (hand.tvy - bird.vy) * smoothing;
  } else {
    // 未激活控制 → 速度快速衰减到 0
    const k = Math.pow(0.02, dt); // 极快衰减
    bird.vx *= k;
    bird.vy *= k;
    if (Math.abs(bird.vx) < 0.5) bird.vx = 0;
    if (Math.abs(bird.vy) < 0.5) bird.vy = 0;
  }

  // 分轴移动：被墙挡住的方向停止，另一方向仍可沿墙移动。
  const nx = bird.x + bird.vx * dt;
  let blocked = false;
  if (checkWallCollision(nx, bird.y)) {
    bird.vx = 0;
    blocked = true;
  } else {
    bird.x = nx;
  }
  const ny = bird.y + bird.vy * dt;
  if (checkWallCollision(bird.x, ny)) {
    bird.vy = 0;
    blocked = true;
  } else {
    bird.y = ny;
  }
  // 停止贴墙并离开上次碰墙点至少半格后，才计算下一次碰墙。
  if (!blocked && state.wallHitPosition && Math.hypot(
    bird.x - state.wallHitPosition.x, bird.y - state.wallHitPosition.y
  ) > CELL / 2) state.wallHitPosition = null;

  if (blocked && !state.wallHitPosition && state.wallGrace === 0) {
    state.wallHitPosition = { x: bird.x, y: bird.y };
    state.wallGrace = CONFIG.WALL_GRACE_SECONDS;
    state.lives = Math.max(0, state.lives - 1);
    $("lives").textContent = state.lives;
    if (state.lives === 0) {
      gameOver();
      return;
    }
    spawnFloatText(bird.x, bird.y - 22, "慢慢来 ♥ " + state.lives, "#f28c1e");
    tone(300, 0.08, "sine", 0.08);
  }
}

/** 圆与墙格矩形的最近点检测，避免包围盒在墙角误判。 */
function checkWallCollision(x, y) {
  const r = CONFIG.BIRD_RADIUS;
  const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
  const r0 = Math.floor((y - r) / CELL), r1 = Math.floor((y + r) / CELL);
  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      if (!isWall(rr, cc)) continue;
      const nearX = clamp(x, cc * CELL, (cc + 1) * CELL);
      const nearY = clamp(y, rr * CELL, (rr + 1) * CELL);
      if ((x - nearX) ** 2 + (y - nearY) ** 2 <= r * r) return true;
    }
  }
  return false;
}

function isWall(r, c) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true; // 迷宫外视为墙
  return GRID[r][c] === "#";
}

/* =====================================================================
   12. 水果系统
   ===================================================================== */
/** 找出小鸟当前距离足够近的未吃水果（没有则返回 null） */
function checkFruitCollision() {
  let nearest = null, best = Infinity;
  for (const f of state.fruits) {
    if (f.eaten) continue;
    const d = Math.hypot(bird.x - f.x, bird.y - f.y);
    if (d < best) { best = d; nearest = f; }
  }
  if (nearest && best < CONFIG.EAT_DISTANCE) return nearest;
  return null;
}

/** 张嘴→闭嘴 动作触发：距离足够近才真正吃水果 */
function attemptEatFruit() {
  if (state.mode !== "PLAYING") return;
  const f = checkFruitCollision();
  if (f) eatFruit(f);
}

function eatFruit(f) {
  f.eaten = true;
  f.animT = 1; // 消失动画
  state.score += 10;
  updateScoreUI();
  playSound("eat");
  spawnFloatText(f.x, f.y - 22, "+10", "#f28c1e");
  spawnParticles(f.x, f.y, 10, ["#ff6b6b", "#ffd93d", "#ff8a5c", "#7ed957"]);
  state.chewTimer = 0.45; // 小鸟咀嚼反馈
}

/** 水果随时间更新（消失动画 / 浮动） */
function updateFruits(dt) {
  for (const f of state.fruits) {
    if (f.animT > 0) f.animT = Math.max(0, f.animT - dt * 3);
  }
  if (state.chewTimer > 0) state.chewTimer = Math.max(0, state.chewTimer - dt);
}

/* =====================================================================
   13. 游戏流程：开始 / 结束 / 胜利 / 重置
   ===================================================================== */
function resetGame() {
  state.hasActiveGame = false;
  clearTimeout(resultOverlayTimer);
  resultOverlayTimer = null;
  resetManualInput();
  clearTracking();
  // 小鸟回到起点格 (1,1) 的中心
  bird.x = 1 * CELL + CELL / 2;
  bird.y = 1 * CELL + CELL / 2;
  bird.vx = 0;
  bird.vy = 0;

  state.score = 0;
  state.lives = CONFIG.START_LIVES;
  state.wallGrace = 0;
  state.wallHitPosition = null;
  $("lives").textContent = state.lives;
  state.birdDead = false;
  state.chewTimer = 0;
  state.shakeTime = 0;
  state.mouthWasOpened = false;
  hand.baselined = false;

  // 重新生成水果（8 个位置循环用 5 张贴图）
  state.fruits = FRUIT_POSITIONS.map(([r, c], i) => ({
    r, c,
    x: c * CELL + CELL / 2,
    y: r * CELL + CELL / 2,
    imgIdx: i % FRUIT_IMAGES.length,
    eaten: false,
    animT: 0,
    phase: Math.random() * Math.PI * 2,
  }));
  state.effects = { particles: [], floatTexts: [] };
  updateScoreUI();
}

function gameOver() {
  if (state.mode !== "PLAYING") return;
  state.hasActiveGame = false;
  state.mode = "GAME_OVER";
  resetManualInput();
  stopControl();
  state.lives = 0;
  $("lives").textContent = state.lives;
  state.birdDead = true;
  playSound("hit");
  spawnParticles(bird.x, bird.y, 26, ["#ff6b6b", "#ffd93d", "#ffffff", "#ff8a5c"]);
  spawnFloatText(bird.x, bird.y - 26, "💥", "#ff4444");
  state.shakeTime = 0.5; // 屏幕震动
  overScoreEl.textContent = state.score;
  resultOverlayTimer = setTimeout(() => showOverlay(gameOverScreen), 500);
}

function winGame() {
  if (state.mode !== "PLAYING") return;
  state.hasActiveGame = false;
  state.mode = "WIN";
  resetManualInput();
  stopControl();
  playSound("win");
  const ex = EXIT_POS[1] * CELL + CELL / 2;
  const ey = EXIT_POS[0] * CELL + CELL / 2;
  for (let i = 0; i < 42; i++) spawnConfetti(ex, ey);
  winScoreEl.textContent = state.score;
  resultOverlayTimer = setTimeout(() => showOverlay(winScreen), 600);
}

function checkWin() {
  const ex = EXIT_POS[1] * CELL + CELL / 2;
  const ey = EXIT_POS[0] * CELL + CELL / 2;
  if (Math.hypot(bird.x - ex, bird.y - ey) < CELL * 0.7) winGame();
}

/** 真正开始一局 */
function beginGame() {
  document.activeElement?.blur();
  state.waitingForPlayer = false;
  hideAllOverlays();
  resetGame();
  state.hasActiveGame = true;
  state.mode = "PLAYING";
}

/** Start Game 点击后的完整流程 */
async function startFlow() {
  if (state.mode !== "MENU") return;
  state.mode = "LOADING";
  state.inputMode = "gesture";
  $("manualControls").hidden = true;
  initAudio();
  playSound("start");
  hideAllOverlays();
  showOverlay(loadingScreen);
  loadingTitle.textContent = "正在请求摄像头权限…";
  loadingDetail.textContent = "请在浏览器弹窗中点击「允许」";

  // 1. 摄像头权限
  const camOk = await initializeCamera();
  if (!camOk) {
    state.mode = "ERROR";
    hideAllOverlays();
    showOverlay(permissionScreen);
    return;
  }
  setCamDot("dot-green");

  // 2. AI 模型
  loadingTitle.textContent = "正在加载 AI 模型…";
  try {
    await initializeAI();
  } catch (e) {
    releaseCamera();
    state.mode = "ERROR";
    hideAllOverlays();
    showOverlay(permissionScreen);
    permissionScreen.querySelector("h2").textContent = "Setup Failed";
    if (location.protocol === "file:") {
      // 直接双击打开 HTML（file://）会被浏览器拦截本地文件读取
      permissionScreen.querySelector(".sub").innerHTML =
        "你正在用 file:// 直接打开页面，浏览器会拦截本地模型文件。<br><br>" +
        "<b>解决办法：</b>用 VS Code 的 Live Server 打开（右键 index.html → Open with Live Server），<br>" +
        "浏览器地址必须是 127.0.0.1 开头，不能是 file://";
    } else {
      permissionScreen.querySelector(".sub").innerHTML =
        "AI 模型加载失败。<br>" + escapeHtml(state.aiError) +
        "<br>请检查模型文件和网络。电脑本机可使用 localhost，手机和平板请通过 HTTPS 访问。也可改用触控 / 键盘模式。";
    }
    return;
  }

  // 3. 等待检测到玩家（挥手 / 露脸）→ 自动开始；6 秒兜底
  loadingTitle.textContent = "等待检测到玩家…";
  loadingDetail.textContent = "请对着摄像头露脸或挥手，游戏将自动开始";
  state.waitingForPlayer = true;
  state.waitStart = performance.now();
  state.mode = "WAITING";
}

/* =====================================================================
   14. 特效（粒子 / 飘字 / 屏幕震动）
   ===================================================================== */
function spawnParticles(x, y, n, colors) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 160;
    state.effects.particles.push({
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 40,
      life: 1,
      maxLife: 0.6 + Math.random() * 0.5,
      color: colors[i % colors.length],
      size: 3 + Math.random() * 4,
    });
  }
}

function spawnConfetti(x, y) {
  state.effects.particles.push({
    x, y,
    vx: (Math.random() - 0.5) * 300,
    vy: -100 - Math.random() * 180,
    life: 1,
    maxLife: 1 + Math.random() * 0.8,
    color: ["#ff6b6b", "#ffd93d", "#4ade80", "#60a5fa", "#f472b6"][Math.floor(Math.random() * 5)],
    size: 3 + Math.random() * 5,
    isConfetti: true,
  });
}

function spawnFloatText(x, y, text, color) {
  state.effects.floatTexts.push({ x, y, text, color, life: 1 });
}

function updateEffects(dt) {
  const p = state.effects.particles;
  for (let i = p.length - 1; i >= 0; i--) {
    const it = p[i];
    it.life -= dt / it.maxLife;
    it.vy += 320 * dt; // 重力
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    if (it.life <= 0) p.splice(i, 1);
  }
  const t = state.effects.floatTexts;
  for (let i = t.length - 1; i >= 0; i--) {
    t[i].life -= dt * 1.6;
    t[i].y -= 34 * dt;
    if (t[i].life <= 0) t.splice(i, 1);
  }
  if (state.shakeTime > 0) state.shakeTime = Math.max(0, state.shakeTime - dt);
}

/* =====================================================================
   15. 渲染：迷宫 / 小鸟 / 水果 / 特效
   ===================================================================== */
function draw() {
  ctx.save();
  if (state.shakeTime > 0) {
    const mag = state.shakeTime * 16;
    ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
  }
  drawPathBackground();
  drawWalls();
  drawStartAndGoal();
  drawFruits();
  drawFloatTexts();
  if (!state.birdDead) drawBird();
  drawParticles();
  ctx.restore();
}

/** 路径底色 + 淡淡棋盘格 */
function drawPathBackground() {
  ctx.fillStyle = "#eaf7e2";
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
  ctx.fillStyle = "rgba(0,0,0,0.02)";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(r, c) && (r + c) % 2 === 0) {
        ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
  }
  ctx.strokeStyle = "rgba(0,0,0,0.04)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= COLS; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, ROWS * CELL); ctx.stroke();
  }
  for (let i = 0; i <= ROWS; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(COLS * CELL, i * CELL); ctx.stroke();
  }
}

/** 墙壁：圆角深绿方块 */
function drawWalls() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(r, c)) continue;
      const x = c * CELL + 1, y = r * CELL + 1, s = CELL - 2;
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, "#3c8f5f");
      g.addColorStop(1, "#1f5f3a");
      ctx.fillStyle = g;
      roundRect(ctx, x, y, s, s, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** 起点木牌 + 出口旗帜 */
function drawStartAndGoal() {
  // 起点 (1,1)：小木牌
  const sx = 1 * CELL + CELL / 2, sy = 1 * CELL + CELL / 2;
  ctx.fillStyle = "#8b5a2b";
  roundRect(ctx, sx - 14, sy - 26, 28, 20, 6);
  ctx.fill();
  ctx.strokeStyle = "#5d3a17";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#fff8e7";
  ctx.font = "700 10px 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("START", sx, sy - 12);
  ctx.fillStyle = "#5d3a17";
  ctx.fillRect(sx - 2, sy - 8, 4, 10);

  // 出口 (13,19)：旗帜 + 呼吸光圈
  const ex = EXIT_POS[1] * CELL + CELL / 2, ey = EXIT_POS[0] * CELL + CELL / 2;
  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.strokeStyle = `rgba(74,222,128,${0.35 + pulse * 0.4})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ex, ey, 20 + pulse * 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🚩", ex, ey);
  ctx.font = "700 11px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#2e7d32";
  ctx.fillText("GOAL", ex, ey + 26);
  ctx.textBaseline = "alphabetic";
}

/** 水果：贴图 + 阴影 + 靠近光圈 + 消失动画 */
function drawFruits() {
  const t = performance.now() / 1000;
  for (const f of state.fruits) {
    if (f.eaten && f.animT <= 0) continue;

    // 靠近提示光圈
    const near = checkFruitCollision();
    if (!f.eaten && near === f) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.strokeStyle = `rgba(242,140,30,${0.5 + pulse * 0.5})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 20 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.globalAlpha = f.eaten ? Math.max(0, f.animT) : 1;
    // 阴影
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 14, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 水果上下浮动（贴图）
    const bob = f.eaten ? 0 : Math.sin(t * 2.5 + f.phase) * 3;
    const im = FRUIT_IMAGES[f.imgIdx];
    const s = CELL * 0.85;
    if (im && im.complete && im.naturalWidth > 0) {
      ctx.drawImage(im, f.x - s / 2, f.y + bob - s / 2, s, s);
    } else {
      // 图片未加载完时的兜底：橙色圆
      ctx.fillStyle = "#f28c1e";
      ctx.beginPath();
      ctx.arc(f.x, f.y + bob, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawFloatTexts() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const ft of state.effects.floatTexts) {
    ctx.globalAlpha = Math.max(0, ft.life);
    ctx.font = "800 22px 'Baloo 2', sans-serif";
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 4;
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;
}

function drawParticles() {
  for (const it of state.effects.particles) {
    ctx.globalAlpha = Math.max(0, it.life);
    ctx.fillStyle = it.color;
    ctx.save();
    ctx.translate(it.x, it.y);
    if (it.isConfetti) {
      ctx.rotate(it.life * 8);
      ctx.fillRect(-it.size / 2, -it.size / 2, it.size, it.size * 1.6);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, it.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** 小鸟贴图（fly R.webp），带轻微上下浮动和左右倾斜 */
function drawBird() {
  const t = performance.now() / 1000;
  const speed = Math.hypot(bird.vx, bird.vy);
  const tilt = clamp(bird.vx * 0.0018, -0.4, 0.4);   // 左右倾斜
  const bob = Math.sin(t * 8) * (2 + Math.min(1, speed / 130) * 3); // 飞行上下浮动

  ctx.save();
  ctx.translate(bird.x, bird.y + bob * 0.3);
  ctx.rotate(tilt);

  if (birdImg.complete && birdImg.naturalWidth > 0) {
    // 贴图大小约 1.2 格，居中绘制
    const s = CELL * 1.1;
    ctx.drawImage(birdImg, -s / 2, -s / 2, s, s);
  } else {
    // 图片还没加载完时的兜底：黄色圆
    ctx.fillStyle = "#ffc94d";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* =====================================================================
   16. 摄像头面板渲染（画面 + 关键点 + 识别状态）
   ===================================================================== */
/** 把归一化关键点映射到摄像头画布坐标（跟随镜像设置） */
function mapPoint(p) {
  return {
    x: CONFIG.MIRROR_VIDEO ? (1 - p.x) * CAM_W : p.x * CAM_W,
    y: p.y * CAM_H,
  };
}

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function drawCameraOverlay() {
  camCtx.clearRect(0, 0, CAM_W, CAM_H);
  if (video.readyState >= 2) {
    camCtx.save();
    if (CONFIG.MIRROR_VIDEO) {
      camCtx.translate(CAM_W, 0);
      camCtx.scale(-1, 1);
    }
    camCtx.drawImage(video, 0, 0, CAM_W, CAM_H);
    camCtx.restore();
  }

  // 手部关键点
  if (state.handSeen && state.handLandmarks) {
    camCtx.strokeStyle = "rgba(74,222,128,0.9)";
    camCtx.lineWidth = 2;
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = mapPoint(state.handLandmarks[a]);
      const pb = mapPoint(state.handLandmarks[b]);
      camCtx.beginPath();
      camCtx.moveTo(pa.x, pa.y);
      camCtx.lineTo(pb.x, pb.y);
      camCtx.stroke();
    }
    camCtx.fillStyle = "#4ade80";
    for (const p of state.handLandmarks) {
      const m = mapPoint(p);
      camCtx.beginPath();
      camCtx.arc(m.x, m.y, 2.4, 0, Math.PI * 2);
      camCtx.fill();
    }
    // 拳头中心标记
    const pc = mapPoint(palmCenter(state.handLandmarks));
    camCtx.strokeStyle = "#ffd93d";
    camCtx.lineWidth = 2;
    camCtx.beginPath();
    camCtx.arc(pc.x, pc.y, 7, 0, Math.PI * 2);
    camCtx.stroke();
  }

  // 人脸关键点（全部点淡淡显示 + 嘴唇高亮）
  if (state.faceSeen && state.faceLandmarks) {
    const flm = state.faceLandmarks;
    camCtx.fillStyle = "rgba(96,165,250,0.35)";
    for (const p of flm) {
      const m = mapPoint(p);
      camCtx.fillRect(m.x, m.y, 1.6, 1.6);
    }
    // 嘴唇轮廓高亮（橙色）
    const lipRing = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,
                     78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];
    camCtx.strokeStyle = "#ff8a5c";
    camCtx.lineWidth = 2;
    camCtx.beginPath();
    lipRing.forEach((idx, i) => {
      const m = mapPoint(flm[idx]);
      if (i === 0) camCtx.moveTo(m.x, m.y);
      else camCtx.lineTo(m.x, m.y);
    });
    camCtx.closePath();
    camCtx.stroke();
    // 上下唇参考点 13 / 14
    for (const idx of [13, 14]) {
      const m = mapPoint(flm[idx]);
      camCtx.fillStyle = "#ff4444";
      camCtx.beginPath();
      camCtx.arc(m.x, m.y, 3.5, 0, Math.PI * 2);
      camCtx.fill();
    }
  }

  drawCamStatusText();
}

function drawCamStatusText() {
  const top = state.isFist ? "✊ FIST" : state.handSeen ? "🖐 " + state.gestureLabel : "— no hand —";
  camCtx.font = "700 14px 'Baloo 2', sans-serif";
  camCtx.textAlign = "left";
  camCtx.lineWidth = 4;
  camCtx.strokeStyle = "rgba(0,0,0,0.6)";
  camCtx.strokeText(top, 8, 20);
  camCtx.fillStyle = state.isFist ? "#7ef29a" : "#ffffff";
  camCtx.fillText(top, 8, 20);

  const bottom = state.faceSeen
    ? (state.mouthState === "open" ? "😮 MOUTH OPEN" : "😐 MOUTH CLOSED")
    : "— no face —";
  camCtx.strokeText(bottom, 8, CAM_H - 10);
  camCtx.fillStyle = state.mouthState === "open" ? "#ffd93d" : "#ffffff";
  camCtx.fillText(bottom, 8, CAM_H - 10);
}

/* =====================================================================
   17. 主循环
   ===================================================================== */
let lastTs = 0;
let trackAcc = 0;
let fpsFrames = 0, fpsTime = 0, fps = 0;

function gameLoop(ts) {
  requestAnimationFrame(gameLoop);
  if (document.hidden) {
    lastTs = 0;
    return;
  }

  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
  lastTs = ts;
  if (state.cameraOk && ts - lastTrackingAt > 300) clearTracking();

  // FPS 统计
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }

  // AI 识别（按 TRACK_FPS 节流）
  trackAcc += dt * 1000;
  const trackFps = window.matchMedia("(pointer: coarse)").matches ? 20 : CONFIG.TRACK_FPS;
  if (state.cameraOk && state.aiReady && trackAcc >= 1000 / trackFps) {
    trackAcc = 0;
    runTracking();
  }

  // 等待玩家 → 自动开始（检测到手/脸立即开始，6 秒兜底）
  if (state.waitingForPlayer) {
    if (state.handSeen || state.faceSeen) beginGame();
    else if (ts - state.waitStart > 6000) beginGame();
  }

  // 游戏逻辑
  if (state.mode === "PLAYING") {
    updateBirdMovement(dt);
    if (state.mode === "PLAYING") {
      updateFruits(dt);
      checkWin();
    }
  }
  updateEffects(dt);

  // 渲染
  draw();
  drawCameraOverlay();
  updateStatusUI();
}

/** 执行一次手势 + 人脸识别 */
function runTracking() {
  if (!state.cameraOk || !state.aiReady || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  try {
    const now = performance.now();
    const gRes = gestureRecognizer.recognizeForVideo(video, now);
    detectFist(gRes);
    state.handUpdated = true; // 标记新的手部数据已到达，供 updateHandMotion 消费
    const fRes = faceLandmarker.detectForVideo(video, now);
    state.faceSeen = fRes.faceLandmarks && fRes.faceLandmarks.length > 0;
    state.faceLandmarks = state.faceSeen ? fRes.faceLandmarks[0] : null;
    processMouthState();
    lastTrackingAt = now;
  } catch (e) {
    clearTracking();
    // 偶发识别异常不影响主循环
    console.warn("识别失败:", e);
  }
}

/* =====================================================================
   18. UI 更新与事件绑定
   ===================================================================== */
function updateScoreUI() {
  scoreEl.textContent = state.score;
}

function showOverlay(el) { el.classList.remove("hidden"); }
function hideAllOverlays() {
  for (const el of [menuScreen, loadingScreen, permissionScreen, gameOverScreen, winScreen]) {
    el.classList.add("hidden");
  }
}

function showMenu() {
  hideAllOverlays();
  showOverlay(menuScreen);
  state.mode = "MENU";
}

/** 切换只清理输入，不改动位置、得分、水果或生命值。 */
function resumeWithInput(inputMode) {
  controlSwitchVersion++;
  resetManualInput();
  clearTracking();
  state.inputMode = inputMode;
  state.waitingForPlayer = false;
  $("manualControls").hidden = inputMode !== "manual";
  cameraPanel.classList.toggle("hidden", inputMode === "manual");
  $("toggleCameraBtn").setAttribute("aria-expanded", String(inputMode === "gesture"));
  hideAllOverlays();
  lastTs = 0;
  trackAcc = 0;
  lastVideoTime = -1;
  lastTrackingAt = performance.now();
  state.mode = "PLAYING";
  updateStatusUI();
  document.activeElement?.blur();
}

async function switchToGesture() {
  if (!state.hasActiveGame || !["PLAYING", "ERROR"].includes(state.mode)) return;
  const switchVersion = ++controlSwitchVersion;
  state.mode = "SWITCHING";
  resetManualInput();
  clearTracking();
  initAudio();
  hideAllOverlays();
  loadingTitle.textContent = "正在切换到摄像头…";
  loadingDetail.textContent = "游戏已暂停，位置、分数和水果进度已保留。请允许摄像头权限。";
  showOverlay(loadingScreen);
  updateStatusUI();
  try {
    const cameraReady = await initializeCamera();
    if (switchVersion !== controlSwitchVersion) return;
    if (!cameraReady) {
      // initializeCamera 已提供具体的权限或设备错误说明。
      state.mode = "ERROR";
      permissionScreen.querySelector("h2").textContent = "摄像头切换失败，进度已保留";
      hideAllOverlays();
      showOverlay(permissionScreen);
      return;
    }
    loadingTitle.textContent = "正在准备手势识别…";
    await initializeAI();
    if (switchVersion !== controlSwitchVersion) return;
    if (!state.cameraOk) throw new Error("摄像头已断开，请重新连接后重试");
    setCamDot("dot-green");
    resumeWithInput("gesture");
  } catch (error) {
    if (switchVersion !== controlSwitchVersion) return;
    releaseCamera();
    state.mode = "ERROR";
    permissionScreen.querySelector("h2").textContent = "摄像头切换失败，进度已保留";
    permissionScreen.querySelector(".sub").textContent =
      describeError(error) + "。可以重试摄像头，或用键盘 / 触控继续当前游戏。";
    hideAllOverlays();
    showOverlay(permissionScreen);
  } finally {
    updateStatusUI();
  }
}

async function switchControlMode() {
  if (["LOADING", "SWITCHING"].includes(state.mode)) return;
  if (state.hasActiveGame) {
    if (state.inputMode === "gesture" || state.mode === "ERROR") {
      releaseCamera();
      resumeWithInput("manual");
    } else {
      await switchToGesture();
    }
    return;
  }
  state.waitingForPlayer = false;
  releaseCamera();
  resetGame();
  state.inputMode = "gesture";
  $("manualControls").hidden = true;
  cameraPanel.classList.remove("hidden");
  $("toggleCameraBtn").hidden = false;
  $("toggleCameraBtn").setAttribute("aria-expanded", "true");
  showMenu();
  updateStatusUI();
  $("startBtn").focus();
}

function setCamDot(cls) {
  camStatusDot.className = "dot " + cls;
}

function updateStatusUI() {
  $("switchModeBtn").hidden = state.mode === "MENU";
  $("switchModeBtn").disabled = ["LOADING", "SWITCHING"].includes(state.mode);
  $("switchModeBtn").textContent = state.hasActiveGame
    ? (state.inputMode === "manual" ? "📷 切换到摄像头" : "🎮 切换到键盘 / 触控")
    : "🎮 选择模式";
  $("reloadBtn").textContent = state.hasActiveGame ? "📷 重试摄像头" : "🔄 Reload Page";
  $("fallbackStartBtn").textContent = state.hasActiveGame ? "🎮 用键盘 / 触控继续当前游戏" : "改用触控 / 键盘";
  document.querySelectorAll("[data-switch-mode]:not(#switchModeBtn)").forEach((button) => {
    button.hidden = state.hasActiveGame;
  });
  const isManual = state.inputMode === "manual";
  $("controlHint").textContent = isManual
    ? "按住方向键 / WASD 或屏幕方向按钮移动，松开停止；空格或点击按钮吃水果。"
    : "握拳后移动手掌，鹦鹉跟随移动；手停或松拳就停。松拳后可调整手的位置，再握拳继续。";
  for (const chip of [chipHand, chipGesture, chipMouth]) chip.hidden = isManual;
  $("toggleCameraBtn").hidden = isManual;
  chipCam.textContent = "Camera: " + (isManual ? "未启用" : state.camStatus);
  chipCam.className = "chip " + (isManual ? "" : state.cameraOk ? "ok" : state.camStatus === "--" ? "" : "bad");
  chipAi.textContent = "AI: " + (state.inputMode === "manual" ? "未启用" : state.aiReady ? "READY" : state.aiError ? "FAILED" : state.mode === "MENU" ? "待启动" : "LOADING");
  chipAi.className = "chip " + (state.inputMode === "manual" ? "" : state.aiReady ? "ok" : state.aiError ? "bad" : "warn");
  chipHand.textContent = "Hand: " + (state.handSeen ? "YES" : "NO");
  chipHand.className = "chip " + (state.handSeen ? "ok" : "bad");
  chipGesture.textContent = "Gesture: " + state.gestureLabel;
  chipGesture.className = "chip " + (state.isFist ? "ok" : state.handSeen ? "warn" : "bad");
  chipMouth.textContent = "Mouth: " + state.mouthLabel;
  chipMouth.className = "chip " +
    (state.mouthState === "open" ? "warn" : state.faceSeen ? "ok" : "bad");
  chipControl.textContent = (state.inputMode === "manual" ? "触控 / 键盘: " : "手势: ") + (state.controlActive ? "移动中" : "待命");
  chipControl.className = "chip " + (state.controlActive ? "ok" : "");
  camStatusText.textContent = "Camera: " + state.camStatus;

  debugLine.textContent =
    `MAR:${state.mar.toFixed(3)}  HandDelta:(${hand.dxRaw.toFixed(3)},${hand.dyRaw.toFixed(3)})` +
    `  Bird:(${Math.round(bird.x)},${Math.round(bird.y)})  Speed:${Math.round(Math.hypot(bird.vx, bird.vy))}px/s` +
    `  FPS:${fps}  State:${state.mode}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---- 事件绑定 ---- */
$("startBtn").addEventListener("click", startFlow);
document.querySelectorAll("[data-switch-mode]").forEach((button) => {
  button.addEventListener("click", switchControlMode);
});
$("manualStartBtn").addEventListener("click", startManualGame);
$("fallbackStartBtn").addEventListener("click", startManualGame);
$("eatBtn").addEventListener("click", attemptEatFruit);
$("reloadBtn").addEventListener("click", () => {
  if (state.hasActiveGame) switchToGesture();
  else location.reload();
});
$("retryBtn").addEventListener("click", beginGame);
$("winRetryBtn").addEventListener("click", beginGame);

// 点击摄像头面板：显示/隐藏
$("toggleCameraBtn").addEventListener("click", () => {
  cameraPanel.classList.toggle("hidden");
  $("toggleCameraBtn").setAttribute("aria-expanded", String(!cameraPanel.classList.contains("hidden")));
});

document.addEventListener("visibilitychange", () => {
  resetManualInput();
  clearTracking();
  lastTs = 0;
  trackAcc = 0;
  lastVideoTime = -1;
});
window.addEventListener("pagehide", releaseCamera);
window.addEventListener("blur", resetManualInput);
window.addEventListener("resize", resetManualInput);

// Pointer Events 同时覆盖鼠标、触笔与多指触控，捕获指针保证滑出按钮也能停止。
document.querySelectorAll("[data-direction]").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    if (state.mode !== "PLAYING" || state.inputMode !== "manual" || event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    manualInput.pointers.set(event.pointerId, button.dataset.direction);
    button.classList.add("pressed");
  });
  const release = (event) => {
    manualInput.pointers.delete(event.pointerId);
    if (![...manualInput.pointers.values()].includes(button.dataset.direction)) button.classList.remove("pressed");
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
});
window.addEventListener("keydown", (event) => {
  if (state.inputMode !== "manual" || state.mode !== "PLAYING" || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target.closest("button, input, textarea, select, [contenteditable]")) return;
  if (keyDirections[event.code]) {
    event.preventDefault();
    manualInput.keys.add(event.code);
  } else if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) attemptEatFruit();
  }
});
window.addEventListener("keyup", (event) => {
  // 同一方向可能同时按下方向键和 WASD；用物理键记录防止提前松开。
  manualInput.keys.delete(event.code);
});

/* =====================================================================
   19. 启动
   ===================================================================== */
// 预加载：摄像头权限与 AI 模型放在点击 Start 之后（浏览器要求用户手势才能
// 播放声音与获取摄像头，属于正常浏览器安全策略）。
showMenu();
resetGame();
requestAnimationFrame(gameLoop);
