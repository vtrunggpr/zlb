import fs from "fs";
import path from "path";
import { spawn } from "child_process";
const projectRoot = path.resolve(process.cwd());
const myBotDir = path.join(projectRoot, "mybot");
const myBotsPath = path.join(myBotDir, "mybots.json");
const launcherPath = path.join(projectRoot, "index.js");
const isWindows = process.platform === "win32";
export async function startBot(api, message, groupAdmins) {
  const { threadId, data: { uidFrom, dName }, type } = message;
  try {
    const checkResult = await checkBotExists(uidFrom);
    if (!checkResult.exists) {
      return await sendMessage(api, "❌ Bạn chưa có bot nào được tạo!", threadId, type, message);
    }
    const botInfo = checkResult.botInfo;
    if (["trialExpired", "expired", "stopping"].includes(botInfo.status)) {
      const statusMessages = {
        "trialExpired": "❌ Bạn đã hết thời gian dùng thử! Hãy gia hạn bot của bạn.",
        "expired": "❌ Bot của bạn đã hết hạn! Hãy gia hạn để tiếp tục sử dụng.",
        "stopping": "❌ Bot của bạn đang trong trạng thái bảo trì! Hãy liên hệ admin."
      };
      return await sendMessage(api, statusMessages[botInfo.status], threadId, type, message);
    }
    const pm2Status = await checkPM2Status(uidFrom);
    if (botInfo.status === "running" && pm2Status.running) {
      await sendMessage(api, "⏳ Đang khởi động lại bot của bạn", threadId, type, message);
      const restartSuccess = await restartPM2Process(uidFrom);
      if (restartSuccess) {
        await sendMessage(api, `🔄 Đã khởi động lại bot "${uidFrom}" thành công!\n\n📋 Thông tin:\n• Bot ID: ${uidFrom}\n• Người sở hữu: ${dName}\n• Trạng thái: ✅ Đang hoạt động\n• Web Port: ${botInfo.webPort}`, threadId, type, message);
        console.log(`Bot "${uidFrom}" đã được khởi động lại bởi ${dName}`);
      } else {
        await sendMessage(api, "❌ Không thể khởi động lại bot. Vui lòng thử lại sau!", threadId, type, message);
      }
      return;
    }
    if (botInfo.status === "stopped" || !pm2Status.running) {
      await sendMessage(api, "⏳ Đang khởi động bot của bạn", threadId, type, message);
      if (!fs.existsSync(launcherPath)) {
        return await sendMessage(api, "❌ Đã xảy ra lỗi nghiêm trọng!!!", threadId, type, message);
      }
      const startSuccess = await startBotWithLauncher(uidFrom);
      if (startSuccess) {
        await updateBotStatus(uidFrom, "running");
        await sendMessage(api, `✅ Bot "${uidFrom}" đã được khởi động thành công!\n\n📋 Thông tin:\n• Bot ID: ${uidFrom}\n• Người sở hữu: ${dName}\n• Trạng thái: ✅ Đang hoạt động\n• Web Port: ${botInfo.webPort}`, threadId, type, message);
        console.log(`Bot "${uidFrom}" đã được khởi động bởi ${dName}`);
      } else {
        await sendMessage(api, "❌ Không thể khởi động bot. Vui lòng kiểm tra logs và thử lại sau!", threadId, type, message);
      }
      return;
    }
    await sendMessage(api, `📊 Trạng thái bot hiện tại: ${botInfo.status}\n\n💡 Vui lòng liên hệ admin nếu cần hỗ trợ.`, threadId, type, message);
  } catch (error) {
    await handleError(error, api, threadId, "khởi động bot", type, message);
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
async function restartPM2Process(processName) {
  return new Promise((resolve) => {
    const pm2Command = isWindows ? "pm2.cmd" : "pm2";
    const pm2Process = spawn(pm2Command, ["restart", processName], {
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
        console.log(`Successfully restarted PM2 process: ${processName}`);
        resolve(true);
      } else {
        console.error(`Failed to restart PM2 process: ${processName}`);
        if (errorOutput) console.error(`Error: ${errorOutput}`);
        resolve(false);
      }
    });
    pm2Process.on("error", (error) => {
      console.error(`Error restarting PM2 process: ${error.message}`);
      resolve(false);
    });
    setTimeout(() => {
      pm2Process.kill();
      console.error(`Timeout restarting PM2 process: ${processName}`);
      resolve(false);
    }, 30000);
  });
}
async function startBotWithLauncher(uidFrom) {
  return new Promise((resolve) => {
    console.log(`Khởi động bot ${uidFrom} qua launcher: ${launcherPath}`);
    const launcherProcess = spawn("node", [launcherPath, uidFrom], {
      stdio: "pipe",
      shell: isWindows,
      windowsHide: isWindows,
      detached: !isWindows,
      env: {
        ...process.env,
        UID_FROM: uidFrom
      }
    });
    let output = "";
    let errorOutput = "";
    let hasStarted = false;
    launcherProcess.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;
      if (text.includes("Successfully") || text.includes("started") || text.includes("listening")) {
        hasStarted = true;
      }
    });
    launcherProcess.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });
    const checkTimeout = setTimeout(async () => {
      console.log(`Checking PM2 status for bot ${uidFrom}...`);
      try {
        const isRunning = await waitForPM2Process(uidFrom, 45000);
        if (isRunning) {
          console.log(`Bot ${uidFrom} confirmed running in PM2`);
          resolve(true);
        } else {
          console.error(`Bot ${uidFrom} failed to start in PM2`);
          if (output) console.log(`Output: ${output}`);
          if (errorOutput) console.error(`Error: ${errorOutput}`);
          resolve(false);
        }
      } catch (error) {
        console.error(`Error checking PM2 status: ${error.message}`);
        resolve(false);
      }
    }, 5000);
    launcherProcess.on("close", (code) => {
      clearTimeout(checkTimeout);
      if (code === 0 || hasStarted) {
        console.log(`Launcher exited with code ${code}, checking PM2 status...`);
        setTimeout(async () => {
          const status = await checkPM2Status(uidFrom);
          resolve(status.running);
        }, 2000);
      } else {
        console.error(`Launcher failed with exit code: ${code}`);
        if (errorOutput) console.error(`Error: ${errorOutput}`);
        if (output) console.error(`Output: ${output}`);
        resolve(false);
      }
    });
    launcherProcess.on("error", (error) => {
      clearTimeout(checkTimeout);
      console.error(`Launcher process error: ${error.message}`);
      resolve(false);
    });
    if (!isWindows) {
      launcherProcess.unref();
    }
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