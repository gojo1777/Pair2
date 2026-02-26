const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
const mongoose = require("mongoose");
let router = express.Router();
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");

// MongoDB Session Schema
const SessionSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  creds: { type: Object, required: true },
  added_at: { type: Date, default: Date.now }
});
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

// ✅ බලෙන්ම මකන්න පුළුවන් වෙන්න හදපු removeFile එක
function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  async function RobinPair() {
    // එක් එක් රික්වෙස්ට් එකට ෆයිල් එකක් හැදෙනවා
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    try {
      let RobinPairWeb = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "fatal" }).child({ level: "fatal" })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: Browsers.macOS("Safari"), // ඔයා මුලින් දුන්න එකමයි
      });

      if (!RobinPairWeb.authState.creds.registered) {
        await delay(1500);
        num = num.replace(/[^0-9]/g, "");
        const code = await RobinPairWeb.requestPairingCode(num);
        if (!res.headersSent) {
          await res.send({ code });
        }
      }

      RobinPairWeb.ev.on("creds.update", saveCreds);
      RobinPairWeb.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;
        if (connection === "open") {
          try {
            await delay(10000);
            const auth_path = "./session/creds.json";
            const user_jid = jidNormalizedUser(RobinPairWeb.user.id);

            // 1. MongoDB එකට සේව් කිරීම
            const session_json = JSON.parse(fs.readFileSync(auth_path, "utf8"));
            await Session.findOneAndUpdate(
              { number: user_jid },
              {
                number: user_jid,
                creds: session_json
              },
              { upsert: true }
            );

            console.log(`✅ Session securely stored in MongoDB for ${user_jid}`);

            // 2. මැසේජ් එක (Plain Text Only - Error නොවී යන්න)
            const success_msg = `╔════════════════════╗
  ✨ *ZANTA-MD CONNECTED* ✨
╚════════════════════╝

*🚀 Status:* Successfully Linked ✅
*👤 User:* ${user_jid.split('@')[0]}
*🗄️ Database:* MongoDB Secured 🔒

> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරන ලදී. දැන් බොට් ස්වයංක්‍රීයව ක්‍රියාත්මක වනු ඇත.

*📢 Join our official channel for updates:*
https://whatsapp.com/channel/0029VbBc42s84OmJ3V1RKd2B

*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

            // ❌ Image සහ Ad Card එක අයින් කළා, Text විතරක් යැවෙනවා
            await RobinPairWeb.sendMessage(user_jid, { text: success_msg });

          } catch (e) {
            console.error("❌ Database or Messaging Error:", e);
          } finally {
            // 3. Cleanup & Restart
            await delay(2000);
            removeFile("./session");
            console.log("♻️ Cleanup Done: Local session files cleared.");
            
            // 🚀 Render වලදී "Waiting" වෙන්නේ නැතුව ඉන්න process එක Restart කරනවා
            process.exit(0); 
          }

        } else if (
          connection === "close" &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output.statusCode !== 401
        ) {
          await delay(10000);
          RobinPair();
        }
      });
    } catch (err) {
      console.log("Service Error:", err);
      RobinPair();
    }
  }
  return await RobinPair();
});

module.exports = router;
