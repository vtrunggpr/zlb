import fs from "fs";
import path from "path";
import { createBot } from "./createBot.js";
import { stopBot } from "./stopBot.js";
import { startBot } from "./startBot.js";
import { deleteBot } from "./deleteBot.js";
import { infoBot } from "./infoBot.js";
const projectRoot = path.resolve(process.cwd());
const myBotDir = path.join(projectRoot, "mybot");
const myBotsPath = path.join(myBotDir, "mybots.json");
const configsDir = path.join(myBotDir, "configs");
export async function myBot(api, message, groupAdmins) {
  const { threadId, data: { uidFrom, dName, content, mentions }, type } = message;
  const args = content.split(/\s+/);
  try {
    if (!args || args.length < 2 ) {
      return await sendMessage(api, "📋 Các lệnh có sẵn:\n• mybot list - Xem danh sách bot\n• mybot login - Khởi tạo bot của bạn\n• mybot stop - Dừng bot của bạn\n• mybot restart - Khởi động lại bot của bạn\n• mybot delete - Xoá bot của bạn⚠️\n• mybot update name [tên] - Cập nhật tên hiển thị\n• mybot update description [mô tả] - Cập nhật mô tả bot\n• mybot add admin [uid/@tag] - Thêm admin cho bot", threadId, type, message);
    }
    const subCommand = args[1].toLowerCase();
    const arg = args.slice(1);
    switch (subCommand) {
    case "info":
      await infoBot(api, message, groupAdmins, arg);
      break;
    case "start":
    case "restart":
    case "rs":
      await startBot(api, message, groupAdmins, arg);
      break;
    case "stop":
      await stopBot(api, message, groupAdmins, arg);
      break;
    case "delete":
    case "del":
      await deleteBot(api, message, groupAdmins, arg);
      break;
    case "login":
    case "create":
      await createBot(api, message, groupAdmins, arg);
      break;
    case "list":
      await handleListBots(api, threadId, type, message);
      break;
    case "update":
      if (args.length < 3) {
        return await sendMessage(api, "❌ Sai cú pháp!\n\n📝 Cách dùng:\n• mybot update name [tên mới]\n• mybot update description [mô tả mới]", threadId, type, message);
      }
      const updateType = args[2].toLowerCase();
      const newValue = args.slice(3).join(" ");
      if (updateType === "name") {
        await handleUpdateName(api, uidFrom, dName, newValue, threadId, type, message);
      } else if (updateType === "description") {
        await handleUpdateDescription(api, uidFrom, dName, newValue, threadId, type, message);
      } else {
        await sendMessage(api, "❌ Chỉ hỗ trợ update: name hoặc description", threadId, type, message);
      }
      break;
    case "add":
      if (args.length < 3 || args[2].toLowerCase() !== "admin") {
        return await sendMessage(api, "❌ Sai cú pháp!\n\n📝 Cách dùng: mybot add admin [uid] hoặc @tag", threadId, type, message);
      }
      let adminUid = args[3];
      if (mentions && mentions.length > 0) adminUid = mentions[0].uid;
      await handleAddAdmin(api, uidFrom, dName, adminUid, threadId, type, message);
      break;
    default:
      await sendMessage(api, `❌ Lệnh "${subCommand}" không tồn tại!\n\n📋 Các lệnh có sẵn:\n• mybot list - Xem danh sách bot\n• mybot update name [tên] - Cập nhật tên hiển thị\n• mybot update description [mô tả] - Cập nhật mô tả bot\n• mybot add admin [uid] - Thêm admin cho bot`, threadId, type, message);
      break;
    }
  } catch (error) {
    await handleError(error, api, threadId, "xử lý lệnh mybot", type, message);
  }
}
async function handleListBots(api, threadId, type, message) {
  try {
    if (!fs.existsSync(myBotsPath)) {
      return await sendMessage(api, "❌ Chưa có bot nào được tạo!", threadId, type, message);
    }
    const myBots = JSON.parse(fs.readFileSync(myBotsPath, "utf8"));
    const botList = Object.values(myBots);
    if (botList.length === 0) {
      return await sendMessage(api, "❌ Danh sách bot trống!", threadId, type, message);
    }
    let listMessage = `📋 DANH SÁCH TẤT CẢ BOT (${botList.length} bot)\n\n`;
    botList.forEach((bot, index) => {
      const botName = bot.displayName || bot.name || "Không có tên";
      const createdBy = bot.createdBy || "Không rõ";
      const createdAt = formatDateTime(new Date(bot.createdAt));
      const expiryAt = formatDateTime(new Date(bot.expiryAt));
      const statusIcons = {
        "running": "✅",
        "stopped": "⏹️",
        "trialExpired": "⏰",
        "expired": "❌",
        "stopping": "🔧"
      };
      const statusIcon = statusIcons[bot.status] || "❓";
      listMessage += `${index + 1}. 🤖 ${botName}\n`;
      listMessage += `   👤 Người tạo: ${createdBy}\n`;
      listMessage += `   🆔 Bot ID: ${bot.name}\n`;
      listMessage += `   📅 Ngày tạo: ${createdAt}\n`;
      listMessage += `   ⏰ Hết hạn: ${expiryAt}\n`;
      listMessage += `   📊 Trạng thái: ${statusIcon} ${bot.status}\n`;
      if (bot.description) {
        listMessage += `   📝 Mô tả: ${bot.description}\n`;
      }
      listMessage += "\n";
    });
    await sendMessage(api, listMessage, threadId, type, message);
  } catch (error) {
    console.error(`Lỗi lấy danh sách bot: ${error.message}`);
    await sendMessage(api, "❌ Không thể lấy danh sách bot. Vui lòng thử lại sau!", threadId, type, message);
  }
}
async function handleUpdateName(api, uidFrom, dName, newName, threadId, type, message) {
  try {
    const checkResult = await checkBotExists(uidFrom);
    if (!checkResult.exists) {
      return await sendMessage(api, "❌ Bạn chưa có bot nào được tạo!", threadId, type, message);
    }
    if (!newName || newName.trim().length === 0) {
      return await sendMessage(api, "❌ Tên hiển thị không được để trống!", threadId, type, message);
    }
    if (newName.length > 50) {
      return await sendMessage(api, "❌ Tên hiển thị không được quá 50 ký tự!", threadId, type, message);
    }
    const trimmedName = newName.trim();
    const updated = await updateBotField(uidFrom, "displayName", trimmedName);
    if (updated) {
      await sendMessage(api, `✅ Đã cập nhật tên hiển thị thành công!\n\n🤖 Tên mới: ${trimmedName}\n👤 Cập nhật bởi: ${dName}`, threadId, type, message);
      console.log(`Bot ${uidFrom} displayName updated to "${trimmedName}" by ${dName}`);
    } else {
      await sendMessage(api, "❌ Không thể cập nhật tên hiển thị. Vui lòng thử lại!", threadId, type, message);
    }
  } catch (error) {
    console.error(`Lỗi cập nhật tên bot: ${error.message}`);
    await sendMessage(api, "❌ Đã xảy ra lỗi khi cập nhật tên hiển thị!", threadId, type, message);
  }
}
async function handleUpdateDescription(api, uidFrom, dName, newDescription, threadId, type, message) {
  try {
    const checkResult = await checkBotExists(uidFrom);
    if (!checkResult.exists) {
      return await sendMessage(api, "❌ Bạn chưa có bot nào được tạo!", threadId, type, message);
    }
    if (!newDescription || newDescription.trim().length === 0) {
      return await sendMessage(api, "❌ Mô tả không được để trống!", threadId, type, message);
    }
    if (newDescription.length > 200) {
      return await sendMessage(api, "❌ Mô tả không được quá 200 ký tự!", threadId, type, message);
    }
    const trimmedDescription = newDescription.trim();
    const updated = await updateBotField(uidFrom, "description", trimmedDescription);
    if (updated) {
      await sendMessage(api, `✅ Đã cập nhật mô tả bot thành công!\n\n📝 Mô tả mới: ${trimmedDescription}\n👤 Cập nhật bởi: ${dName}`, threadId, type, message);
      console.log(`Bot ${uidFrom} description updated by ${dName}`);
    } else {
      await sendMessage(api, "❌ Không thể cập nhật mô tả. Vui lòng thử lại!", threadId, type, message);
    }
  } catch (error) {
    console.error(`Lỗi cập nhật mô tả bot: ${error.message}`);
    await sendMessage(api, "❌ Đã xảy ra lỗi khi cập nhật mô tả!", threadId, type, message);
  }
}
async function handleAddAdmin(api, uidFrom, dName, adminUid, threadId, type, message) {
  try {
    const checkResult = await checkBotExists(uidFrom);
    if (!checkResult.exists) {
      return await sendMessage(api, "❌ Bạn chưa có bot nào được tạo!", threadId, type, message);
    }
    if (!adminUid || adminUid.trim().length === 0) {
      return await sendMessage(api, "❌ UID admin không được để trống!", threadId, type, message);
    }
    if (!/^\d+$/.test(adminUid.trim())) {
      return await sendMessage(api, "❌ UID admin phải là một chuỗi số!", threadId, type, message);
    }
    const trimmedUid = adminUid.trim();
    if (!fs.existsSync(configsDir)) {
      fs.mkdirSync(configsDir, { recursive: true });
    }
    const adminFilePath = path.join(configsDir, `admins-${uidFrom}.json`);
    let adminList = [];
    if (fs.existsSync(adminFilePath)) {
      try {
        const adminData = fs.readFileSync(adminFilePath, "utf8");
        adminList = JSON.parse(adminData);
        if (!Array.isArray(adminList)) {
          adminList = [];
        }
      } catch (parseError) {
        console.warn(`File admin bị lỗi, tạo mới: ${parseError.message}`);
        adminList = [];
      }
    }
    if (adminList.includes(trimmedUid)) {
      return await sendMessage(api, `❌ UID ${trimmedUid} đã là admin của bot này rồi!`, threadId, type, message);
    }
    adminList.push(trimmedUid);
    fs.writeFileSync(adminFilePath, JSON.stringify(adminList, null, 2));
    await sendMessage(api, `✅ Đã thêm UID: ${trimmedUid} vào danh sách admin bot của bạn\n🤖 Bot ID: ${uidFrom}\n👤 Thêm bởi: ${dName}\n\n📊 Tổng admin hiện tại: ${adminList.length}`, threadId, type, message);
    console.log(`Added admin ${trimmedUid} to bot ${uidFrom} by ${dName}`);
  } catch (error) {
    console.error(`Lỗi thêm admin: ${error.message}`);
    await sendMessage(api, "❌ Đã xảy ra lỗi khi thêm admin!", threadId, type, message);
  }
}

async function updateBotField(uidFrom, field, value) {
  try {
    if (!fs.existsSync(myBotsPath)) {
      throw new Error("File mybots.json không tồn tại");
    }
    const myBots = JSON.parse(fs.readFileSync(myBotsPath, "utf8"));
    if (!myBots[uidFrom]) {
      throw new Error("Bot không tồn tại trong danh sách");
    }
    myBots[uidFrom][field] = value;
    myBots[uidFrom].lastUpdated = new Date().toISOString();
    fs.writeFileSync(myBotsPath, JSON.stringify(myBots, null, 2));
    console.log(`Đã cập nhật ${field} cho bot ${uidFrom}`);
    return true;
  } catch (error) {
    console.error(`Lỗi cập nhật ${field}: ${error.message}`);
    return false;
  }
}
function formatDateTime(date) {
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh"
  };
  return date.toLocaleString("vi-VN", options);
}

async function handleError(error, api, threadId, context, type, message) {
  console.error(`Lỗi ${context}: ${error.message}`);
  console.error(`Stack trace: ${error.stack}`);
  let errorDetails = error.message;
  if (error.code) errorDetails += ` (Code: ${error.code})`;
  if (error.path) errorDetails += ` (Path: ${error.path})`;
  await sendMessage(api, `❌ Đã xảy ra lỗi khi ${context}!\n\n🔍 Chi tiết: ${errorDetails}\n\n💡 Vui lòng thử lại sau hoặc liên hệ admin.`, threadId, type, message);
}