import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import chalk from "chalk";
import { getDataAllGroup } from "../service-hahuyhoang/info-service/group-info.js";
import fs from "fs/promises";
import { readGroupSettings, readWebConfig, writeWebConfig } from "../utils/io-json.js";
import { MessageType } from "../api-zalo/models/Message.js";
import { sendBulkMessage, stopBulkMessage } from "./bulk-message.js";
import { changeStatusConfig } from "./change-status-config.js";
import { getCommandConfig } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình multer để xử lý tải lên file
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "../../assets/resources/"));
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage: storage });

let io;
let cachedFriends = null;
let lastFriendsFetchTime = 0;
const CACHE_DURATION = 10000; // 10 giây

let cachedGroups = null;
let lastGroupsFetchTime = 0;
const GROUPS_CACHE_DURATION = 10000; // 10 giây

export async function startWebServer(api) {
  const app = express();
  const httpServer = createServer(app);
  io = new Server(httpServer);
  let filePaths = [];

  app.use(express.static(path.join(__dirname, "../../public")));

  app.post("/upload", upload.array("files"), (req, res) => {
    filePaths = req.files.map((file) => file.path);
    res.json({ message: "Tải lên thành công", filePaths });
  });

  io.on("connection", (socket) => {
    console.log(chalk.green("Một client đã kết nối tới web socket"));

    socket.on("getAllFriends", async () => {
      try {
        const currentTime = Date.now();
        if (!cachedFriends || currentTime - lastFriendsFetchTime > CACHE_DURATION) {
          cachedFriends = await api.getAllFriends();
          lastFriendsFetchTime = currentTime;
        }
        socket.emit("friendsList", cachedFriends);
      } catch (error) {
        console.error(chalk.red("Lỗi khi lấy danh sách bạn bè:"), error);
        socket.emit("error", "Không thể lấy danh sách bạn bè");
      }
    });

    socket.on("getAllGroups", async () => {
      try {
        const currentTime = Date.now();
        if (!cachedGroups || currentTime - lastGroupsFetchTime > GROUPS_CACHE_DURATION) {
          const groups = await getDataAllGroup(api);
          const groupSettings = readGroupSettings();
          cachedGroups = groups.map((group) => ({
            ...group,
            settings: groupSettings[group.groupId] || {},
          }));
          lastGroupsFetchTime = currentTime;
        }
        socket.emit("groupsList", cachedGroups);
      } catch (error) {
        console.error(chalk.red("Lỗi khi lấy danh sách nhóm:"), error);
        socket.emit("error", "Không thể lấy danh sách nhóm");
      }
    });

    socket.on("sendMessageToSingle", async (data) => {
      const { id, type, message, delay } = data;

      let messageType = type === "friend" ? MessageType.DirectMessage : MessageType.GroupMessage;
      try {
        await api.sendMessagev1(
          {
            msg: message,
            attachments: filePaths,
            ttl: delay ? delay : 0,
            linkOn: false,
          },
          id,
          messageType
        );

        await deleteFiles(filePaths);
        filePaths = [];
      } catch (error) { }
    });

    socket.on("sendMessageAll", async (data) => {
      try {
        const { message, messageType, delay } = data;
        const type = messageType === "DirectMessage" ? MessageType.DirectMessage : MessageType.GroupMessage;
        const allDataList = type === MessageType.DirectMessage ? await api.getAllFriends() : await getDataAllGroup(api);

        for (const data of allDataList) {
          try {
            if (data) {
              await api.sendMessagev1(
                {
                  msg: message,
                  attachments: filePaths,
                  ttl: delay ? delay : 0,
                  linkOn: false,
                },
                type === MessageType.DirectMessage ? data.userId : data.groupId,
                type
              );
            }
          } catch (error) { }
        }
        socket.emit("messageSent", "Tin nhắn đã được gửi thành công");

        await deleteFiles(filePaths);
        filePaths = [];
      } catch (error) {
        console.error("Lỗi khi gửi tin nhắn:", error);
        socket.emit("error", "Không thể gửi tin nhắn");
      }
    });

    socket.on("sendMessageForSelected", async (data) => {
      try {
        const { message, delay } = data;
        const webConfig = readWebConfig();
        const selectedFriends = webConfig.selectedFriends;
        const selectedGroups = webConfig.selectedGroups;

        for (const friendId in selectedFriends) {
          try {
            await api.sendMessagev1(
              {
                msg: message,
                attachments: filePaths,
                ttl: delay ? delay : 0,
                linkOn: false,
              },
              friendId,
              MessageType.DirectMessage
            );
          } catch (error) { }
        }
        for (const groupId in selectedGroups) {
          try {
            await api.sendMessagev1(
              {
                msg: message,
                attachments: filePaths,
                ttl: delay ? delay : 0,
                linkOn: false,
              },
              groupId,
              MessageType.GroupMessage
            );
          } catch (error) { }
        }
        socket.emit("messageSent", "Tin nhắn đã được gửi thành công");

        await deleteFiles(filePaths);
        filePaths = [];
      } catch (error) {
        console.error("Lỗi khi gửi tin nhắn:", error);
        socket.emit("error", "Không thể gửi tin nhắn");
      }
    });

    socket.on("updateSelectedGroups", (selectedGroups) => {
      const configPath = path.join(process.cwd(), "assets", "web-config", "web-config.json");
      let config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      config.selectedGroups = selectedGroups;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    });

    socket.on("updateSelected", (selected) => {
      try {
        const webConfig = readWebConfig();
        webConfig.selectedGroups = selected.groups;
        webConfig.selectedFriends = selected.friends;
        writeWebConfig(webConfig);

        socket.emit("configUpdated", { success: true, message: "Cập nhật cấu hình từ websocket thành công" });
      } catch (error) {
        console.error("Lỗi khi cập nhật file config:", error);
        socket.emit("configUpdated", { success: false, message: "Lỗi khi cập nhật cấu hình" });
      }
    });

    socket.on("getSelectedData", () => {
      try {
        const webConfig = readWebConfig();
        socket.emit("selectedData", {
          selectedGroups: webConfig.selectedGroups || {},
          selectedFriends: webConfig.selectedFriends || {},
        });
      } catch (error) {
        console.error("Lỗi khi đọc file config:", error);
        socket.emit("error", "Không thể đọc dữ liệu đã chọn");
      }
    });

    socket.on("updateActiveBotStatus", async ({ groupId, groupName, isActive }) => {
      try {
        await changeStatusConfig({ api, groupId, groupName, command: "activeBot", isActive });
      } catch (error) {
        console.error("Lỗi khi cập nhật trạng thái Active Bot:", error);
      }
    });

    socket.on("updateFutureStatus", async ({ groupId, groupName, command, isActive }) => {
      try {
        await changeStatusConfig({ api, groupId, groupName, command, isActive });
      } catch (error) {
        console.error(`Lỗi khi cập nhật trạng thái ${command}:`, error);
      }
    });

    socket.on("getInitialData", async () => {
      try {
        const webConfig = readWebConfig();
        const groupSettings = readGroupSettings();

        socket.emit("initialData", { ...webConfig, groupSettings });
      } catch (error) {
        console.error("Lỗi khi đọc dữ liệu ban đầu:", error);
        socket.emit("initialData", {});
      }
    });

    socket.on("disconnect", () => {
      console.log(chalk.red("Một client đã ngắt kết nối tới web socket"));
    });

    socket.on("startBulkMessage", async (data) => {
      try {
        await sendBulkMessage(api, socket, data);
      } catch (error) {
        console.error("Lỗi khi bắt đầu gửi tin nhắn hàng loạt:", error);
        socket.emit("error", "Không thể bắt đầu gửi tin nhắn hàng loạt");
      }
    });

    socket.on("stopBulkMessage", async () => {
      try {
        await stopBulkMessage();
        socket.emit("bulkMessageStatus", "stopped");
      } catch (error) {
        console.error("Lỗi khi dừng gửi tin nhắn hàng loạt:", error);
        socket.emit("error", "Không thể dừng gửi tin nhắn hàng loạt");
      }
    });

    socket.on("getCommands", () => {
      try {
        const commandConfig = getCommandConfig();
        socket.emit("commandList", commandConfig);
      } catch (error) {
        socket.emit("error", "Không thể lấy danh sách lệnh");
      }
    });
  });

  const PORT = 3456;
  httpServer.listen(PORT, () => {
    console.log(chalk.yellow(`Web server đã khởi tạo thành công trên port ${PORT}`));
  });
}

export function getIO() {
  return io;
}

async function deleteFiles(paths) {
  for (const path of paths) {
    try {
      await fs.unlink(path);
    } catch (error) {
      console.error(`Lỗi khi xóa file ${path}:`, error);
    }
  }
}
