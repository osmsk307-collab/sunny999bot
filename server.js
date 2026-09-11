const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const PORT = process.env.PORT || 3000;
const APP_LINK = "https://shorturl.at/bStBD";
const UPI_ID = "sunny999bot@nyes";
const PRICE = "69";

let offset = 0;
let waitingForUTR = {};

const DB_FILE = path.join(__dirname, "payments.json");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}

function loadPayments() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}

function savePayments(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function telegram(method, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${BOT_TOKEN}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      },
      res => {
        let body = "";

        res.on("data", chunk => {
          body += chunk;
        });

        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid Telegram response"));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  });
}

async function handleUpdate(update) {
  const message = update.message;

  if (message && message.text === "/id") {
    await sendMessage(
      message.chat.id,
      "Your Telegram Chat ID:\n\n" +
      message.chat.id
    );
    return;
  }

  if (message && message.text === "/start") {
    await sendMessage(
      message.chat.id,
      "Welcome to SUNNY 999 PAYMENT\n\n" +
      "Premium Access: Rs. " + PRICE + "\n\n" +
      "UPI: " + UPI_ID + "\n\n" +
      "Payment karne ke baad:\n" +
      "1. Payment screenshot bhejo\n" +
      "2. UTR / Transaction ID bhejo\n" +
      "3. Payment verification ka wait karo\n" +
      "4. Approval ke baad app link milega.\n\n" +
      "Pehle payment screenshot bhejo."
    );
    return;
  }

  if (message && message.photo) {
    const photos = message.photo;
    const photo = photos[photos.length - 1];

    waitingForUTR[message.chat.id] = {
      photoFileId: photo.file_id,
      name: message.from?.first_name || "Unknown",
      username: message.from?.username || ""
    };

    await sendMessage(
      message.chat.id,
      "Screenshot received.\n\n" +
      "Ab apna UTR / Transaction ID bhejo."
    );

    return;
  }

  if (
    message &&
    message.text &&
    waitingForUTR[message.chat.id]
  ) {
    const utr = message.text.trim();

    if (utr.length < 6) {
      await sendMessage(
        message.chat.id,
        "UTR sahi nahi lag raha.\n\nPlease correct UTR bhejo."
      );
      return;
    }

    const pending = waitingForUTR[message.chat.id];
    const payments = loadPayments();

    if (payments.some(p => p.utr === utr)) {
      await sendMessage(
        message.chat.id,
        "Ye UTR already submit ho chuka hai."
      );

      delete waitingForUTR[message.chat.id];
      return;
    }

    const payment = {
      id: Date.now().toString(),
      chatId: message.chat.id,
      name: pending.name,
      username: pending.username,
      utr: utr,
      amount: PRICE,
      photoFileId: pending.photoFileId,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    payments.push(payment);
    savePayments(payments);

    delete waitingForUTR[message.chat.id];

    await sendMessage(
      message.chat.id,
      "Verification request submit ho gayi.\n\n" +
      "Payment manually check hone ke baad approval/rejection milega."
    );

    if (ADMIN_CHAT_ID) {
      const adminCaption =
        "NEW PAYMENT VERIFICATION\n\n" +
        "Name: " + payment.name + "\n" +
        "Username: @" + (payment.username || "N/A") + "\n" +
        "Chat ID: " + payment.chatId + "\n" +
        "Amount: Rs. " + payment.amount + "\n" +
        "UTR: " + payment.utr + "\n\n" +
        "Payment manually verify karo.";

      await telegram("sendPhoto", {
        chat_id: ADMIN_CHAT_ID,
        photo: payment.photoFileId,
        caption: adminCaption,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "APPROVE PAYMENT",
                callback_data: "approve_" + payment.id
              }
            ],
            [
              {
                text: "REJECT",
                callback_data: "reject_" + payment.id
              }
            ]
          ]
        }
      });
    }

    return;
  }

  if (update.callback_query) {
    const query = update.callback_query;

    if (
      !ADMIN_CHAT_ID ||
      String(query.from.id) !== String(ADMIN_CHAT_ID)
    ) {
      await telegram("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "Not authorized"
      });
      return;
    }

    const payments = loadPayments();
    const data = query.data || "";

    if (data.startsWith("approve_")) {
      const id = data.replace("approve_", "");
      const payment = payments.find(p => p.id === id);

      if (!payment) return;

      payment.status = "approved";
      payment.approvedAt = new Date().toISOString();

      savePayments(payments);

      await sendMessage(
        payment.chatId,
        "PAYMENT VERIFIED!\n\n" +
        "Payment manually verify ho gaya hai.\n\n" +
        "APP LINK:\n" +
        APP_LINK
      );

      await telegram("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "Approved. App link sent."
      });

      return;
    }

    if (data.startsWith("reject_")) {
      const id = data.replace("reject_", "");
      const payment = payments.find(p => p.id === id);

      if (!payment) return;

      payment.status = "rejected";
      payment.rejectedAt = new Date().toISOString();

      savePayments(payments);

      await sendMessage(
        payment.chatId,
        "Payment verification rejected.\n\n" +
        "Payment details check karke dobara submit karo."
      );

      await telegram("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "Payment rejected."
      });
    }
  }
}

async function pollTelegram() {
  try {
    const result = await telegram("getUpdates", {
      offset: offset,
      timeout: 25,
      allowed_updates: ["message", "callback_query"]
    });

    if (result.ok && result.result) {
      for (const update of result.result) {
        offset = update.update_id + 1;

        try {
          await handleUpdate(update);
        } catch (error) {
          console.error("Update error:", error.message);
        }
      }
    }
  } catch (error) {
    console.error("Telegram error:", error.message);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const file = path.join(__dirname, "index.html");

    if (fs.existsSync(file)) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });

      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404);
      res.end("index.html not found");
    }

    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      status: "online",
      bot: "SUNNY 999 PAYMENT"
    }));

    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log("SUNNY 999 PAYMENT BOT started");
});

pollTelegram();
setInterval(pollTelegram, 1000);
