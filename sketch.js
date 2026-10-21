"use strict";

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
  "#     #     #      E #",
  "######################",
];
const COLS = MAZE_MAP[0].length, ROWS = MAZE_MAP.length, CELL = 40;
const EAT_DISTANCE = 36;

const FRUIT_POSITIONS = [
  [9, 3], [13, 3], [9, 9], [5, 7], [1, 11], [7, 11], [7, 17], [11, 17],
];
const FRUIT_EMOJIS = ["🍎", "🍌", "🍓", "🍊", "🍇"];

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const overScoreEl = document.getElementById("overScore");

const bird = { x: CELL + CELL / 2, y: CELL + CELL / 2, r: 12 };
let score = 0;
let fruits = [];

const keys = {};
window.addEventListener("keydown", (e) => (keys[e.key] = true));
window.addEventListener("keyup", (e) => (keys[e.key] = false));

function resetFruits() {
  fruits = FRUIT_POSITIONS.map(([r, c], i) => ({
    x: c * CELL + CELL / 2, y: r * CELL + CELL / 2,
    emoji: FRUIT_EMOJIS[i % FRUIT_EMOJIS.length], eaten: false,
  }));
}
function checkWallCollision(x, y) {
  const r = bird.r;
  for (let rr = Math.floor((y - r) / CELL); rr <= Math.floor((y + r) / CELL); rr++)
    for (let cc = Math.floor((x - r) / CELL); cc <= Math.floor((x + r) / CELL); cc++)
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || MAZE_MAP[rr][cc] === "#") return true;
  return false;
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.fill();
}
function drawMaze() {
  ctx.fillStyle = "#eaf7e2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (MAZE_MAP[r][c] === "#") { ctx.fillStyle = "#2f9e44"; roundRect(c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6, 8); }
}
function drawFruits() {
  ctx.font = "26px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const f of fruits) if (!f.eaten) ctx.fillText(f.emoji, f.x, f.y);
}
function drawBird() {
  ctx.fillStyle = "#ffb02e";
  ctx.beginPath(); ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2b2b2b";
  ctx.beginPath(); ctx.arc(bird.x + 4, bird.y - 3, 2.5, 0, Math.PI * 2); ctx.fill();
}

let running = false, spaceWasPressed = false;
function gameOver() {
  running = false;
  overScoreEl.textContent = score;
  document.getElementById("gameOverScreen").classList.remove("hidden");
}
function loop() {
  if (!running) return;
  const speed = 4;
  const nx = bird.x + (keys["ArrowRight"] ? speed : 0) - (keys["ArrowLeft"] ? speed : 0);
  const ny = bird.y + (keys["ArrowDown"] ? speed : 0) - (keys["ArrowUp"] ? speed : 0);
  if (checkWallCollision(nx, ny)) { gameOver(); return; }
  bird.x = nx; bird.y = ny;

  if (keys[" "] && !spaceWasPressed) {
    spaceWasPressed = true;
    let near = null, best = Infinity;
    for (const f of fruits) {
      if (f.eaten) continue;
      const d = Math.hypot(bird.x - f.x, bird.y - f.y);
      if (d < best) { best = d; near = f; }
    }
    if (near && best < EAT_DISTANCE) { near.eaten = true; score += 10; scoreEl.textContent = score; }
  }
  if (!keys[" "]) spaceWasPressed = false;

  drawMaze(); drawFruits(); drawBird();
  requestAnimationFrame(loop);
}
function startGame() {
  bird.x = CELL + CELL / 2; bird.y = CELL + CELL / 2;
  score = 0; scoreEl.textContent = "0";
  resetFruits();
  document.getElementById("menuScreen").classList.add("hidden");
  document.getElementById("gameOverScreen").classList.add("hidden");
  running = true; loop();
}
document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);