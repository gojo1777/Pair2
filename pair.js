const express = require("express");
const fs = require("fs");
const path = require("path");
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

// MongoDB Session Schema (ඔබේ දැනට පවතින Schema එක)
const SessionSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  creds: { type: Object, required: true },
  added_at: { type: Date, default: Date.now }
});
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

// ෆයිල් ඉවත් කිරීමේ function එක
function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  try {
    fs.rmSync(FilePath, { recursive: true, force: true });
  } catch (e) {
    console.error("File remove error:", e);
  }
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ error: "Please provide a phone number" });

  const sessionPath = path.join(__dirname, '../session');

  async function RobinPair() {
    // 1. කලින් තිබූ session එක සම්පූර්ණයෙන්ම මකා අලුතින් ආරම්භ කරයි
    removeFile(sessionPath);
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
      let RobinPairWeb = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        // Railway වැනි සර්වර් වලට වඩාත් ගැලපෙන Browser එකක් භාවිතා කිරීම
        browser: Browsers.ubuntu("Chrome"),
      });

      // 2. වැදගත්: Socket එක 'Open' වී Pairing Code එක ඉල්ලීමට පෙර තත්පර 5ක් රැඳී සිටීම
      if (!RobinPairWeb.authState.creds.registered) {
        await delay(5000); 
        num = num.replace(/[^0-9]/g, "");

        try {
          const code = await RobinPairWeb.requestPairingCode(num);
          if (!res.headersSent) {
            await res.send({ code });
          }
        } catch (pairErr) {
          console.error("Pairing Code Error:", pairErr);
          if (!res.headersSent) {
            res.status(500).send({ error: "Connection closed by WhatsApp. Please refresh and try again." });
          }
          return;
        }
      }

      RobinPairWeb.ev.on("creds.update", saveCreds);

      RobinPairWeb.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
          try {
            await delay(5000); // creds.json එක ලිවීමට කාලය ලබා දෙන්න
            const user_jid = jidNormalizedUser(RobinPairWeb.user.id);
            
            // Database එකට session එක සේව් කිරීම (උදාහරණයක් ලෙස)
            await Session.findOneAndUpdate(
              { number: num },
              { creds: state.creds },
              { upsert: true }
            );

            const success_msg = `╔════════════════════╗\n  ✨ *ZANTA-MD CONNECTED* ✨\n╚════════════════════╝\n\n*🚀 Status:* Successfully Linked ✅\n*👤 User:* ${user_jid.split('@')[0]}\n\n> ඔබේ දත්ත ආරක්ෂිතව තැන්පත් කරන ලදී.\n\n*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

            await RobinPairWeb.sendMessage(user_jid, { text: success_msg });
            console.log(`✅ Session saved for ${user_jid}`);

          } catch (e) {
            console.error("❌ Open Connection Logic Error:", e);
          } finally {
            await delay(3000);
            removeFile(sessionPath);
            // Process එක restart කිරීම (සර්වර් එක crash නොවී පවත්වා ගැනීමට)
            // process.exit(0); 
          }
        } 
        
        else if (connection === "close") {
          let reason = lastDisconnect?.error?.output?.statusCode;
          console.log(`Connection closed. Reason Code: ${reason}`);
          
          // 401 (Logged out) නොවන ඕනෑම අවස්ථාවක නැවත උත්සාහ කරන්න
          if (reason !== 401) {
            // මෙහිදී නැවත RobinPair() call කිරීම කළ හැක (විකල්පයි)
          }
        }
      });

    } catch (err) {
      console.error("RobinPair Main Error:", err);
      removeFile(sessionPath);
      if (!res.headersSent) {
        res.status(500).send({ error: "Service Error" });
      }
    }
  }

  return await RobinPair();
});

module.exports = router;
