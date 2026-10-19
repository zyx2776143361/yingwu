"use strict";
const menuScreen = document.getElementById("menuScreen");
const startBtn = document.getElementById("startBtn");
startBtn.addEventListener("click", () => {
  console.log;
});
/* 第2步：画出迷宫；修复：Start 按钮可以隐藏菜单 */
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

const COLS = MAZE_MAP[0].length; // 22 列
const ROWS = MAZE_MAP.length;     // 15 行
const CELL = 40;                 // 每格 40px

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

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
      if (MAZE_MAP[r][c] === "#") {
        ctx.fillStyle = "#2f9e44";
        roundRect(c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6, 8);
      }
}

document.getElementById("startBtn").addEventListener("click", () => {
  document.getElementById("menuScreen").classList.add("hidden");
});

drawMaze();
