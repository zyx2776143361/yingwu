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

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const bird = { x: CELL + CELL / 2, y: CELL + CELL / 2, r: 12 };

const keys = {};
window.addEventListener("keydown", (e) => (keys[e.key] = true));
window.addEventListener("keyup", (e) => (keys[e.key] = false));

/* 碰撞：小鸟包围盒压到墙格就撞 */
function checkWallCollision(x, y) {
  const r = bird.r;
  const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
  const r0 = Math.floor((y - r) / CELL), r1 = Math.floor((y + r) / CELL);
  for (let rr = r0; rr <= r1; rr++)
    for (let cc = c0; cc <= c1; cc++)
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
function drawBird() {
  ctx.fillStyle = "#ffb02e";
  ctx.beginPath(); ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2b2b2b";
  ctx.beginPath(); ctx.arc(bird.x + 4, bird.y - 3, 2.5, 0, Math.PI * 2); ctx.fill();
}

let running = false;
function gameOver() {
  running = false;
  document.getElementById("gameOverScreen").classList.remove("hidden");
}
function loop() {
  if (!running) return;
  const speed = 4;
  const nx = bird.x + (keys["ArrowRight"] ? speed : 0) - (keys["ArrowLeft"] ? speed : 0);
  const ny = bird.y + (keys["ArrowDown"] ? speed : 0) - (keys["ArrowUp"] ? speed : 0);
  if (checkWallCollision(nx, ny)) { gameOver(); return; }
  bird.x = nx; bird.y = ny;
  drawMaze(); drawBird();
  requestAnimationFrame(loop);
}
function startGame() {
  bird.x = CELL + CELL / 2; bird.y = CELL + CELL / 2;
  document.getElementById("menuScreen").classList.add("hidden");
  document.getElementById("gameOverScreen").classList.add("hidden");
  running = true; loop();
}
document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);
