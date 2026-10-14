// =====================================================================
//  《星月夜》— 完成版
//  PART A：手势识别引擎 · PART B：作品（5 个 ===== 标记的函数就是 5 个步骤的答案）
// =====================================================================


// ---------------------------------------------------------------------
//  PART A — 手势识别引擎（三个项目完全相同，不要修改）
// ---------------------------------------------------------------------
const MP_VERSION = "0.10.21";
// MediaPipe 的两个下载来源：先用国内镜像 npmmirror，失败再用 jsDelivr
const MP_URLS = [
  `https://registry.npmmirror.com/@mediapipe/tasks-vision/${MP_VERSION}/files`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`,
];
// 手势模型：先找项目文件夹里的 gesture_recognizer.task，
// 没有的话再从 Google 下载（中国大陆通常无法访问 Google）
const MODEL_URLS = [
  "gesture_recognizer.task",
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
];

// 模型认识的 8 种手势（英文名是模型给出的名字，中文名用来显示）
const GESTURE_NAMES = {
  None: "无",
  Closed_Fist: "握拳 ✊",
  Open_Palm: "张开手掌 🖐",
  Pointing_Up: "食指向上 ☝️",
  Thumb_Down: "拇指向下 👎",
  Thumb_Up: "拇指向上 👍",
  Victory: "剪刀手 ✌️",
  ILoveYou: "我爱你 🤟",
};

let video;                 // 摄像头画面（p5 capture）
let recognizer = null;     // MediaPipe 手势识别模型
let hands = [];            // 每一帧：看到的所有手（0、1 或 2 只）。每只手是一个对象：
                           //   hand.gesture — 手势名，例如 "Open_Palm"（见上面的 GESTURE_NAMES）
                           //   hand.score   — 把握程度，0 到 1（1 = 非常确定）
                           //   hand.points  — 21 个点 {x, y}，画布像素坐标，已经镜像
                           //   hand.side    — "Left" 或 "Right"
let lastVideoTime = -1;
let started = false;
let showCamera = false;

async function loadGestureRecognizer() {
  setStatus("正在加载手势模型…");
  for (const base of MP_URLS) {
    let vision, fileset;
    try {
      vision = await import(`${base}/vision_bundle.mjs`);
      fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
    } catch (e) {
      continue; // 这个来源打不开，换下一个
    }
    for (const model of MODEL_URLS) {
      for (const delegate of ["GPU", "CPU"]) { // 有的电脑不能用 GPU，就退回 CPU
        try {
          recognizer = await vision.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: model, delegate },
            runningMode: "VIDEO",
            numHands: 2,
          });
          return; // 成功！
        } catch (e) {
          // 失败就试下一个
        }
      }
    }
  }
  setStatus("⚠️ 手势模型加载失败：请把 gesture_recognizer.task 放进项目文件夹（和 index.html 放在一起），然后刷新页面");
}

// 每一帧调用一次：向 MediaPipe 要最新的手势和关键点，
// 并把 0~1 的数值换算成镜像后的画布像素坐标。
let cameraOk = null;
function updateHands() {
  if (!recognizer || !video) return;

  // 摄像头没有画面时提示用户（没有授权，或者被别的软件占用）
  const ok = video.elt.readyState >= 2;
  if (ok !== cameraOk) {
    cameraOk = ok;
    setStatus(ok ? "把手伸到摄像头前，做一个手势 ✋"
                 : "正在等待摄像头…请点击「允许」，或点击地址栏里的摄像头图标，然后刷新页面");
  }
  if (!ok) return;

  if (video.elt.currentTime === lastVideoTime) return; // 还没有新的画面
  lastVideoTime = video.elt.currentTime;

  const result = recognizer.recognizeForVideo(video.elt, performance.now());
  const sides = result.handedness || result.handednesses || [];
  hands = result.landmarks.map((lm, i) => {
    const best = (result.gestures[i] && result.gestures[i][0]) || { categoryName: "None", score: 0 };
    return {
      gesture: best.categoryName || "None",
      score: best.score,
      side: sides[i] && sides[i][0] ? sides[i][0].categoryName : "",
      points: lm.map((p) => ({ x: (1 - p.x) * width, y: p.y * height, z: p.z })),
    };
  });
}

// 在每只手的手腕旁边写出识别到的手势和把握程度（学习和调试用）
function drawGestureInfo() {
  push();
  textSize(16);
  textAlign(CENTER, TOP);
  for (const hand of hands) {
    const w = hand.points[0];
    const y = min(w.y + 14, height - 70); // 不要跑到画面外面
    const label = `${GESTURE_NAMES[hand.gesture] || hand.gesture}  ${round(hand.score * 100)}%`;
    noStroke();
    fill(0, 120);
    rect(w.x - textWidth(label) / 2 - 8, y, textWidth(label) + 16, 26, 6);
    fill(255);
    text(label, w.x, y + 4);
  }
  pop();
}

function drawCamera() {
  push();
  translate(width, 0);
  scale(-1, 1); // 镜像，像照镜子一样
  tint(255, 70);
  image(video, 0, 0, width, height);
  pop();
}

function setStatus(msg) {
  select("#status").html(msg);
}


// ---------------------------------------------------------------------
//  PART B — 作品：《星月夜》（致敬文森特·梵高，1889）
// ---------------------------------------------------------------------

const SKY_DEEP = "#14215e";
const MAX_STARS = 12;
// C 大调五声音阶（MIDI 编号），星星越多，音越高
const STAR_NOTES = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96, 98];

let paint;            // 画布图层：笔触一层层叠上去，不会被擦掉
let particles = [];   // 看不见的“画笔”：每一帧沿着风的方向走一步，留下一笔
let stars = [];       // 星星：{x, y, r, phase}
let moon = null;      // 月亮：{x, y}
let lastGesture = {};
let wind = 0;
let showInfo = true;

// 声音
let chime, chimeEnv;  // 星星的叮声
let windNoise, windFilter;

function setup() {
  createCanvas(windowWidth, windowHeight);
  paint = createGraphics(windowWidth, windowHeight);
  resetSky();
  for (let i = 0; i < 120; i++) particles.push(newParticle());
  select("#start").mouseClicked(startExperience);
}

// 一张新画布：深蓝色底，先放 3 颗星星和月亮，让天空一开始就有漩涡
function resetSky() {
  paint.background(SKY_DEEP);
  stars = [
    { x: width * 0.25, y: height * 0.22, r: 18, phase: 0 },
    { x: width * 0.55, y: height * 0.35, r: 40, phase: 1 },
    { x: width * 0.72, y: height * 0.15, r: 16, phase: 2 },
  ];
  moon = { x: width * 0.86, y: height * 0.16 };
}

function newParticle() {
  return { x: random(width), y: random(height * 0.8), life: random(20, 60) };
}

function startExperience() {
  userStartAudio();

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  chime = new p5.Oscillator("sine");
  chime.amp(0);
  chime.start();
  chimeEnv = new p5.Envelope();
  chimeEnv.setADSR(0.003, 1.2, 0, 0.2);
  chimeEnv.setRange(0.3, 0);

  windFilter = new p5.LowPass();
  windNoise = new p5.Noise("pink");
  windNoise.disconnect();
  windNoise.connect(windFilter);
  windNoise.amp(0);
  windNoise.start();

  select("#intro").hide();
  started = true;
  loadGestureRecognizer();
}

function draw() {
  // 1. 手势
  let palmOpen = false;
  if (started) {
    updateHands();
    for (const hand of hands) {
      const g = hand.score >= 0.6 ? hand.gesture : "None";
      if (g === "Open_Palm") palmOpen = true;
      if (g === "None") continue;
      if (g !== lastGesture[hand.side]) onGesture(g, hand);
      lastGesture[hand.side] = g;
    }
    if (hands.length === 0) lastGesture = {};
  }
  wind = lerp(wind, palmOpen ? 1 : 0, 0.05);
  if (windNoise) {
    windNoise.amp(wind * 0.4, 0.1);
    windFilter.freq(300 + wind * 1200);
  }

  // 2. 看不见的画笔沿着风的方向走，每走一步留下一笔
  for (let step = 0; step < 2; step++) {
    for (const p of particles) {
      const a = flowAngle(p.x, p.y);
      const speed = 2.5 + wind * 5;
      p.x += cos(a) * speed;
      p.y += sin(a) * speed;
      p.life--;
      if (p.life <= 0 || p.x < 0 || p.x > width || p.y < 0 || p.y > height * 0.85) {
        Object.assign(p, newParticle());
        continue;
      }
      drawBrushStroke(paint, p.x, p.y, a, skyColor(p.x, p.y));
    }
  }

  // 3. 把画布、村庄、月亮、星星画出来
  image(paint, 0, 0);
  if (started && showCamera) drawCamera();
  drawVillage();
  if (moon) drawMoon(moon);
  for (const s of stars) drawStar(s);

  if (started) {
    for (const hand of hands) {
      noStroke();
      fill(255, 230, 120, 200);
      circle(hand.points[8].x, hand.points[8].y, 10);
    }
    if (showInfo) drawGestureInfo();
  }
}

// ===== 第 1 步：drawBrushStroke（完成版）=====
// 一笔：短而粗的笔触，两头是圆的，上面有一道淡淡的亮边
function drawBrushStroke(g, x, y, angle, col) {
  g.push();
  g.translate(x, y);
  g.rotate(angle);
  g.strokeCap(ROUND);
  g.stroke(col);
  g.strokeWeight(5);
  g.line(-7, 0, 7, 0);
  g.stroke(255, 60);
  g.strokeWeight(1.5);
  g.line(-5, -1, 5, -1);
  g.pop();
}
// ===== 第 1 步 结束 =====

// ===== 第 2 步：skyColor（完成版）=====
// 天空的颜色：用 noise 在深蓝和浅蓝之间变化；靠近星星的地方变成黄色
function skyColor(x, y) {
  const n = noise(x * 0.01, y * 0.01);
  let c = lerpColor(color("#1b2a6b"), color("#6c8fd8"), n);
  for (const s of stars) {
    const d = dist(x, y, s.x, s.y);
    if (d < s.r * 2.5) {
      c = lerpColor(c, color("#f2d34f"), 1 - d / (s.r * 2.5));
    }
  }
  c.setAlpha(random(150, 230));
  return c;
}
// ===== 第 2 步 结束 =====

// ===== 第 3 步：flowAngle（完成版）=====
// 风的方向：基本方向来自 noise；靠近星星时，绕着星星转圈
function flowAngle(x, y) {
  const base = noise(x * 0.003, y * 0.003, frameCount * 0.002) * TWO_PI * 2;
  let vx = cos(base);
  let vy = sin(base);
  for (const s of stars) {
    const dx = x - s.x;
    const dy = y - s.y;
    const d = max(dist(x, y, s.x, s.y), 1);
    if (d < s.r * 4) {
      const weight = 1 - d / (s.r * 4);
      vx += (-dy / d) * weight * 3;
      vy += (dx / d) * weight * 3;
    }
  }
  return atan2(vy, vx);
}
// ===== 第 3 步 结束 =====

// ===== 第 4 步：drawStar（完成版）=====
// 一颗会呼吸的星星：外面几圈淡黄色的光晕，中间一个亮白色的核
function drawStar(s) {
  const pulse = 1 + 0.08 * sin(frameCount * 0.1 + s.phase);
  const r = s.r * pulse;
  noStroke();
  for (let i = 5; i >= 1; i--) {
    fill(255, 230, 120, 30);
    circle(s.x, s.y, r * i * 0.8);
  }
  fill(255, 250, 220);
  circle(s.x, s.y, r);
}
// ===== 第 4 步 结束 =====

// ===== 第 5 步：onGesture（完成版）=====
// 手势刚刚开始时调用一次
function onGesture(g, hand) {
  const tip = hand.points[8];
  const palm = hand.points[9];
  if (g === "Pointing_Up" && stars.length < MAX_STARS) {
    stars.push({ x: tip.x, y: tip.y, r: random(12, 24), phase: random(TWO_PI) });
    playStarNote(stars.length);
  }
  if (g === "Thumb_Up" && stars.length < MAX_STARS) {
    stars.push({ x: palm.x, y: palm.y, r: random(34, 44), phase: random(TWO_PI) });
    playStarNote(stars.length);
  }
  if (g === "Closed_Fist") {
    moon = { x: palm.x, y: palm.y };
    playStarNote(0);
  }
  if (g === "Victory") {
    resetSky();
  }
}
// ===== 第 5 步 结束 =====

// ---------- 下面这些已经写好了，不需要改 ----------

// 村庄：深色的山、房子和亮着灯的窗户，左边一棵像火焰一样的柏树
function drawVillage() {
  const base = height * 0.85;
  noStroke();
  fill(18, 28, 60);
  beginShape();
  vertex(0, height);
  for (let x = 0; x <= width; x += 40) vertex(x, base - 40 + 25 * sin(x * 0.01));
  vertex(width, height);
  endShape(CLOSE);
  for (let i = 0; i < 9; i++) {
    const x = width * (0.35 + i * 0.06);
    const h = 26 + (i % 3) * 10;
    fill(30, 38, 70);
    rect(x, base - h + 10, 34, h);
    fill(240, 200, 80);
    rect(x + 8, base - h + 18, 7, 7);
    rect(x + 20, base - h + 18, 7, 7);
  }
  fill(30, 38, 70);
  triangle(width * 0.62, base - 120, width * 0.6, base - 30, width * 0.64, base - 30); // 教堂尖顶
  // 柏树：从地面升起的“火焰”
  fill(12, 30, 20);
  beginShape();
  vertex(width * 0.08, height);
  bezierVertex(width * 0.02, height * 0.6, width * 0.14, height * 0.45, width * 0.12, height * 0.12);
  bezierVertex(width * 0.18, height * 0.45, width * 0.24, height * 0.6, width * 0.2, height);
  endShape(CLOSE);
}

// 弯弯的月亮：亮黄色的圆 + 光晕，再用一个深色圆挡住一部分
function drawMoon(m) {
  noStroke();
  for (let i = 4; i >= 1; i--) {
    fill(255, 220, 90, 35);
    circle(m.x, m.y, 50 * i * 0.9);
  }
  fill(250, 215, 80);
  circle(m.x, m.y, 50);
  fill(20, 33, 94);
  circle(m.x + 14, m.y - 8, 40);
}

function playStarNote(n) {
  if (!chime) return;
  chime.freq(midiToFreq(STAR_NOTES[constrain(n, 0, STAR_NOTES.length - 1)]));
  chimeEnv.play(chime);
}

function keyPressed() {
  if (key === "c" || key === "C") resetSky();
  if (key === "s" || key === "S") saveCanvas("my-starry-night", "png");
  if (key === "v" || key === "V") showCamera = !showCamera;
  if (key === "i" || key === "I") showInfo = !showInfo;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  paint = createGraphics(windowWidth, windowHeight);
  resetSky();
}
