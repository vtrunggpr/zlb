import fs from "fs";
import path from "path";
import { spawn } from "child_process";
const projectRoot = path.resolve(process.cwd());
const myBotDir = path.join(projectRoot, "mybot");
const botsDir = path.join(myBotDir, "bots");
const myBotsPath = path.join(myBotDir, "mybots.json");
const defaultCommand = path.join(myBotDir, "defaultCommand.json");
const launcherPath = path.join(projectRoot, "index.js");
const isWindows = process.platform === "win32";
export async function createBot(api, message, groupAdmins, arg) {
  const { threadId, data: { uidFrom, dName, content }, type } = message;
  let args = content.split(/\s+/);
  if (arg) args = arg;
  if (type === 1) return sendMessage(api, "❌ Thông tin khởi tạo bot là thông tin nhạy cảm, vui lòng sử dụng lệnh tại tin nhắn riêng tư!", threadId, type, message);
  if (args.length < 2) return sendMessage(api, "❌ Vui lòng cung cấp cookie, imei để khởi tạo bot! \nTiện ích để lấy thông tin: https://drive.google.com/file/d/1a1PAK2S-zAvlDyjKlvAUcLv4HCXAiJK2/view?usp=drivesdk", threadId, type, message);
  const validationResult = validateCredentials(args);
  if (!validationResult.valid) {
    return await sendMessage(api, validationResult.message, threadId, type, message);
  }
  try {
    const checkResult = await checkExistingBot(uidFrom);
    if (checkResult.exists) {
      return await sendMessage(api, checkResult.message, threadId, type, message);
    }
    if (!fs.existsSync(launcherPath)) {
      return await sendMessage(api, "❌ Đã xảy ra lỗi nghiêm trọng trong dự án!", threadId, type, message);
    }
    await ensureDirectoriesExist();
    await sendMessage(api, "⏳ Đang khởi tạo bot của bạn, hãy đảm bảo cookie & imei hợp lệ!", threadId, type, message);
    const success = await startBotWithLauncher(uidFrom);
    if (success) {
      const now = new Date();
      const expiryTime = new Date(now.getTime() + 60 * 60 * 1000);
      await saveBotToMyBots(uidFrom, dName, webPort, expiryTime);
      await sendMessage(api, `🎉 Bot "${uidFrom}" đã được khởi tạo thành công!\n\n📋 Thông tin bot:\n• Bot ID: ${uidFrom}\n• Người tạo: ${dName}\n• Trạng thái: ✅ Hoạt động\n• Web Port: ${webPort}\n• ⏰ Thời hạn: 1 giờ (hết hạn lúc ${expiryTime.toLocaleString("vi-VN")})\💡 Nhắn tin riêng cho bot của bạn từ khoá "UID" để lấy uid của bạn, sau đó quay lại đây sử dụng lệnh !mybot add admin <uid của bạn>`, threadId, type, message);
      console.log(`Bot con "${uidFrom}" đã được khởi tạo thành công bởi ${dName} trên port ${webPort}`);
    } else {
      return sendMessage(api, "❌ Không thể khởi động bot. Vui lòng kiểm tra logs để biết chi tiết!", threadId, type, message);
    }
  } catch (error) {
    await handleError(error, api, threadId, "tạo bot", type, message);
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

function validateCredentials(args) {
  const defaultUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  let cookie;
  try {
    cookie = JSON.parse(args[1]);
    if (typeof cookie !== "object" || cookie === null || Array.isArray(cookie)) {
      return {
        valid: false,
        message: "❌ Cookie phải là JSON object hợp lệ!\n\n📝 Ví dụ: {\"session\":\"abc123\",\"token\":\"xyz789\"}"
      };
    }
  } catch (error) {
    return {
      valid: false,
      message: "❌ Cookie không đúng định dạng JSON!\n\n📝 Ví dụ: {\"session\":\"abc123\",\"token\":\"xyz789\"}"
    };
  }
  const imei = args[2];
  if (typeof imei !== "string" || imei.trim() === "") {
    return {
      valid: false,
      message: "❌ IMEI phải là chuỗi không rỗng!\n\n📝 Ví dụ: \"123456789012345\""
    };
  }
  let userAgent = args.slice(3).join(" ") || defaultUserAgent;
  if (args[3] && !isValidUserAgent(args[3])) {
    userAgent = defaultUserAgent;
  }
  return {
    valid: true,
    credentials: { cookie, imei, userAgent }
  };
}

async function checkExistingBot(uidFrom) {
  try {
    if (!fs.existsSync(myBotsPath)) {
      return { exists: false };
    }
    const myBots = JSON.parse(fs.readFileSync(myBotsPath, "utf8"));
    const existingBot = myBots[uidFrom];
    if (!existingBot) {
      return { exists: false };
    }
    const pm2Status = await checkPM2Status(uidFrom);
    if (pm2Status.running) {
      return { exists: true, message: "❌ Bạn đã có một bot đang hoạt động! Mỗi người chỉ được tạo 1 bot." };
    }
    switch (existingBot.status) {
    case "running":
      if (!pm2Status.running) {
        existingBot.status = "stopped";
        myBots[uidFrom] = existingBot;
        fs.writeFileSync(myBotsPath, JSON.stringify(myBots, null, 2));
        return { exists: false };
      }
      return { exists: true, message: "❌ Bạn đã có một bot đang hoạt động! Mỗi người chỉ được tạo 1 bot." };
    case "trialExpired":
      return { exists: true, message: "❌ Bạn đã hết thời gian dùng thử! Hãy gia hạn bot của bạn." };
    case "expired":
      return { exists: true, message: "❌ Bot của bạn đã hết hạn! Hãy gia hạn để tiếp tục sử dụng." };
    case "stopping":
      return { exists: true, message: "❌ Bot của bạn đang trong trạng thái bảo trì! Hãy liên hệ admin." };
    default:
      return { exists: true };
    }
  } catch (error) {
    console.error(`Lỗi kiểm tra bot hiện có: ${error.message}`);
    return { exists: false };
  }
}

function createBotConfig(uidFrom, webPort) {
  return {
    "name": uidFrom,
    "configFilePath": `mybot/credentials/${uidFrom}.json`,
    "groupSettingsPath": `mybot/settings/groupSettings-${uidFrom}.json`,
    "adminFilePath": `mybot/configs/admins-${uidFrom}.json`,
    "commandFilePath": `mybot/json-data/command-${uidFrom}.json`,
    "MANAGER_FILE_PATH": `mybot/json-data/manager-${uidFrom}.json`,
    "DATA_GAME_FILE_PATH": `mybot/json-data/game_data-${uidFrom}.json`,
    "DATA_NT_PATH": `mybot/json-data/nong-trai-${uidFrom}.json`,
    "PROPHYLACTIC_CONFIG_PATH": `mybot/json-data/prophylactic-${uidFrom}.json`,
    "logDir": `logs/${uidFrom}`,
    "resourceDir": `assets/resources/${uidFrom}`,
    "tempDir": `assets/temp/${uidFrom}`,
    "dataGifPath": `assets/resources/gif/${uidFrom}`,
    "WEB_CONFIG_PATH": `mybot/json-data/web_config-${uidFrom}.json`,
    "webPort": webPort.toString(),
    "databaseFile": `mybot/json-data/database_config-${uidFrom}.json`,
    "dataTrainingPath": `mybot/json-data/data_training-${uidFrom}.json`,
    "rankInfoPath": `mybot/json-data/rank_info-${uidFrom}.json`
  };
}
async function createAllRequiredFiles(uidFrom, args, botConfig) {
  const requiredDirs = [
    path.join(myBotDir, "credentials"),
    path.join(myBotDir, "configs"),
    path.join(myBotDir, "settings"),
    path.join(myBotDir, "json-data"),
    path.join(projectRoot, "logs", uidFrom),
    path.join(projectRoot, "assets", "resources", uidFrom),
    path.join(projectRoot, "assets", "temp", uidFrom),
    path.join(projectRoot, "assets", "resources", "gif", uidFrom)
  ];
  requiredDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  const credentialsData = {
    "cookie": ,
    "imei": ,
    "userAgent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
  };
  const fileMap = {
    [path.join(projectRoot, botConfig.configFilePath)]: credentialsData,
    [path.join(projectRoot, botConfig.groupSettingsPath)]: {},
    [path.join(projectRoot, botConfig.adminFilePath)]: [],
    [path.join(projectRoot, botConfig.MANAGER_FILE_PATH)]: {
      "groupRequiredReset": "-1",
      "onGamePrivate": true,
      "onBotPrivate": true
    },
    [path.join(projectRoot, botConfig.DATA_GAME_FILE_PATH)]: {},
    [path.join(projectRoot, botConfig.PROPHYLACTIC_CONFIG_PATH)]: {
      "prophylacticUploadAttachment": {
        "enable": false,
        "lastBlocked": Date.now(),
        "numRequestZalo": 1,
        "lastRequestTime": Date.now()
      }
    },
    [path.join(projectRoot, botConfig.WEB_CONFIG_PATH)]: {},
    [path.join(projectRoot, botConfig.databaseFile)]: {
      "nameServer": "HA HUY HOANG",
      "host": "localhost",
      "user": "ROOT",
      "password": "12345679",
      "database": `${uidFrom}`,
      "port": 3306,
      "tablePlayerZalo": "players_zalo",
      "tableAccount": "account",
      "dailyReward": 100000000000
    },
    [path.join(projectRoot, botConfig.dataTrainingPath)]: {},
    [path.join(projectRoot, botConfig.rankInfoPath)]: {}
  };
  for (const [filePath, data] of Object.entries(fileMap)) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      throw new Error(`Không thể tạo file ${filePath}: ${error.message}`);
    }
  }
  if (fs.existsSync(defaultCommand)) {
    try {
      await fs.promises.copyFile(defaultCommand, path.join(projectRoot, botConfig.commandFilePath));
    } catch (error) {
      throw new Error(`Không thể copy file defaultCommand.json: ${error.message}`);
    }
  } else {
    fs.writeFileSync(path.join(projectRoot, botConfig.commandFilePath), JSON.stringify({}, null, 2));
  }
  const botConfigPath = path.join(botsDir, `${uidFrom}.json`);
  try {
    fs.writeFileSync(botConfigPath, JSON.stringify(botConfig, null, 4));
  } catch (error) {
    throw new Error(`Không thể tạo file config bot: ${error.message}`);
  }
}

async function ensureDirectoriesExist() {
  const directories = [
    myBotDir, 
    botsDir,
    path.join(myBotDir, "credentials"),
    path.join(myBotDir, "configs"),
    path.join(myBotDir, "settings"),
    path.join(myBotDir, "json-data")
  ];
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  if (!fs.existsSync(myBotsPath)) {
    fs.writeFileSync(myBotsPath, JSON.stringify({}, null, 2));
  }
}
async function sendMessage(api, msg, threadId, type, message) {
  try {
    await api.sendMessage({msg: msg, quote: message, ttl: 120000}, threadId, type);
  } catch (err) {
    console.error(`Lỗi khi gửi tin nhắn: ${err.message}`);
    console.error(`Lỗi khi gửi tin nhắn: ${err}`);
  }
}
async function handleError(error, api, threadId, context, type, message) {
  console.error(`Lỗi ${context}: ${error.message}`);
  console.error(`Stack trace: ${error.stack}`);
  let errorDetails = error.message;
  if (error.code) errorDetails += ` (Code: ${error.code})`;
  if (error.path) errorDetails += ` (Path: ${error.path})`;
  await sendMessage(api, `❌ Đã xảy ra lỗi khi ${context}!\n\n🔍 Chi tiết: ${errorDetails}\n\n💡 Vui lòng kiểm tra logs và thử lại sau.`, threadId, type, message);
}