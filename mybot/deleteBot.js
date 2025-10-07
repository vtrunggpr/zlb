import fs from "fs";
import path from "path";
import { spawn } from "child_process";
const projectRoot = path.resolve(process.cwd());
const myBotDir = path.join(projectRoot, "mybot");
const myBotsPath = path.join(myBotDir, "mybots.json");
const isWindows = process.platform === "win32";
export async function deleteBot(api, message, groupAdmins) {
  const { threadId, data: { uidFrom, dName }, type } = message;
  try {
    const checkResult = await checkBotExists(uidFrom);
    if (!checkResult.exists) {
      return await sendMessage(api, "❌ Bạn chưa có bot nào được tạo!", threadId, type, message);
    }
    const botInfo = checkResult.botInfo;
    if (["trialExpired", "expired", "stopping"].includes(botInfo.status)) {
      return await sendMessage(api, "❌ Hiện tại chỉ có admin bot mẹ mới có quyền xoá/reset bot của bạn.", threadId, type, message);
    }
    // await sendMessage(api, "⏳ Đang xóa bot...", threadId, type, message);
    const pm2Status = await checkPM2Status(uidFrom);
    if (pm2Status.running) {
      console.log(`Stopping PM2 process for bot ${uidFrom} before deletion...`);
      const stopSuccess = await stopPM2Process(uidFrom);
      if (!stopSuccess) {
        console.warn(`Failed to stop PM2 process for bot ${uidFrom}, continuing with deletion...`);
      }
    }
    const deleteSuccess = await deletePM2Process(uidFrom);
    const removeSuccess = await removeBotFromList(uidFrom);
    if (removeSuccess) {
      const botName = botInfo.displayName || botInfo.name || uidFrom;
      await sendMessage(api, `✅ Bot "${botName}" đã được xóa thành công!`, threadId, type, message);
      // await sendMessage(api, `✅ Bot "${botName}" đã được xóa thành công!\n\n📋 Thông tin bot đã xóa:\n• Bot ID: ${uidFrom}\n• Tên bot: ${botName}\n• Người sở hữu: ${dName}\n• Trạng thái PM2: ${deleteSuccess ? "🗑️ Đã xóa" : "⚠️ Không tìm thấy"}\n• Trạng thái file: 🗑️ Đã xóa khỏi danh sách`, threadId, type, message);
      console.log(`Bot "${uidFrom}" đã được xóa bởi ${dName}`);
    } else {
      await sendMessage(api, "❌ Không thể xóa bot khỏi danh sách. Vui lòng thử lại hoặc liên hệ admin!", threadId, type, message);
    }
  } catch (error) {
    await handleError(error, api, threadId, "xóa bot", type, message);
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
async function checkBotExists(uidFrom) {
  try {
    if (!fs.existsSync(myBotsPath)) {
      return { exists: false };
    }
    const myBots = JSON.parse(fs.readFileSync(myBotsPath, "utf8"));
    const botInfo = myBots[uidFrom];
    if (!botInfo) {
      return { exists: false };
    }
    return { exists: true, botInfo };
  } catch (error) {
    console.error(`Lỗi kiểm tra bot: ${error.message}`);
    return { exists: false };
  }
}
async function removeBotFromList(uidFrom) {
  try {
    if (!fs.existsSync(myBotsPath)) {
      throw new Error("File mybots.json không tồn tại");
    }
    const myBots = JSON.parse(fs.readFileSync(myBotsPath, "utf8"));
    if (!myBots[uidFrom]) {
      throw new Error("Bot không tồn tại trong danh sách");
    }
    delete myBots[uidFrom];
    fs.writeFileSync(myBotsPath, JSON.stringify(myBots, null, 2));
    console.log(`Đã xóa bot ${uidFrom} khỏi danh sách`);
    return true;
  } catch (error) {
    console.error(`Lỗi xóa bot khỏi danh sách: ${error.message}`);
    return false;
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