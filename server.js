const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const PORT = process.env.PORT || 3000;

const APP_LINK = "https://shorturl.at/bStBD";
const ACTIVATION_SITE = "https://osmsk307-collab.github.io/free-fire-card/";
const UPI_ID = "sunny999bot@nyes";

const PLANS = {
  "499": "FREE FIRE GOLD CARD",
  "999": "FREE FIRE DIAMOND CARD",
  "4999": "FREE FIRE 8 PRIME CARD"
};

const DB_FILE = path.join(__dirname, "payments.json");

let offset = 0;

/*
  Per-user active verification state.

  WAITING_SCREENSHOT
  = UTR received, waiting for exactly one screenshot.

  PENDING
  = screenshot received and sent to admin.
*/

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
    if (!fs.existsSync(DB_FILE)) {
      return [];
    }

    const data = fs.readFileSync(
      DB_FILE,
      "utf8"
    );

    const parsed = JSON.parse(data);

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch (error) {

    console.error(
      "Database load error:",
      error.message
    );

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
// UNIQUE 10 DIGIT CODE
// =========================

function generateActivationCode(payments) {

  let code;

  do {

    code =
      crypto.randomInt(
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
          chunk => {
            body += chunk;
          }
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

            } catch {

              reject(
                new Error(
                  "Invalid Telegram response"
                )
              );

            }

          }
        );

      }

    );

    req.on(
      "error",
      reject
    );

    req.write(
      JSON.stringify(data)
    );

    req.end();

  });

}


async function sendMessage(
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
// START COMMAND
// =========================

async function handleStart(message) {

  const chatId =
    message.chat.id;

  const text =
    message.text || "";

  const parts =
    text.trim().split(/\s+/);

  const payload =
    parts.length > 1
      ? parts[1]
      : "";


  // =========================
  // WEBSITE VERIFICATION
  // =========================

  if (payload) {

    /*
      Website payload format:

      SUNNY999BOT_499_12345678
      SUNNY999BOT_999_123456789012
      SUNNY999BOT_4999_123456789012
    */

    const match =
      payload.match(
        /^SUNNY999BOT_(499|999|4999)_(\d{8,12})$/
      );


    if (!match) {

      await sendMessage(

        chatId,

        "❌ Invalid verification link.\n\n" +

        "Please website se " +
        "VERIFY ON TELEGRAM button use karo."

      );

      return;
    }


    const plan =
      match[1];

    const utr =
      match[2];


    // =========================
    // ACTIVE REQUEST LOCK
    // =========================

    const active =
      pendingUsers[chatId];


    if (active) {

      if (
        active.status ===
        "WAITING_SCREENSHOT"
      ) {

        await sendMessage(

          chatId,

          "⚠️ Aapki verification request already active hai.\n\n" +

          "UTR: " +
          active.utr +
          "\n\n" +

          "Ab sirf isi request ka " +
          "ONE genuine payment screenshot bhejo.\n\n" +

          "Nayi verification request start nahi ki ja sakti."

        );

        return;
      }


      if (
        active.status ===
        "PENDING"
      ) {

        await sendMessage(

          chatId,

          "⏳ Aapki payment verification already admin review mein hai.\n\n" +

          "UTR: " +
          active.utr +
          "\n\n" +

          "Please admin verification complete hone ka wait karo."

        );

        return;
      }

    }


    const payments =
      loadPayments();


    // =========================
    // DUPLICATE UTR CHECK
    // =========================

    const duplicate =
      payments.find(
        p =>
          String(p.utr) ===
          String(utr)
      );


    if (duplicate) {

      let statusText =
        "already verification mein hai.";

      if (
        duplicate.status ===
        "APPROVED"
      ) {

        statusText =
          "already APPROVED hai.";

      }

      if (
        duplicate.status ===
        "REJECTED"
      ) {

        statusText =
          "already REJECTED hai.";

      }


      await sendMessage(

        chatId,

        "⚠️ THIS UTR IS ALREADY USED\n\n" +

        "UTR: " +
        utr +
        "\n\n" +

        statusText +
        "\n\n" +

        "Same UTR ko dobara submit nahi kiya ja sakta."

      );

      return;
    }


    // =========================
    // CREATE ACTIVE REQUEST
    // =========================

    pendingUsers[chatId] = {

      chatId:
        chatId,

      plan:
        plan,

      planName:
        PLANS[plan],

      utr:
        utr,

      screenshot:
        null,

      status:
        "WAITING_SCREENSHOT",

      createdAt:
        new Date().toISOString()

    };


    await sendMessage(

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

      "Ab payment ka ONE GENUINE SCREENSHOT bhejo.\n\n" +

      "⚠️ Ek verification request mein " +
      "sirf ONE UTR aur ONE screenshot allowed hai.\n\n" +

      "Screenshot receive hone ke baad " +
      "verification request admin ko bheji jayegi."

    );

    return;
  }


  // =========================
  // NORMAL START
  // =========================

  await sendMessage(

    chatId,

    "WELCOME TO SUNNY 999 BOT\n\n" +

    "Available Plans:\n\n" +

    "₹499 — FREE FIRE GOLD CARD\n" +

    "₹999 — FREE FIRE DIAMOND CARD\n" +
    "₹4,999 — FREE FIRE 8 PRIME CARD\n\n" +

    "Payment ke baad website se " +
    "VERIFY ON TELEGRAM button use karo."

  );

}


// =========================
// PHOTO RECEIVED
// =========================

async function handlePhoto(message) {

  const chatId =
    message.chat.id;

  const user =
    pendingUsers[chatId];


  // =========================
  // NO ACTIVE REQUEST
  // =========================

  if (!user) {

    await sendMessage(

      chatId,

      "Pehle website se plan select karke\n" +
      "VERIFY ON TELEGRAM button use karo."

    );

    return;
  }


  // =========================
  // SCREENSHOT ALREADY SENT
  // =========================

  if (
    user.status ===
    "PENDING"
  ) {

    await sendMessage(

      chatId,

      "⛔ Screenshot already receive ho chuka hai.\n\n" +

      "Ek verification request mein " +
      "sirf ONE screenshot allowed hai.\n\n" +

      "Please admin verification ka wait karo."

    );

    return;
  }


  if (
    user.status !==
    "WAITING_SCREENSHOT"
  ) {

    await sendMessage(

      chatId,

      "⚠️ Verification request active nahi hai.\n\n" +
      "Website se dobara VERIFY ON TELEGRAM start karo."

    );

    return;
  }


  // =========================
  // GET BEST PHOTO
  // =========================

  const photos =
    message.photo || [];


  if (!photos.length) {

    await sendMessage(

      chatId,

      "❌ Screenshot receive nahi hua.\n\n" +
      "Please ek genuine payment screenshot bhejo."

    );

    return;
  }


  const photo =
    photos[photos.length - 1];


  // =========================
  // FINAL UTR DUPLICATE CHECK
  // =========================

  const payments =
    loadPayments();


  const existing =
    payments.find(
      p =>
        String(p.utr) ===
        String(user.utr)
    );


  if (existing) {

    await sendMessage(

      chatId,

      "⚠️ Ye UTR already submit ho chuka hai.\n\n" +

      "UTR: " +
      user.utr +
      "\n\n" +

      "Same UTR se duplicate verification request nahi banegi."

    );

    delete pendingUsers[chatId];

    return;
  }


  // =========================
  // LOCK REQUEST
  // =========================

  user.screenshot =
    photo.file_id;

  user.status =
    "PENDING";


  // =========================
  // CREATE PAYMENT
  // =========================

  const payment = {

    id:
      Date.now().toString(),

    chatId:
      chatId,

    username:
      message.from &&
      message.from.username
        ? message.from.username
        : "",

    firstName:
      message.from &&
      message.from.first_name
        ? message.from.first_name
        : "",

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

    codeUsed:
      false,

    createdAt:
      new Date().toISOString()

  };


  payments.push(
    payment
  );


  try {

    savePayments(
      payments
    );

  } catch (error) {

    user.status =
      "WAITING_SCREENSHOT";

    user.screenshot =
      null;

    await sendMessage(

      chatId,

      "❌ Verification save nahi ho saki.\n\n" +
      "Please thodi der baad try karo."

    );

    console.error(
      "Payment save error:",
      error.message
    );

    return;
  }


  // =========================
  // ADMIN VERIFICATION
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
            message.from &&
            message.from.username
              ? message.from.username
              : "N/A"
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

    /*
      Admin notification failed.
      Keep payment in database as PENDING
      so the request is not lost.
    */

    console.error(
      "Admin notification error:",
      error.message
    );


    await sendMessage(

      chatId,

      "⚠️ Payment screenshot receive ho gaya hai, " +
      "lekin admin notification mein temporary problem aayi hai.\n\n" +

      "Aapki request database mein PENDING hai.\n" +

      "Dobara screenshot bhejne ki zarurat nahi hai."

    );

    return;
  }


  // =========================
  // USER CONFIRMATION
  // =========================

  await sendMessage(

    chatId,

    "✅ Payment screenshot received.\n\n" +

    "Plan: ₹" +
    Number(user.plan).toLocaleString("en-IN") +
    "\n" +

    "Card: " +
    user.planName +
    "\n" +

    "UTR: " +
    user.utr +
    "\n\n" +

    "Verification request admin ko bhej di gayi hai.\n\n" +

    "⚠️ Is request mein ab koi doosra screenshot ya UTR accept nahi hoga.\n\n" +

    "Approval ke baad access details milengi."

  );

}


// =========================
// CALLBACK BUTTON
// =========================

async function handleCallback(callback) {

  const data =
    callback.data || "";

  const adminId =
    String(callback.from.id);


  // =========================
  // ADMIN ONLY
  // =========================

  if (
    adminId !==
    String(ADMIN_CHAT_ID)
  ) {

    await telegram(

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

    return;
  }


  const parts =
    data.split("_");

  const action =
    parts[0];

  const paymentId =
    parts.slice(1).join("_");


  const payments =
    loadPayments();


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

        show_alert:
          true

      }

    );

    return;
  }


  // =========================
  // ALREADY PROCESSED
  // =========================

  if (
    payment.status !==
    "PENDING"
  ) {

    await telegram(

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

    return;
  }


  // =========================
  // APPROVE
  // =========================

  if (action === "approve") {

    const activationCode =
      generateActivationCode(
        payments
      );


    payment.status =
      "APPROVED";

    payment.activationCode =
      activationCode;

    payment.codeUsed =
      false;

    payment.approvedAt =
      new Date().toISOString();


    savePayments(
      payments
    );


    // =========================
    // USER APPROVAL MESSAGE
    // =========================

    await sendMessage(

      payment.chatId,

      "✅ PAYMENT APPROVED\n\n" +

      "🌐 CC ACTIVATION WEBSITE\n\n" +

      ACTIVATION_SITE +
      "\n\n" +

      "👆 Is website par jaakar apna CC activate karo.\n\n" +

      "Required payment complete karne ke baad hi " +
      "activation process continue hoga.\n\n" +

      "━━━━━━━━━━━━━━━━━━\n\n" +

      "Plan: ₹" +
      Number(payment.plan).toLocaleString("en-IN") +
      "\n" +

      "Card: " +
      payment.planName +
      "\n\n" +

      "🔐 YOUR ACTIVATION CODE\n\n" +

      activationCode +
      "\n\n" +

      "⚠️ Is 10-digit code ko save/copy karke rakho.\n\n" +

      "Website open karo aur activation process continue karo."

    );


    // =========================
    // REMOVE ACTIVE REQUEST
    // =========================

    delete pendingUsers[
      payment.chatId
    ];


    // =========================
    // ADMIN CONFIRMATION
    // =========================

    await telegram(

      "answerCallbackQuery",

      {

        callback_query_id:
          callback.id,

        text:
          "Payment approved + unique code generated ✅"

      }

    );


    // =========================
    // UPDATE ADMIN MESSAGE
    // =========================

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
            payment.chatId +
            "\n\n" +

            "Activation Code: " +
            activationCode

        }

      );

    }

    return;
  }


  // =========================
  // REJECT
  // =========================

  if (action === "reject") {

    payment.status =
      "REJECTED";

    payment.rejectedAt =
      new Date().toISOString();


    savePayments(
      payments
    );


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

      "Agar payment genuine hai to support/admin se contact karo."

    );


    // =========================
    // REMOVE ACTIVE REQUEST
    // =========================

    delete pendingUsers[
      payment.chatId
    ];


    await telegram(

      "answerCallbackQuery",

      {

        callback_query_id:
          callback.id,

        text:
          "Payment rejected."

      }

    );


    // =========================
    // UPDATE ADMIN MESSAGE
    // =========================

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

    }

  }

}


// =========================
// UPDATE HANDLER
// =========================

async function handleUpdate(update) {

  try {

    // =========================
    // CALLBACK
    // =========================

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

    if (!message)
      return;


    // =========================
    // /ID
    // =========================

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


    // =========================
    // /START
    // =========================

    if (
      message.text &&
      message.text.startsWith(
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
    // MANUAL UTR
    // ========================
