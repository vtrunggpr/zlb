// rank-canvas.js
import { createCanvas, loadImage } from "canvas";
import fs from "fs";
import path from "path";
import { loadImageBuffer } from '../../../utils/util.js'; // Đảm bảo đường dẫn chính xác

export async function createRankImage(rankData, title, api, width = 800) {
  const ctxTemp = createCanvas(999, 999).getContext("2d");

  const space = 80;
  let yTemp = 60;

  ctxTemp.font = "bold 28px Tahoma";

  for (const user of rankData) {
    const userText = `${user.UserName}: ${
      title === "🏆 Bảng xếp hạng tin nhắn hôm nay:"
        ? user.messageCountToday
        : user.Rank
    } tin nhắn`;
    const lineWidth = space + ctxTemp.measureText(userText).width;
    if (lineWidth > width) {
      yTemp += 70;
    }
    yTemp += 70;
  }

  yTemp += 60;

  const height = yTemp > 430 ? yTemp : 430;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Áp dụng nền động và gradient
  const backgroundGradient = ctx.createLinearGradient(0, 0, 0, height);
  backgroundGradient.addColorStop(0, "#0A0A0A");
  backgroundGradient.addColorStop(1, "#121212");
  ctx.fillStyle = backgroundGradient;
  ctx.fillRect(0, 0, width, height);

  let y = 60;

  ctx.textAlign = "left";
  ctx.font = "bold 28px Tahoma";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(title, space, y);

  y += 50;

  ctx.textAlign = "left";
  ctx.font = "bold 28px Tahoma";
  ctx.fillStyle = "#D0D0D0";

  for (const [index, user] of rankData.entries()) {
    try {
      const userInfo = await api.getUserInfo(user.UID);
      console.log(`Thông tin người dùng ${user.UserName} (${user.UID}):`, userInfo);

      if (userInfo && userInfo.avatar) {
        console.log(`Đang tải ảnh từ: ${userInfo.avatar}`);
        try {
          const buffer = await loadImageBuffer(userInfo.avatar);
          const avatar = await loadImage(buffer);
          ctx.drawImage(avatar, 20, y - 20, 50, 50);
        } catch (loadImageError) {
          console.error(`Lỗi tải ảnh từ ${userInfo.avatar}:`, loadImageError);
          ctx.fillText("Lỗi tải ảnh", 20, y);
        }
      } else {
        console.warn(`Không tìm thấy ảnh đại diện cho người dùng ${user.UserName} (${user.UID})`);
        ctx.fillText("Không có ảnh đại diện", 20, y);
      }

      const userText = `${index + 1}. ${user.UserName}: ${
        title === "🏆 Bảng xếp hạng tin nhắn hôm nay:"
          ? user.messageCountToday
          : user.Rank
      } tin nhắn`;
      ctx.fillText(userText, space, y);
      y += 70;
    } catch (error) {
      console.error("Lỗi khi tải hoặc vẽ ảnh đại diện:", error);
    }
  }

  const filePath = path.resolve(`./assets/temp/rank_${Date.now()}.png`);
  const out = fs.createWriteStream(filePath);
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  return new Promise((resolve, reject) => {
    out.on("finish", () => resolve(filePath));
    out.on("error", reject);
  });
}