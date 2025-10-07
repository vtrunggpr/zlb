import { getDataAllGroup } from "../../info-service/group-info.js";
import { getGlobalPrefix } from "../../service.js";
import { MessageType } from "../../../api-zalo/index.js";

let isGlobalScoldEnabled = false;
let scoldInterval = null;

export const scoldMessages = [
  "Mấy Thằng Ngu Không Làm Mà Đòi Có Ăn Bị HwH + Hà Huy Hoàng Dắt Nguuuuu!!!",
  "prefix",
  ".", "..", "...", "!", "!!", "!!!", "?", "??", "???",
  ",", ";", ":", "-", "_", "--", "—", "–", "~", "~~", "`", "´",
  "'", "\"", "''", "\"\"", "(", ")", "[", "]", "{", "}", "<", ">", "<>", "=>", "->", "<-",
  "/", "\\", "|", "||", "//", "\\\\", "+", "++", "=", "==", "===", "*", "**", "%", "%%",
  "@", "#", "$", "€", "£", "¥", "₫", "&", "&&", "^", "^^",
  "°", "•", "·", "×", "÷", "±", "≈", "≠", "∞", "√", "∆", "∑", "∏", "∫",
  "♥", "♡", "❤", "❣", "💖", "💗", "💓", "💞", "💘", "💝",
  "★", "☆", "✮", "✯", "✨", "⚡", "🔥", "💥", "💫", "🌟", "🌠", "⭐",
  "☀", "☁", "☂", "❄", "☃", "⚙", "⚔", "🗡", "🛠", "🔧", "🔨", "⚒",
  "☠", "💀", "👻", "👽", "🤖", "😈", "👾", "💩",
  "☺", "☻", "😊", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😋", "😎", "😍", "😘",
  "😗", "😙", "😚", "😜", "🤪", "😝", "🤓", "😏", "😒", "🙃", "😞", "😔", "😕",
  "🙄", "😤", "😠", "😡", "😢", "😭", "😩", "😫", "🥱", "😴", "🤤", "🤢", "🤮",
  "😷", "🤧", "🥶", "🥵", "🤯", "😵", "😲", "🤠", "🤡", "🫠", "🥴", "😇", "🤬",
  "👋", "🤚", "🖐", "✋", "🖖", "👌", "🤌", "🤏", "✌", "🤞", "🤟", "🤘", "🤙",
  "👍", "👎", "👊", "✊", "👏", "🙌", "👐", "🤲",
  "💪", "🦾", "👀", "👁", "👅", "👄", "🧠", "💋",
  "⚡", "💢", "💣", "💥", "💫", "💦", "💨", "💤", "🩸", "🕳",
  "🎯", "🎲", "🎮", "🎵", "🎶", "🎧", "🎤", "🎼", "🎹", "🥁", "🎸", "🎻",
  "🔔", "📣", "📢", "📯", "🔊", "🔉", "🔈", "🔇",
  "🕹", "🖱", "⌨", "🖥", "💻", "🧠", "🧩", "🧠", "🔮", "🪄", "📱", "📲", "☎", "📞",
  "📸", "📷", "📹", "🎥", "📺", "📻", "🧭", "🧱", "🪓",
  "💬", "💭", "🗯", "💡", "🧠", "🔑", "🗝",
  "🧨", "🎆", "🎇", "🎉", "🎊", "🎈", "🎁", "🎀",
  "¯\\_(ツ)_/¯", "( ͡° ͜ʖ ͡°)", "(☞ﾟヮﾟ)☞", "☜(ﾟヮﾟ☜)", "(づ｡◕‿‿◕｡)づ",
  "(╯°□°）╯︵ ┻━┻", "ʕ•ᴥ•ʔ", "(ノಠ益ಠ)ノ彡┻━┻", "(ง'̀-'́)ง", "(•_•)", "( •_•)>⌐■-■", "(⌐■_■)",
  "UwU", "OwO", ">_<", "xD", ":)", ":(", ":')", ":D", ":P", ":O", ":3", ":v", ":>", ":<", ":|", ":/", ":\\", ":'(", ";)", ";3",
  "💀💀💀", "🔥🔥🔥", "✨✨✨", "⚡⚡⚡", "💥💥💥", "🎉🎉🎉", "🚀🚀🚀",
  "💻", "🧠", "🪄", "👾", "🦾", "🧠", "🤖", "💎", "🌀",
  "🦋", "🌈", "🍀", "🌸", "🌻", "🌹", "🌷", "🌼", "🌺", "🌿", "🍃", "🌾", "☘️",
  "💫", "💥", "💦", "💢", "💣", "💭", "🕳️",
  "⚙️", "🛠️", "🔧", "🔨", "🔩", "⛏️", "🪓", "🧱",
  "💬", "📢", "📣", "🗯️", "🔊", "🔔",
  "🎆", "🎇", "🎉", "🎊", "🎈", "🎁", "🎀",
];

export async function MybotManager(api, message) {
  const prefix = getGlobalPrefix(api.getBotId());
  const content = message.data.content?.trim()?.toLowerCase() || "";

  // Nếu đã bật thì bỏ qua, không phản hồi
  if (isGlobalScoldEnabled) return;

  // Khi người dùng gõ lệnh bật
  if (content === `${prefix}scold`) {
    isGlobalScoldEnabled = true;

    // 🔄 Gửi định kỳ đến tất cả nhóm
    scoldInterval = setInterval(async () => {
      try {
        const groups = await getDataAllGroup(api);
        if (!groups || groups.length === 0) {
          console.log("⚠️ Không tìm thấy nhóm nào trong dữ liệu group-info.json");
          return;
        }

        const randomMessage = scoldMessages[Math.floor(Math.random() * scoldMessages.length)];
        console.log(`📢 Gửi tin "${randomMessage}" tới ${groups.length} nhóm`);

        for (const group of groups) {
          try {
            await api.sendMessage({ msg: randomMessage }, group.groupId, MessageType.GroupMessage);
            console.log(`✅ Đã gửi đến nhóm: ${group.groupName}`);
          } catch (err) {
            console.error(`❌ Lỗi gửi đến nhóm ${group.groupName}: ${err.message}`);
          }
        }
      } catch (err) {
        console.error("🔥 Lỗi trong vòng gửi tin:", err);
      }
    }, 1); // mỗi 60 giây (1 phút)
  }
}