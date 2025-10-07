import fs from "fs";
import path from "path";
import { spawn } from "child_process";
const projectRoot = path.resolve(process.cwd());
const myBotDir = path.join(projectRoot, "mybot");
const myBotsPath = path.join(myBotDir, "mybots.json");
const isWindows = process.platform === "win32";
export async function infoBot(api, message, groupAdmins) {
  const { threadId, data: { uidFrom, dName }, type } = message;
  try {
    const checkResult = await checkBotExists(uidFrom);
    if (!checkResult.exists) {
      return await sendMessage(api, "❌ Bạn chưa có bot nào được tạo!", threadId, type, message);
    }
    const botInfo = checkResult.botInfo;
    // await sendMessage(api, "⏳ Đang kiểm tra thông tin bot...", threadId, type, message);
    const pm2Status = await checkPM2Status(uidFrom);
    let realStatus = "stopped";
    if (pm2Status.running && pm2Status.status === "online") {
      realStatus = "running";
    } else if (["trialExpired", "expired", "stopping"].includes(botInfo.status)) {
      realStatus = botInfo.status;
    }
    let statusUpdated = false;
    if (botInfo.status !== realStatus && !["trialExpired", "expired", "stopping"].includes(botInfo.status)) {
      console.log(`Updating bot ${uidFrom} status from ${botInfo.status} to ${realStatus}`);
      await updateBotStatus(uidFrom, realStatus);
      statusUpdated = true;
    }
    const createdAt = new Date(botInfo.createdAt);
    const expiryAt = new Date(botInfo.expiryAt);
    const now = new Date();
    const timeRunning = formatTimeDifference(createdAt, now);
    const timeRemaining = expiryAt > now ? formatTimeDifference(now, expiryAt) : "Đã hết hạn";
    const statusIcons = {
      "running": "✅ Đang hoạt động",
      "stopped": "⏹️ Đã dừng",
      "trialExpired": "⏰ Hết thời gian dùng thử",
      "expired": "❌ Đã hết hạn",
      "stopping": "🔧 Đang bảo trì"
    };
    const botName = botInfo.displayName || botInfo.name || uidFrom;
    const infoMessage = "📋 THÔNG TIN CHI TIẾT BOT\n\n" +
            `🤖 Tên bot: ${botName}\n` +
            `🆔 Bot ID: ${uidFrom}\n` +
            `👤 Người sở hữu: ${botInfo.createdBy || dName}\n` +
            `📊 Trạng thái: ${statusIcons[realStatus] || realStatus}\n` +
            `🌐 Web Port: ${botInfo.webPort || "Không có"}\n` +
            `🗄️ Database: ${botInfo.database || "Không có"}\n\n` +
            "⏰ THỜI GIAN:\n" +
            `📅 Ngày tạo: ${formatDateTime(createdAt)}\n` +
            `⏳ Thời gian hoạt động: ${timeRunning}\n` +
            `📅 Ngày hết hạn: ${formatDateTime(expiryAt)}\n` +
            `⏰ Thời gian còn lại: ${timeRemaining}\n\n` +
            "🔧 TRẠNG THÁI KỸ THUẬT:\n" +
            `• PM2 Status: ${pm2Status.status}\n` +
            `• File Status: ${botInfo.status}\n` +
            `• Real Status: ${realStatus}\n` +
            `${statusUpdated ? "• ✅ Đã đồng bộ trạng thái\n" : ""}` +
            `${botInfo.lastUpdated ? `• Cập nhật cuối: ${formatDateTime(new Date(botInfo.lastUpdated))}\n` : ""}`;
    await sendMessage(api, infoMessage, threadId, type, message);
    console.log(`Bot info requested for ${uidFrom} by ${dName}`);
  } catch (error) {
    await handleError(error, api, threadId, "lấy thông tin bot", type, message);
  }
}
async function checkPM2Status(processName) {
  return new Promise((resolve) => {
    const pm2Command = isWindows ? "pm2.cmd" : "pm2";
    const pm2Process = spawn(pm2Command, ["describe", processName], {
      stdio: "pipe",
      shell: true,
      windowsHide: isWindows
    });
    let output = "";
    let errorOutput = "";
    pm2Process.stdout?.on("data", (data) => {
      output += data.toString();
    });
    pm2Process.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });
    pm2Process.on("close", (code) => {
      if (code === 0 && output.includes("online")) {
        resolve({ running: true, status: "online" });
      } else if (code === 0 && output.includes("stopped")) {
        resolve({ running: false, status: "stopped" });
      } else {
        resolve({ running: false, status: "not_found" });
      }
    });
    pm2Process.on("error", () => {
      resolve({ running: false, status: "error" });
    });
    setTimeout(() => {
      pm2Process.kill();
      resolve({ running: false, status: "timeout" });
    }, 10000);
  });
}

async function updateBotStatus(uidFrom, status) {
  try {
    if (!fs.existsSync(myBotsPath)) {
      throw new Error("File mybots.json không tồn tại");
    }
    const myBots = JSON.parse(fs.readFileSync(myBotsPath, "utf8"));
    if (!myBots[uidFrom]) {
      throw new Error("Bot không tồn tại trong danh sách");
    }
    myBots[uidFrom].status = status;
    myBots[uidFrom].lastUpdated = new Date().toISOString();
    fs.writeFileSync(myBotsPath, JSON.stringify(myBots, null, 2));
    console.log(`Đã cập nhật trạng thái bot ${uidFrom} thành ${status}`);
  } catch (error) {
    console.error(`Lỗi cập nhật trạng thái bot: ${error.message}`);
    throw error;
  }
}

function formatTimeDifference(startDate, endDate) {
  const diffMs = Math.abs(endDate - startDate);
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) {
    const remainingHours = diffHours % 24;
    return `${diffDays} ngày ${remainingHours} giờ`;
  } else if (diffHours > 0) {
    const remainingMinutes = diffMinutes % 60;
    return `${diffHours} giờ ${remainingMinutes} phút`;
  } else if (diffMinutes > 0) {
    const remainingSeconds = diffSeconds % 60;
    return `${diffMinutes} phút ${remainingSeconds} giây`;
  } else {
    return `${diffSeconds} giây`;
  }
}
async function sendMessage(api, msg, threadId, type, message) {
  try {
    await api.sendMessage({msg: msg, quote: message, ttl: 120000}, threadId, type);
  } catch (err) {
    console.error(`Lỗi khi gửi tin nhắn: ${err.message}`);
  }
}
async function handleError(error, api, threadId, context, type, message) {
  console.error(`Lỗi ${context}: ${error.message}`);
  console.error(`Stack trace: ${error.stack}`);
  let errorDetails = error.message;
  if (error.code) errorDetails += ` (Code: ${error.code})`;
  if (error.path) errorDetails += ` (Path: ${error.path})`;
  await sendMessage(api, `❌ Đã xảy ra lỗi khi ${context}!\n\n🔍 Chi tiết: ${errorDetails}\n\n💡 Vui lòng thử lại sau hoặc liên hệ admin.`, threadId, type, message);
}