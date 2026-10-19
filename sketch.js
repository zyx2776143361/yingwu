/* 第3步：小鸟出现 + 方向键控制（临时原型）
   小问题：没有碰撞检测，会穿墙 */
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
function loop() {
  if (!running) return;
  const speed = 4;
  if (keys["ArrowUp"]) bird.y -= speed;
  if (keys["ArrowDown"]) bird.y += speed;
  if (keys["ArrowLeft"]) bird.x -= speed;
  if (keys["ArrowRight"]) bird.x += speed;
  drawMaze(); drawBird();
  requestAnimationFrame(loop);
}

document.getElementById("startBtn").addEventListener("click", () => {
  document.getElementById("menuScreen").classList.add("hidden");
  running = true; loop();
});
