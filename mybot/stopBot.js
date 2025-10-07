import fs from "fs";
import path from "path";
import { spawn } from "child_process";
const projectRoot = path.resolve(process.cwd());
const myBotDir = path.join(projectRoot, "mybot");
const myBotsPath = path.join(myBotDir, "mybots.json");
const isWindows = process.platform === "win32";
export async function stopBot(api, message, groupAdmins) {
  const { threadId, data: { uidFrom, dName }, type } = message;
  try {
    const checkResult = await checkBotExists(uidFrom);
    if (!checkResult.exists) {
      return await sendMessage(api, "❌ Bạn đéo có bot!", threadId, type, message);
    }
    const botInfo = checkResult.botInfo;
    if (botInfo.status === "stopped") {
      return await sendMessage(api, "❌ Bot của bạn đang đứt sẵn cmnr!", threadId, type, message);
    }
    if (["trialExpired", "expired", "stopping"].includes(botInfo.status)) {
      const statusMessages = {
        "trialExpired": "❌ Bạn đã hết thời gian dùng thử! Hãy gia hạn bot của bạn.",
        "expired": "❌ Bot của bạn đã hết hạn! Hãy gia hạn để tiếp tục sử dụng.",
        "stopping": "❌ Bot của bạn đang trong trạng thái bảo trì! Hãy liên hệ admin."
      };
      return await sendMessage(api, statusMessages[botInfo.status], threadId, type, message);
    }
    const pm2Status = await checkPM2Status(uidFrom);
    if (!pm2Status.running) {
      await updateBotStatus(uidFrom, "stopped");
      return await sendMessage(api, "❌ Bot mày dừng từ chiều!", threadId, type, message);
    }
    // await sendMessage(api, "⏳ Đang dừng bot...", threadId, type, message);
    const stopSuccess = await stopPM2Process(uidFrom);
    if (stopSuccess) {
      await updateBotStatus(uidFrom, "stopped");
      await sendMessage(api, `✅ Bot "${uidFrom}" đã được dừng thành công!\n\n📋 Thông tin:\n• Bot ID: ${uidFrom}\n• Người sở hữu: ${dName}\n• Trạng thái: ⏹️ Đã dừng`, threadId, type, message);
      console.log(`Bot "${uidFrom}" đã được dừng bởi ${dName}`);
    } else {
      await sendMessage(api, "❌ Không thể dừng bot. Vui lòng thử lại hoặc liên hệ admin!", threadId, type, message);
    }
  } catch (error) {
    await handleError(error, api, threadId, "dừng bot", type, message);
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
async function stopPM2Process(processName) {
  return new Promise((resolve) => {
    const pm2Command = isWindows ? "pm2.cmd" : "pm2";
    const pm2Process = spawn(pm2Command, ["stop", processName], {
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
      if (code === 0) {
        console.log(`Successfully stopped PM2 process: ${processName}`);
        resolve(true);
      } else {
        console.error(`Failed to stop PM2 process: ${processName}`);
        if (errorOutput) console.error(`Error: ${errorOutput}`);
        resolve(false);
      }
    });
    pm2Process.on("error", (error) => {
      console.error(`Error stopping PM2 process: ${error.message}`);
      resolve(false);
    });
    setTimeout(() => {
      pm2Process.kill();
      console.error(`Timeout stopping PM2 process: ${processName}`);
      resolve(false);
    }, 15000);
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

async function handleError(error, api, threadId, context, type, message) {
  console.error(`Lỗi ${context}: ${error.message}`);
  console.error(`Stack trace: ${error.stack}`);
  let errorDetails = error.message;
  if (error.code) errorDetails += ` (Code: ${error.code})`;
  if (error.path) errorDetails += ` (Path: ${error.path})`;
  await sendMessage(api, `❌ Đã xảy ra lỗi khi ${context}!\n\n🔍 Chi tiết: ${errorDetails}\n\n💡 Vui lòng thử lại sau hoặc liên hệ admin.`, threadId, type, message);
}