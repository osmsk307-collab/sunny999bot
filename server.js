const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const PORT = process.env.PORT || 3000;

const ACTIVATION_SITE =
  "https://osmsk307-collab.github.io/free-fire-card/";

const DB_FILE =
  path.join(__dirname, "payments.json");

const PLANS = {
  "499": "FREE FIRE GOLD CARD",
  "999": "FREE FIRE DIAMOND CARD",
  "4999": "FREE FIRE 8 PRIME CARD"
};

let offset = 0;
const active = {};

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error("BOT_TOKEN or ADMIN_CHAT_ID missing");
  process.exit(1);
}


// =========================
// DATABASE
// =========================

function load() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return [];
    }

    return JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );
  } catch (error) {
    console.error("DB load:", error.message);
    return [];
  }
}


function save(data) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2)
  );
}


// =========================
// ACTIVATION CODE
// =========================

function generateCode(payments) {
  let code;

  do {
    code = crypto.randomInt(
      1000000000,
      10000000000
    ).toString();
  } while (
    payments.some(
      p => p.activationCode === code
    )
  );

  return code;
}


// =========================
// TELEGRAM API
// =========================

function telegram(method, data) {
  return new Promise((resolve, reject) => {

    const req = https.request(
      {
        hostname: "api.telegram.org",

        path:
          `/bot${BOT_TOKEN}/${method}`,

        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        }
      },

      res => {

        let body = "";

        res.on(
          "data",
          chunk => body += chunk
        );

        res.on(
          "end",
          () => {

            try {

              const result =
                JSON.parse(body);

              if (!result.ok) {
                reject(
                  new Error(
                    result.description ||
                    "Telegram API error"
                  )
                );
                return;
              }

              resolve(result);

            } catch (error) {
              reject(error);
            }
          }
        );
      }
    );

    req.on("error", reject);

    req.write(
      JSON.stringify(data)
    );

    req.end();
  });
}


function sendMessage(
  chatId,
  text,
  extra = {}
) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text: text,
      ...extra
    }
  );
}


// =========================
// START
// =========================

async function handleStart(message) {

  const chatId = message.chat.id;
  const text = message.text || "";

  const payload =
    text.trim().split(/\s+/)[1] || "";


  if (!payload) {

    return sendMessage(
      chatId,

      "WELCOME TO SUNNY 999 BOT\n\n" +

      "Available Plans:\n\n" +

      "₹499 — FREE FIRE GOLD CARD\n" +

      "₹999 — FREE FIRE DIAMOND CARD\n" +

      "₹4,999 — FREE FIRE 8 PRIME CARD\n\n" +

      "Payment ke baad website se " +
      "VERIFY ON TELEGRAM use karo."
    );
  }


  const match = payload.match(
    /^SUNNY999BOT_(499|999|4999)_(\d{8,12})$/
  );


  if (!match) {

    return sendMessage(
      chatId,

      "❌ Invalid verification link.\n\n" +

      "Website se VERIFY ON TELEGRAM " +
      "button use karo."
    );
  }


  if (active[chatId]) {

    if (
      active[chatId].status ===
      "PENDING"
    ) {

      return sendMessage(
        chatId,

        "⏳ Aapki verification admin review mein hai.\n\n" +

        "UTR: " +
        active[chatId].utr +
        "\n\n" +

        "Please wait."
      );
    }


    return sendMessage(
      chatId,

      "⚠️ Verification request already active hai.\n\n" +

      "UTR: " +
      active[chatId].utr +
      "\n\n" +

      "Ab sirf ONE genuine payment screenshot bhejo."
    );
  }


  const plan = match[1];
  const utr = match[2];

  const payments = load();


  // =========================
  // DUPLICATE UTR
  // =========================

  if (
    payments.some(
      p => String(p.utr) === String(utr)
    )
  ) {

    return sendMessage(
      chatId,

      "⚠️ THIS UTR IS ALREADY USED\n\n" +

      "UTR: " +
      utr +
      "\n\n" +

      "Same UTR ko dobara submit nahi kiya ja sakta."
    );
  }


  // =========================
  // CREATE ACTIVE REQUEST
  // =========================

  active[chatId] = {

    chatId: chatId,

    plan: plan,

    planName: PLANS[plan],

    utr: utr,

    status:
      "WAITING_SCREENSHOT",

    screenshot: null
  };


  return sendMessage(
    chatId,

    "SUNNY 999 BOT\n\n" +

    "Selected Plan: ₹" +
    Number(plan).toLocaleString("en-IN") +
    "\n" +

    PLANS[plan] +

    "\n\n" +

    "UTR received: " +
    utr +

    "\n\n" +

    "📸 Ab website par kiye gaye payment ka\n" +
    "REAL & GENUINE PAYMENT SCREENSHOT bhejo.\n\n" +

    "⚠️ Sirf wahi payment screenshot bhejo\n" +
    "jo tumne isi website par payment karne ke baad\n" +
    "receive kiya hai.\n\n" +

    "❌ Fake, edited ya modified screenshot mat bhejna.\n\n" +

    "Ek verification request mein ONE UTR\n" +
    "aur ONE payment screenshot allowed hai."
  );
}


// =========================
// PHOTO
// =========================

async function handlePhoto(message) {

  const chatId = message.chat.id;
  const user = active[chatId];


  if (!user) {

    return sendMessage(
      chatId,

      "Pehle website se VERIFY ON TELEGRAM start karo."
    );
  }


  if (
    user.status ===
    "PENDING"
  ) {

    return sendMessage(
      chatId,

      "⛔ Screenshot already receive ho chuka hai.\n\n" +

      "Ek verification request mein ONE screenshot allowed hai.\n\n" +

      "Admin verification ka wait karo."
    );
  }


  const photos =
    message.photo || [];


  if (!photos.length) {

    return sendMessage(
      chatId,

      "❌ Screenshot receive nahi hua."
    );
  }


  const payments = load();


  // =========================
  // DUPLICATE CHECK
  // =========================

  if (
    payments.some(
      p =>
        String(p.utr) ===
        String(user.utr)
    )
  ) {

    delete active[chatId];

    return sendMessage(
      chatId,

      "⚠️ Ye UTR already submit ho chuka hai."
    );
  }


  const photo =
    photos[photos.length - 1];


  user.status = "PENDING";

  user.screenshot =
    photo.file_id;


  // =========================
  // PAYMENT RECORD
  // =========================

  const payment = {

    id:
      crypto.randomUUID(),

    chatId:
      chatId,

    username:
      message.from?.username || "",

    firstName:
      message.from?.first_name || "",

    plan:
      user.plan,

    planName:
      user.planName,

    amount:
      user.plan,

    utr:
      user.utr,

    screenshot:
      user.screenshot,

    status:
      "PENDING",

    activationCode:
      null,

    createdAt:
      new Date().toISOString()
  };


  payments.push(payment);


  // =========================
  // SAVE
  // =========================

  try {

    save(payments);

  } catch (error) {

    user.status =
      "WAITING_SCREENSHOT";

    user.screenshot =
      null;

    return sendMessage(
      chatId,

      "❌ Verification save nahi ho saki."
    );
  }


  // =========================
  // ADMIN MESSAGE
  // =========================

  try {

    await telegram(
      "sendPhoto",
      {

        chat_id:
          ADMIN_CHAT_ID,

        photo:
          user.screenshot,

        caption:

          "🔔 NEW PAYMENT VERIFICATION\n\n" +

          "Plan: ₹" +
          Number(user.plan).toLocaleString("en-IN") +
          "\n" +

          "Package: " +
          user.planName +
          "\n\n" +

          "UTR: " +
          user.utr +
          "\n\n" +

          "User ID: " +
          chatId +
          "\n" +

          "Username: @" +
          (
            message.from?.username ||
            "N/A"
          ) +

          "\n\n" +

          "Status: PENDING",

        reply_markup: {

          inline_keyboard: [

            [

              {
                text:
                  "✅ APPROVE",

                callback_data:
                  "approve_" +
                  payment.id
              },

              {
                text:
                  "❌ REJECT",

                callback_data:
                  "reject_" +
                  payment.id
              }

            ]

          ]

        }
      }
    );

  } catch (error) {

    console.error(
      "Admin notify:",
      error.message
    );


    return sendMessage(
      chatId,

      "⚠️ Screenshot receive ho gaya hai " +
      "aur request PENDING save hai.\n\n" +

      "Dobara screenshot mat bhejo."
    );
  }


  // =========================
  // USER CONFIRMATION
  // =========================

  return sendMessage(
    chatId,

    "✅ Payment screenshot received.\n\n" +

    "Plan: ₹" +
    Number(user.plan).toLocaleString("en-IN") +

    "\n" +

    "UTR: " +
    user.utr +

    "\n\n" +

    "Verification request admin ko bhej di gayi hai.\n\n" +

    "Admin verification ka wait karo."
  );
}


// =========================
// ADMIN CALLBACK
// =========================

async function handleCallback(callback) {

  if (
    String(callback.from.id) !==
    String(ADMIN_CHAT_ID)
  ) {

    return telegram(
      "answerCallbackQuery",
      {

        callback_query_id:
          callback.id,

        text:
          "Not authorized.",

        show_alert:
          true
      }
    );
  }


  const parts =
    (callback.data || "").split("_");


  const action =
    parts[0];


  const paymentId =
    parts.slice(1).join("_");


  const payments =
    load();


  const payment =
    payments.find(
      p => p.id === paymentId
    );


  if (!payment) {

    return telegram(
      "answerCallbackQuery",
      {

        callback_query_id:
          callback.id,

        text:
          "Payment record not found.",

        show_alert:
          true
      }
    );
  }


  if (
    payment.status !==
    "PENDING"
  ) {

    return telegram(
      "answerCallbackQuery",
      {

        callback_query_id:
          callback.id,

        text:
          "Already processed.",

        show_alert:
          true
      }
    );
  }


  // =========================
  // APPROVE
  // =========================

  if (
    action ===
    "approve"
  ) {

    payment.status =
      "APPROVED";


    payment.activationCode =
      generateCode(payments);


    payment.approvedAt =
      new Date().toISOString();


    save(payments);


    delete active[
      payment.chatId
    ];


    await sendMessage(

      payment.chatId,

      "✅ PAYMENT APPROVED\n\n" +

      "🌐 ACTIVATION WEBSITE\n\n" +

      ACTIVATION_SITE +

      "\n\n" +

      "Plan: ₹" +
      Number(payment.plan).toLocaleString("en-IN") +

      "\n" +

      "Card: " +
      payment.planName +

      "\n\n" +

      "🔐 ACTIVATION CODE\n\n" +

      payment.activationCode +

      "\n\n" +

      "Code ko save karke rakho."
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
      callback.message
    ) {

      try {

        await telegram(
          "editMessageCaption",
          {

            chat_id:
              callback.message.chat.id,

            message_id:
              callback.message.message_id,

            caption:

              "✅ PAYMENT APPROVED\n\n" +

              "Plan: ₹" +
              Number(payment.plan).toLocaleString("en-IN") +

              "\n" +

              "Card: " +
              payment.planName +

              "\n\n" +

              "UTR: " +
              payment.utr +

              "\n" +

              "User ID: " +
              payment.chatId +

              "\n\n" +

              "Activation Code: " +
              payment.activationCode
          }
        );

      } catch (error) {

        console.error(
          "Caption update:",
          error.message
        );
      }
    }


    return;
  }


  // =========================
  // REJECT
  // =========================

  if (
    action ===
    "reject"
  ) {

    payment.status =
      "REJECTED";


    payment.rejectedAt =
      new Date().toISOString();


    save(payments);


    delete active[
      payment.chatId
    ];


    await sendMessage(

      payment.chatId,

      "❌ PAYMENT REJECTED\n\n" +

      "Card: " +
      payment.planName +

      "\n\n" +

      "UTR: " +
      payment.utr +

      "\n\n" +

      "Payment verification complete nahi ho saki.\n\n" +

      "⚠️ Please website par kiye gaye payment ka\n" +
      "REAL & GENUINE screenshot bhejo.\n\n" +

      "❌ Fake, edited ya modified screenshot\n" +
      "submit mat karo.\n\n" +

      "Next time fake/edited screenshot submit hua,\n" +
      "to verification request par action liya ja sakta hai."
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
      callback.message
    ) {

      try {

        await telegram(
          "editMessageCaption",
          {

            chat_id:
              callback.message.chat.id,

            message_id:
              callback.message.message_id,

            caption:

              "❌ PAYMENT REJECTED\n\n" +

              "Plan: ₹" +
              Number(payment.plan).toLocaleString("en-IN") +

              "\n" +

              "Card: " +
              payment.planName +

              "\n\n" +

              "UTR: " +
              payment.utr +

              "\n\n" +

              "User ID: " +
              payment.chatId
          }
        );

      } catch (error) {

        console.error(
          "Caption update:",
          error.message
        );
      }
    }
  }
}


// =========================
// UPDATE HANDLER
// =========================

async function handleUpdate(update) {

  try {

    if (
      update.callback_query
    ) {

      await handleCallback(
        update.callback_query
      );

      return;
    }


    const message =
      update.message;


    if (!message) {
      return;
    }


    // =========================
    // /ID
    // =========================

    if (
      message.text?.trim() ===
      "/id"
    ) {

      await sendMessage(

        message.chat.id,

        "Your Telegram Chat ID:\n\n" +
        message.chat.id
      );

      return;
    }


    // =========================
    // /START
    // =========================

    if (
      message.text?.startsWith(
        "/start"
      )
    ) {

      await handleStart(
        message
      );

      return;
    }


    // =========================
    // PHOTO
    // =========================

    if (
      message.photo
    ) {

      await handlePhoto(
        message
      );

      return;
    }


    // =========================
    // OTHER TEXT
    // =========================

    if (
      message.text
    ) {

      await sendMessage(

        message.chat.id,

        "Payment verification ke liye:\n\n" +

        "1. Website se plan select karo\n" +

        "2. Payment complete karo\n" +

        "3. VERIFY ON TELEGRAM dabao\n" +

        "4. ONE genuine payment screenshot bhejo"
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
// POLLING
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


    for (
      const update
      of result.result || []
    ) {

      offset =
        update.update_id + 1;


      await handleUpdate(
        update
      );
    }

  } catch (error) {

    console.error(
      "Polling error:",
      error.message
    );


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          3000
        )
    );
  }


  setImmediate(
    poll
  );
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


          return res.end(
            fs.readFileSync(file)
          );
        }
      }


      if (
        req.url === "/health"
      ) {

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json"
          }
        );


        return res.end(
          JSON.stringify({
            status: "ok",
            bot: "running"
          })
        );
      }


      res.writeHead(404);

      res.end(
        "Not Found"
      );
    }
  );


// =========================
// START SERVER
// =========================

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
