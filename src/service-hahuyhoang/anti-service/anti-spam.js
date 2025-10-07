import { MessageMention, MessageType } from "zlbotdqt";
import schedule from "node-schedule";
import { getGroupInfoData } from "../../service-hahuyhoang/info-service/group-info.js";
import { getUserInfoData } from "../../service-hahuyhoang/info-service/user-info.js";
import * as cv from "../../utils/canvas/index.js";
import { sendMessageStateQuote } from "../chat-zalo/chat-style/chat-style.js";
import { isInWhiteList } from "./white-list.js";
import { removeMention } from "../../utils/format-util.js";

const userMessageCounts = new Map();
const kickedUsers = new Set();
const userMessage = new Map();
const userMessageTimestamps = new Map();
const userWarnings = new Map();
const MESSAGE_THRESHOLD = 4;
const MESSAGE_THRESHOLD_REPEATED = 5;
const MESSAGE_THRESHOLD_LONG = 4;
const TIME_WINDOW = 5000;
const WARNING_RESET_TIME = 1800000;
const SPAM_PATTERNS = {
  RAPID_MESSAGES: "RAPID_MESSAGES",
  REPEATED_CONTENT: "REPEATED_CONTENT",
  BULK_MESSAGES: "BULK_MESSAGES",
};

const historyBugOrUsers = new Map();

export async function antiSpam(
  api,
  message,
  groupInfo,
  isAdminBox,
  groupSettings,
  botIsAdminBox,
  isSelf
) {
  const senderId = message.data.uidFrom;
  const senderName = message.data.dName;
  const threadId = message.threadId;
  const timestamp = Number(message.data.ts);

  if (
    isAdminBox ||
    kickedUsers.has(senderId) ||
    isSelf ||
    !botIsAdminBox ||
    isInWhiteList(groupSettings, threadId, senderId)
  )
    return false;

  if (groupSettings[threadId]?.antiSpam ?? false) {
    if (!groupInfo.memVerList.includes(senderId + "_0")) {
      if (!historyBugOrUsers.has(threadId)) {
        historyBugOrUsers.set(threadId, new Map());
      }

      const historyBugInThread = historyBugOrUsers.get(threadId);
      if (!historyBugInThread.has(senderId)) {
        historyBugInThread.set(senderId, []);
      }

      historyBugInThread.get(senderId).push(Date.now());
      if (historyBugInThread.get(senderId).length > 2) {
        const endTimeProcess = Date.now() + 10000;
        const isBlockCompleted = false;

        const approveTask = async () => {
          while (Date.now() < endTimeProcess && !isBlockCompleted) {
            try {
              await api.handleGroupPendingMembers(threadId, true, {
                users: [
                  {
                    uid: senderId,
                  },
                ],
              });
            } catch {}
          }
        };

        const blockTask = async () => {
          while (Date.now() < endTimeProcess && !isBlockCompleted) {
            try {
              await api.blockUsers(threadId, [senderId]);
              await api.sendMessage(
                {
                  msg: `${senderName} bị sút khỏi nhóm vì dám spam không tham gia nhóm trước mặt Hoàng Khoai TO.`,
                  mentions: [MessageMention(senderId, senderName.length, 0)],
                },
                threadId,
                message.type
              );
              isBlockCompleted = true;
            } catch {}
          }
        };

        await Promise.all([approveTask(), blockTask()]);
        historyBugInThread.delete(senderId);
        return true;
      }
    }

    if (!userMessageTimestamps.has(threadId)) {
      userMessageTimestamps.set(threadId, new Map());
    }
    const threadMessages = userMessageTimestamps.get(threadId);
    
    if (!threadMessages.has(senderId)) {
      threadMessages.set(senderId, []);
    }

    const timestamps = threadMessages.get(senderId);
    timestamps.push({
      time: timestamp,
      content: message.data.content,
      length: message.data.content?.length || 0,
    });

    const currentTime = Date.now();
    const recentTimestamps = timestamps.filter((msg) => currentTime - msg.time <= TIME_WINDOW);
    threadMessages.set(senderId, recentTimestamps);

    const spamAnalysis = analyzeSpamBehavior(recentTimestamps, threadId, senderId);

    if (spamAnalysis.isSpam) {
      try {
        const warningResult = await handleWarning(
          api,
          message,
          threadId,
          senderId,
          senderName,
          spamAnalysis.type
        );

        if (warningResult.shouldBlock) {
          await handleSpamDetected(api, message, threadId, senderId, senderName, spamAnalysis.type);
          return true;
        }
      } catch (error) {
        console.error("Lỗi khi xử lý spam:", error);
      }
    }
  }
  
  return false;
}

function analyzeSpamBehavior(messages, threadId, senderId) {
  if (messages.length >= MESSAGE_THRESHOLD) {
    const timeSpan = messages[messages.length - 1].time - messages[0].time;
    if (timeSpan < TIME_WINDOW) {
      return { isSpam: true, type: SPAM_PATTERNS.RAPID_MESSAGES };
    }
  }

  const contentMap = new Map();
  for (const msg of messages) {
    let normalizedContent = "";

    if (typeof msg.content === "object") {
      normalizedContent = normalizeObjectContent(msg.content);
    } else {
      normalizedContent = String(msg.content || "").trim();
    }

    if (normalizedContent) {
      let isContentSimilar = false;
      for (const [existingContent] of contentMap) {
        const similarity = calculateContentSimilarity(normalizedContent, existingContent);
        if (similarity > 0.8) {
          const count = contentMap.get(existingContent) + 1;
          contentMap.set(existingContent, count);
          if (count >= MESSAGE_THRESHOLD_REPEATED) {
            return { isSpam: true, type: SPAM_PATTERNS.REPEATED_CONTENT };
          }
          isContentSimilar = true;
          break;
        }
      }

      if (!isContentSimilar) {
        contentMap.set(normalizedContent, 1);
      }
    }
  }

  const longMessages = messages.filter((msg) => {
    const contentLength =
      typeof msg.content === "object"
        ? JSON.stringify(msg.content).length
        : msg.content?.length || 0;
    return contentLength > 100;
  });

  if (longMessages.length >= MESSAGE_THRESHOLD_LONG) {
    return { isSpam: true, type: SPAM_PATTERNS.BULK_MESSAGES };
  }

  return { isSpam: false };
}

function normalizeObjectContent(content) {
  try {
    if (!content) return "";

    if (content.title) return content.title;
    if (content.text) return content.text;
    if (content.caption) return content.caption;
    if (content.description) return content.description;
    if (content.message) return content.message;

    const contentCopy = { ...content };
    delete contentCopy.timestamp;
    delete contentCopy.id;
    delete contentCopy.time;
    delete contentCopy.date;

    return JSON.stringify(contentCopy);
  } catch (error) {
    console.error("Lỗi khi chuẩn hóa content:", error);
    return "";
  }
}

function calculateContentSimilarity(str1, str2) {
  if (typeof str1 !== "string" || typeof str2 !== "string") {
    return 0;
  }

  str1 = str1.toLowerCase().trim();
  str2 = str2.toLowerCase().trim();

  if (str1 === str2) return 1;

  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1;

  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLength;
}

function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1)
    .fill()
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j - 1] + 1, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
      }
    }
  }

  return dp[m][n];
}

async function handleSpamDetected(api, message, threadId, senderId, senderName, spamType, groupSettings) {
  const messageIds = userMessage.get(senderId) || [];
  for (const msgId of messageIds) {
    await api.deleteMessage(msgId, false).catch(console.error);
  }
 
  const groupInfo = await getGroupInfoData(api, threadId);
  const userInfo = await getUserInfoData(api, senderId);
  let imagePath = null;
  try {
    if (groupSettings?.[threadId]?.enableBlockImage === true) {
    imagePath = await cv.createBlockSpamImage(
      userInfo,
      groupInfo.name,
      groupInfo.groupType,
      userInfo.gender
    );
  }
    await api.blockUsers(threadId, [senderId]);
    kickedUsers.add(senderId);

    let spamMessage = "";
    switch (spamType) {
      case SPAM_PATTERNS.RAPID_MESSAGES:
        spamMessage = "gửi tin nhắn quá nhanh";
        break;
      case SPAM_PATTERNS.REPEATED_CONTENT:
        spamMessage = "gửi tin nhắn lặp lại nhiều lần";
        break;
      case SPAM_PATTERNS.BULK_MESSAGES:
        spamMessage = "gửi nhiều tin nhắn dài trong thời gian ngắn";
        break;
    }

    await api.sendMessage(
      {
        msg: `Thành viên [ ${senderName} ] đã bị chặn do ${spamMessage}! 🚫`,
        attachments: [imagePath],
      },
      threadId,
      MessageType.GroupMessage
    );

    try {
      await api.sendMessage(
        {
          msg: `Bạn đã bị chặn do ${spamMessage}! 🚫\nVui lòng không lặp lại hành vi này.`,
          attachments: [imagePath],
        },
        senderId,
        MessageType.DirectMessage
      );
    } catch (error) {
      console.error(`Không thể gửi tin nhắn tới ${senderId}:`, error.message);
    }
  } catch (error) {
    console.error("Lỗi khi xử lý kick spam:", error);
  } finally {
    await cv.clearImagePath(imagePath);
  }

  setTimeout(() => {
    kickedUsers.delete(senderId);
  }, 5000);

  userMessage.delete(senderId);
  userMessageCounts.delete(senderId);
  userMessageTimestamps.delete(senderId);
}

async function handleWarning(api, message, threadId, senderId, senderName, spamType) {
  if (!userWarnings.has(senderId)) {
    userWarnings.set(senderId, {
      count: 0,
      lastWarningTime: Date.now(),
    });
  }

  const warning = userWarnings.get(senderId);
  const currentTime = Date.now();

  const warningReductions = Math.floor(
    (currentTime - warning.lastWarningTime) / WARNING_RESET_TIME
  );
  if (warningReductions > 0) {
    warning.count = Math.max(0, warning.count - warningReductions);
  }

  warning.count++;
  warning.lastWarningTime = currentTime;

  if (warning.count < 3) {
    let caption = `⚠️ Cảnh cáo ${senderName}!\nChậm cái tay lại bạn êy, tay hơi nhanh rồi đấy!`;
    if (warning.count === 2) {
      caption = `⚠️ Cảnh cáo ${senderName}!\nNhắn chậm lại, tao xút mày ra khỏi box bây giờ!`;
    }
    await api.sendMessage(
      {
        msg: caption,
        mentions: [MessageMention(senderId, senderName.length, "⚠️ Cảnh cáo ".length)],
        ttl: 8000,
      },
      threadId,
      MessageType.GroupMessage
    );
    return { shouldBlock: false };
  } else {
    userWarnings.delete(senderId);
    return { shouldBlock: true };
  }
}

schedule.scheduleJob("*/1 * * * *", () => {
  const currentTime = Date.now();
  
  for (const [senderId, warning] of userWarnings.entries()) {
    const warningReductions = Math.floor(
      (currentTime - warning.lastWarningTime) / WARNING_RESET_TIME
    );
    if (warningReductions > 0) {
      warning.count = Math.max(0, warning.count - warningReductions);
      warning.lastWarningTime = currentTime;

      if (warning.count === 0) {
        userWarnings.delete(senderId);
      }
    }
  }

  for (const [threadId, threadMessages] of userMessageTimestamps.entries()) {
    for (const [userId, messages] of threadMessages.entries()) {
      const recentMessages = messages.filter(msg => currentTime - msg.time <= TIME_WINDOW);
      if (recentMessages.length === 0) {
        threadMessages.delete(userId);
      } else {
        threadMessages.set(userId, recentMessages);
      }
    }
    if (threadMessages.size === 0) {
      userMessageTimestamps.delete(threadId);
    }
  }
});

export async function handleAntiSpamCommand(api, message, groupSettings) {
  const threadId = message.threadId;
  const content = removeMention(message);
  const status = content.split(" ")[1];

  if (!groupSettings[threadId]) {
    groupSettings[threadId] = {};
  }

  let newStatus;
  if (status === "on") {
    groupSettings[threadId].antiSpam = true;
    newStatus = "bật";
  } else if (status === "off") {
    groupSettings[threadId].antiSpam = false;
    newStatus = "tắt";
  } else {
    groupSettings[threadId].antiSpam = !groupSettings[threadId].antiSpam;
    newStatus = groupSettings[threadId].antiSpam ? "bật" : "tắt";
  }
  const caption = `Chức năng chống spam đã được ${newStatus}!`;
  await sendMessageStateQuote(api, message, caption, groupSettings[threadId].antiSpam, 300000);

  return true;
}
