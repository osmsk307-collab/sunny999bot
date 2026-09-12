const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const PORT = process.env.PORT || 3000;

const APP_LINK = "https://shorturl.at/bStBD";
const UPI_ID = "sunny999bot@nyes";

const PLANS = {
  "999": "CC Photo (20,000)",
  "1999": "CC Photo (1 LAKH)"
};

const DB_FILE = path.join(__dirname, "payments.json");

let offset = 0;
let pendingUsers = {};

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}

if (!ADMIN_CHAT_ID) {
  console.error("ADMIN_CHAT_ID missing");
  process.exit(1);
}


// =========================
// DATABASE
// =========================

function loadPayments() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}

function savePayments(data) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2)
  );
}


// =========================
// TELEGRAM API
// =========================

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
            const result = JSON.parse(body);

            if (!result.ok) {
              reject(
                new Error(
                  result.description || "Telegram API error"
                )
              );
              return;
            }

            resolve(result);

          } catch {
            reject(
              new Error("Invalid Telegram response")
            );
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
    text: text,
    ...extra
  });

}


// =========================
// START COMMAND
// =========================

async function handleStart(message) {

  const chatId = message.chat.id;

  const text = message.text || "";

  const parts = text.split(" ");

  const payload = parts.length > 1
    ? parts[1]
    : "";


  // Website se aaya hua payload
  if (payload.startsWith("cc")) {

    const match = payload.match(
      /^cc(999|1999)_(\d{12})$/
    );

    if (!match) {

      await sendMessage(
        chatId,
        "Invalid verification link.\n\nPlease website se VERIFY ON TELEGRAM button use karo."
      );

      return;
    }


    const plan = match[1];
    const utr = match[2];


    pendingUsers[chatId] = {
      chatId: chatId,
      plan: plan,
      planName: PLANS[plan],
      utr: utr,
      screenshot: null
    };


    await sendMessage(
      chatId,

      "SUNNY 999 BOT\n\n" +

      "Selected Plan: ₹" + plan + "\n" +
      PLANS[plan] + "\n\n" +

      "UTR received: " + utr + "\n\n" +

      "Ab payment ka SCREENSHOT bhejo.\n\n" +
      "Screenshot receive hone ke baad verification request admin ko bheji jayegi."
    );

    return;
  }


  // Normal /start
  await sendMessage(
    chatId,

    "WELCOME TO SUNNY 999 BOT\n\n" +

    "Available Plans:\n\n" +

    "₹999 — CC Photo (20,000)\n" +
    "₹1999 — CC Photo (1 LAKH)\n\n" +

    "Payment ke baad website se VERIFY ON TELEGRAM button use karo."
  );

}


// =========================
// PHOTO RECEIVED
// =========================

async function handlePhoto(message) {

  const chatId = message.chat.id;

  const user = pendingUsers[chatId];


  if (!user) {

    await sendMessage(
      chatId,

      "Pehle website se plan select karke\n" +
      "VERIFY ON TELEGRAM button use karo."
    );

    return;
  }


  const photos = message.photo;

  const photo =
    photos[photos.length - 1];


  user.screenshot = photo.file_id;


  // User ki payment request save
  const payments = loadPayments();


  const existing = payments.find(
    p =>
      p.utr === user.utr &&
      p.status === "PENDING"
  );


  if (existing) {

    await sendMessage(
      chatId,

      "Ye UTR already verification mein hai.\n\n" +
      "Please admin approval ka wait karo."
    );

    return;
  }


  const payment = {

    id: Date.now().toString(),

    chatId: chatId,

    username:
      message.from.username || "",

    firstName:
      message.from.first_name || "",

    plan: user.plan,

    planName: user.planName,

    amount: user.plan,

    utr: user.utr,

    screenshot: user.screenshot,

    status: "PENDING",

    createdAt:
      new Date().toISOString()

  };


  payments.push(payment);

  savePayments(payments);


  // Admin ko verification request
  await telegram(
    "sendPhoto",
    {

      chat_id: ADMIN_CHAT_ID,

      photo: user.screenshot,

      caption:

        "🔔 NEW PAYMENT VERIFICATION\n\n" +

        "Plan: ₹" + user.plan + "\n" +

        "Package: " + user.planName + "\n\n" +

        "UTR: " + user.utr + "\n\n" +

        "User ID: " + chatId + "\n" +

        "Username: @" +
        (message.from.username || "N/A") + "\n\n" +

        "Status: PENDING",

      reply_markup: {

        inline_keyboard: [

          [
            {
              text: "✅ APPROVE",
              callback_data:
                "approve_" + payment.id
            },

            {
              text: "❌ REJECT",
              callback_data:
                "reject_" + payment.id
            }
          ]

        ]

      }

    }
  );


  await sendMessage(

    chatId,

    "✅ Payment screenshot received.\n\n" +

    "Plan: ₹" + user.plan + "\n" +

    "UTR: " + user.utr + "\n\n" +

    "Verification request admin ko bhej di gayi hai.\n" +

    "Approval ke baad access link milega."

  );

}


// =========================
// CALLBACK BUTTON
// =========================

async function handleCallback(callback) {

  const data = callback.data || "";

  const adminId =
    String(callback.from.id);

  // Sirf admin approve/reject kar sakta hai
  if (
    String(adminId) !==
    String(ADMIN_CHAT_ID)
  ) {

    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callback.id,

        text:
          "Not authorized.",

        show_alert: true
      }
    );

    return;
  }


  const parts = data.split("_");

  const action = parts[0];

  const paymentId = parts.slice(1).join("_");


  const payments = loadPayments();


  const payment =
    payments.find(
      p => p.id === paymentId
    );


  if (!payment) {

    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callback.id,

        text:
          "Payment record not found.",

        show_alert: true
      }
    );

    return;
  }


  // Already processed
  if (payment.status !== "PENDING") {

    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callback.id,

        text:
          "Already processed.",

        show_alert: true
      }
    );

    return;
  }


  // =====================
  // APPROVE
  // =====================

  if (action === "approve") {

    payment.status = "APPROVED";

    payment.approvedAt =
      new Date().toISOString();

    savePayments(payments);


    await sendMessage(

      payment.chatId,

      "✅ PAYMENT APPROVED\n\n" +

      "Plan: ₹" + payment.plan + "\n" +

      payment.planName + "\n\n" +

      "Your access is approved.\n\n" +

      "APP LINK:\n" +
      APP_LINK

    );


    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callback.id,

        text:
          "Payment approved ✅"
      }
    );


    if (
      callback.message &&
      callback.message.message_id
    ) {

      await telegram(
        "editMessageCaption",
        {

          chat_id:
            callback.message.chat.id,

          message_id:
            callback.message.message_id,

          caption:

            "✅ PAYMENT APPROVED\n\n" +

            "Plan: ₹" + payment.plan + "\n" +

            "Package: " +
            payment.planName + "\n\n" +

            "UTR: " +
            payment.utr + "\n\n" +

            "User ID: " +
            payment.chatId

        }
      );

    }

    return;
  }


  // =====================
  // REJECT
  // =====================

  if (action === "reject") {

    payment.status = "REJECTED";

    payment.rejectedAt =
      new Date().toISOString();

    savePayments(payments);


    await sendMessage(

      payment.chatId,

      "❌ PAYMENT REJECTED\n\n" +

      "UTR: " + payment.utr + "\n\n" +

      "Payment verification complete nahi ho saki.\n" +

      "Agar payment genuine hai to support/admin se contact karo."

    );


    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callback.id,

        text:
          "Payment rejected."
      }
    );


    if (
      callback.message &&
      callback.message.message_id
    ) {

      await telegram(
        "editMessageCaption",
        {

          chat_id:
            callback.message.chat.id,

          message_id:
            callback.message.message_id,

          caption:

            "❌ PAYMENT REJECTED\n\n" +

            "Plan: ₹" + payment.plan + "\n" +

            "Package: " +
            payment.planName + "\n\n" +

            "UTR: " +
            payment.utr + "\n\n" +

            "User ID: " +
            payment.chatId

        }
      );

    }

  }

}


// =========================
// UPDATE HANDLER
// =========================

async function handleUpdate(update) {

  try {

    // Callback button
    if (update.callback_query) {

      await handleCallback(
        update.callback_query
      );

      return;
    }


    const message =
      update.message;

    if (!message) return;


    // /id
    if (
      message.text &&
      message.text.trim() === "/id"
    ) {

      await sendMessage(

        message.chat.id,

        "Your Telegram Chat ID:\n\n" +
        message.chat.id

      );

      return;
    }


    // /start
    if (
      message.text &&
      message.text.startsWith("/start")
    ) {

      await handleStart(message);

      return;
    }


    // Photo
    if (message.photo) {

      await handlePhoto(message);

      return;
    }


    // User manually sends UTR
    if (
      message.text &&
      /^\d{12}$/.test(
        message.text.trim()
      )
    ) {

      const chatId =
        message.chat.id;

      const user =
        pendingUsers[chatId];


      if (user) {

        user.utr =
          message.text.trim();


        await sendMessage(

          chatId,

          "UTR saved: " +
          user.utr +
          "\n\nAb payment screenshot bhejo."

        );

      } else {

        await sendMessage(

          chatId,

          "Pehle website se verification start karo."

        );

      }

      return;
    }


    // Other messages
    if (message.text) {

      await sendMessage(

        message.chat.id,

        "Payment verification ke liye:\n\n" +

        "1. Website se plan select karo\n" +
        "2. Payment complete karo\n" +
        "3. VERIFY ON TELEGRAM dabao\n" +
        "4. Payment screenshot bhejo"

      );

    }

  } catch (error) {

    console.error(
      "Update error:",
      error.message
    );

  }

}


// =========================
// BOT LOOP
// =========================

async function poll() {

  try {

    const result =
      await telegram(
        "getUpdates",
        {
          offset: offset,
          timeout: 30
        }
      );


    if (
      result.result &&
      result.result.length
    ) {

      for (
        const update of result.result
      ) {

        offset =
          update.update_id + 1;

        await handleUpdate(update);

      }

    }

  } catch (error) {

    console.error(
      "Polling error:",
      error.message
    );

    await new Promise(
      resolve =>
        setTimeout(resolve, 3000)
    );

  }


  setImmediate(poll);

}


// =========================
// WEB SERVER
// =========================

const server =
  http.createServer(
    (req, res) => {

      if (
        req.url === "/" ||
        req.url === "/index.html"
      ) {

        const file =
          path.join(
            __dirname,
            "index.html"
          );


        if (
          fs.existsSync(file)
        ) {

          res.writeHead(
            200,
            {
              "Content-Type":
                "text/html; charset=utf-8"
            }
          );

          res.end(
            fs.readFileSync(file)
          );

          return;

        }

      }


      if (req.url === "/health") {

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            status: "ok",
            bot: "running"
          })
        );

        return;
      }


      res.writeHead(404);

      res.end("Not Found");

    }
  );


server.listen(
  PORT,
  () => {

    console.log(
      "Server running on port " +
      PORT
    );

    console.log(
      "SUNNY 999 BOT started"
    );

    poll();

  }
);
