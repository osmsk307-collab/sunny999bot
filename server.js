const https=require("https");
const http=require("http");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const BOT_TOKEN=process.env.BOT_TOKEN;
const ADMIN_CHAT_ID=process.env.ADMIN_CHAT_ID;
const PORT=process.env.PORT||3000;

const ACTIVATION_SITE="https://osmsk307-collab.github.io/free-fire-card/";
const DB_FILE=path.join(__dirname,"payments.json");

const PLANS={
  "499":"FREE FIRE GOLD CARD",
  "999":"FREE FIRE DIAMOND CARD",
  "4999":"FREE FIRE 8 PRIME CARD"
};

let offset=0;
const active={};

if(!BOT_TOKEN||!ADMIN_CHAT_ID){
  console.error("BOT_TOKEN or ADMIN_CHAT_ID missing");
  process.exit(1);
}

function load(){
  try{
    return fs.existsSync(DB_FILE)
      ? JSON.parse(fs.readFileSync(DB_FILE,"utf8"))
      : [];
  }catch(e){
    console.error("DB load:",e.message);
    return [];
  }
}

function save(data){
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data,null,2)
  );
}

function generateCode(payments){
  let c;
  do{
    c=crypto.randomInt(
      1000000000,
      10000000000
    ).toString();
  }while(
    payments.some(p=>p.activationCode===c)
  );
  return c;
}

function telegram(method,data){
  return new Promise((resolve,reject)=>{
    const req=https.request({
      hostname:"api.telegram.org",
      path:`/bot${BOT_TOKEN}/${method}`,
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      }
    },res=>{
      let body="";
      res.on("data",x=>body+=x);
      res.on("end",()=>{
        try{
          const result=JSON.parse(body);
          if(!result.ok){
            return reject(
              new Error(
                result.description||"Telegram API error"
              )
            );
          }
          resolve(result);
        }catch(e){
          reject(e);
        }
      });
    });

    req.on("error",reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

function sendMessage(chatId,text,extra={}){
  return telegram(
    "sendMessage",
    {
      chat_id:chatId,
      text,
      ...extra
    }
  );
}


// =========================
// START
// =========================

async function handleStart(message){

  const chatId=message.chat.id;
  const text=message.text||"";
  const payload=text.trim().split(/\s+/)[1]||"";

  if(!payload){

    return sendMessage(
      chatId,

      "WELCOME TO SUNNY 999 BOT\n\n"+
      "Available Plans:\n\n"+
      "₹499 — FREE FIRE GOLD CARD\n"+
      "₹999 — FREE FIRE DIAMOND CARD\n"+
      "₹4,999 — FREE FIRE 8 PRIME CARD\n\n"+
      "Payment ke baad website se "+
      "VERIFY ON TELEGRAM use karo."
    );
  }

  const match=payload.match(
    /^SUNNY999BOT_(499|999|4999)_(\d{8,12})$/
  );

  if(!match){

    return sendMessage(
      chatId,

      "❌ Invalid verification link.\n\n"+
      "Website se VERIFY ON TELEGRAM "+
      "button use karo."
    );
  }

  if(active[chatId]){

    if(active[chatId].status==="PENDING"){

      return sendMessage(
        chatId,

        "⏳ Aapki verification admin review mein hai.\n\n"+
        "UTR: "+active[chatId].utr+
        "\n\nPlease wait."
      );

    }

    return sendMessage(
      chatId,

      "⚠️ Verification request already active hai.\n\n"+
      "UTR: "+active[chatId].utr+
      "\n\n"+
      "Ab sirf ONE genuine payment screenshot bhejo."
    );
  }

  const plan=match[1];
  const utr=match[2];
  const payments=load();

  if(
    payments.some(
      p=>String(p.utr)===utr
    )
  ){

    return sendMessage(
      chatId,

      "⚠️ THIS UTR IS ALREADY USED\n\n"+
      "UTR: "+utr+
      "\n\n"+
      "Same UTR ko dobara submit nahi kiya ja sakta."
    );
  }

  active[chatId]={
    chatId,
    plan,
    planName:PLANS[plan],
    utr,
    status:"WAITING_SCREENSHOT"
  };

  return sendMessage(
    chatId,

    "SUNNY 999 BOT\n\n"+
    "Selected Plan: ₹"+
    Number(plan).toLocaleString("en-IN")+
    "\n"+
    PLANS[plan]+
    "\n\n"+
    "UTR received: "+utr+
    "\n\n"+
    "Ab payment ka ONE GENUINE SCREENSHOT bhejo.\n\n"+
    "⚠️ Ek request mein ONE UTR "+
    "aur ONE screenshot allowed hai."
  );
}


// =========================
// PHOTO
// =========================

async function handlePhoto(message){

  const chatId=message.chat.id;
  const user=active[chatId];

  if(!user){

    return sendMessage(
      chatId,

      "Pehle website se VERIFY ON TELEGRAM start karo."
    );
  }

  if(user.status==="PENDING"){

    return sendMessage(
      chatId,

      "⛔ Screenshot already receive ho chuka hai.\n\n"+
      "Admin verification ka wait karo."
    );
  }

  const photos=message.photo||[];

  if(!photos.length){

    return sendMessage(
      chatId,
      "❌ Screenshot receive nahi hua."
    );
  }

  const payments=load();

  if(
    payments.some(
      p=>String(p.utr)===String(user.utr)
    )
  ){

    delete active[chatId];

    return sendMessage(
      chatId,

      "⚠️ Ye UTR already submit ho chuka hai."
    );
  }

  user.status="PENDING";
  user.screenshot=
    photos[photos.length-1].file_id;

  const payment={
    id:crypto.randomUUID(),

    chatId,

    username:
      message.from?.username||"",

    firstName:
      message.from?.first_name||"",

    plan:user.plan,

    planName:user.planName,

    amount:user.plan,

    utr:user.utr,

    screenshot:user.screenshot,

    status:"PENDING",

    activationCode:null,

    createdAt:
      new Date().toISOString()
  };

  payments.push(payment);

  try{

    save(payments);

  }catch(e){

    user.status="WAITING_SCREENSHOT";
    delete user.screenshot;

    return sendMessage(
      chatId,

      "❌ Verification save nahi ho saki."
    );
  }


  // =========================
  // ADMIN
  // =========================

  try{

    await telegram(
      "sendPhoto",
      {
        chat_id:ADMIN_CHAT_ID,

        photo:user.screenshot,

        caption:

          "🔔 NEW PAYMENT VERIFICATION\n\n"+
          "Plan: ₹"+
          Number(user.plan).toLocaleString("en-IN")+
          "\n"+
          "Package: "+user.planName+
          "\n\n"+
          "UTR: "+user.utr+
          "\n"+
          "User ID: "+chatId+
          "\n"+
          "Username: @"+
          (message.from?.username||"N/A")+
          "\n\n"+
          "Status: PENDING",

        reply_markup:{
          inline_keyboard:[
            [
              {
                text:"✅ APPROVE",
                callback_data:
                  "approve_"+payment.id
              },
              {
                text:"❌ REJECT",
                callback_data:
                  "reject_"+payment.id
              }
            ]
          ]
        }
      }
    );

  }catch(e){

    console.error(
      "Admin notify:",
      e.message
    );

    return sendMessage(
      chatId,

      "⚠️ Screenshot receive ho gaya hai "+
      "aur request PENDING save hai.\n\n"+
      "Dobara screenshot mat bhejo."
    );
  }

  return sendMessage(
    chatId,

    "✅ Payment screenshot received.\n\n"+
    "Plan: ₹"+
    Number(user.plan).toLocaleString("en-IN")+
    "\n"+
    "UTR: "+user.utr+
    "\n\n"+
    "Verification request admin ko bhej di gayi hai.\n\n"+
    "Admin verification ka wait karo."
  );
}


// =========================
// ADMIN CALLBACK
// =========================

async function handleCallback(callback){

  if(
    String(callback.from.id)!==
    String(ADMIN_CHAT_ID)
  ){

    return telegram(
      "answerCallbackQuery",
      {
        callback_query_id:callback.id,
        text:"Not authorized.",
        show_alert:true
      }
    );
  }

  const parts=
    (callback.data||"").split("_");

  const action=parts[0];
  const paymentId=parts.slice(1).join("_");

  const payments=load();

  const payment=
    payments.find(
      p=>p.id===paymentId
    );

  if(!payment){

    return telegram(
      "answerCallbackQuery",
      {
        callback_query_id:callback.id,
        text:"Payment record not found.",
        show_alert:true
      }
    );
  }

  if(payment.status!=="PENDING"){

    return telegram(
      "answerCallbackQuery",
      {
        callback_query_id:callback.id,
        text:"Already processed.",
        show_alert:true
      }
    );
  }


  // =========================
  // APPROVE
  // =========================

  if(action==="approve"){

    payment.status="APPROVED";

    payment.activationCode=
      generateCode(payments);

    payment.approvedAt=
      new Date().toISOString();

    save(payments);

    delete active[payment.chatId];

    await sendMessage(

      payment.chatId,

      "✅ PAYMENT APPROVED\n\n"+
      "🌐 ACTIVATION WEBSITE\n\n"+
      ACTIVATION_SITE+
      "\n\n"+
      "Plan: ₹"+
      Number(payment.plan).toLocaleString("en-IN")+
      "\n"+
      "Card: "+payment.planName+
      "\n\n"+
      "🔐 ACTIVATION CODE\n\n"+
      payment.activationCode+
      "\n\n"+
      "Code ko save karke rakho."
    );

    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:callback.id,
        text:"Payment approved ✅"
      }
    );

    if(callback.message){

      try{

        await telegram(
          "editMessageCaption",
          {
            chat_id:
              callback.message.chat.id,

            message_id:
              callback.message.message_id,

            caption:

              "✅ PAYMENT APPROVED\n\n"+
              "Plan: ₹"+
              Number(payment.plan).toLocaleString("en-IN")+
              "\n"+
              "Card: "+payment.planName+
              "\n\n"+
              "UTR: "+payment.utr+
              "\n"+
              "User ID: "+payment.chatId+
              "\n\n"+
              "Activation Code: "+
              payment.activationCode
          }
        );

      }catch(e){

        console.error(
          "Caption update:",
          e.message
        );
      }
    }

    return;
  }


  // =========================
  // REJECT
  // =========================

  if(action==="reject"){

    payment.status="REJECTED";

    payment.rejectedAt=
      new Date().toISOString();

    save(payments);

    delete active[payment.chatId];

    await sendMessage(

      payment.chatId,

      "❌ PAYMENT REJECTED\n\n"+
      "Card: "+payment.planName+
      "\n"+
      "UTR: "+payment.utr+
      "\n\n"+
      "Payment verification complete nahi ho saki.\n\n"+
      "Agar payment genuine hai to "+
      "admin/support se contact karo."
    );

    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:callback.id,
        text:"Payment rejected."
      }
    );

    if(callback.message){

      try{

        await telegram(
          "editMessageCaption",
          {
            chat_id:
              callback.message.chat.id,

            message_id:
              callback.message.message_id,

            caption:

              "❌ PAYMENT REJECTED\n\n"+
              "Plan: ₹"+
              Number(payment.plan).toLocaleString("en-IN")+
              "\n"+
              "Card: "+payment.planName+
              "\n\n"+
              "UTR: "+payment.utr+
              "\n"+
              "User ID: "+payment.chatId
          }
        );

      }catch(e){

        console.error(
          "Caption update:",
          e.message
        );
      }
    }
  }
}


// =========================
// UPDATE HANDLER
// =========================

async function handleUpdate(update){

  try{

    if(update.callback_query){

      await handleCallback(
        update.callback_query
      );

      return;
    }

    const message=update.message;

    if(!message)return;


    if(
      message.text?.trim()==="/id"
    ){

      await sendMessage(
        message.chat.id,

        "Your Telegram Chat ID:\n\n"+
        message.chat.id
      );

      return;
    }


    if(
      message.text?.startsWith("/start")
    ){

      await handleStart(message);

      return;
    }


    if(message.photo){

      await handlePhoto(message);

      return;
    }


    if(message.text){

      await sendMessage(

        message.chat.id,

        "Payment verification ke liye:\n\n"+
        "1. Website se plan select karo\n"+
        "2. Payment complete karo\n"+
        "3. VERIFY ON TELEGRAM dabao\n"+
        "4. ONE genuine payment screenshot bhejo"
      );
    }

  }catch(e){

    console.error(
      "Update error:",
      e.message
    );
  }
}


// =========================
// POLLING
// =========================

async function poll(){

  try{

    const result=
      await telegram(
        "getUpdates",
        {
          offset,
          timeout:30
        }
      );

    for(
      const update
      of result.result||[]
    ){

      offset=
        update.update_id+1;

      await handleUpdate(update);
    }

  }catch(e){

    console.error(
      "Polling error:",
      e.message
    );

    await new Promise(
      r=>setTimeout(r,3000)
    );
  }

  setImmediate(poll);
}


// =========================
// WEB SERVER
// =========================

const server=
  http.createServer(
    (req,res)=>{

      if(
        req.url==="/"||
        req.url==="/index.html"
      ){

        const file=
          path.join(
            __dirname,
            "index.html"
          );

        if(
          fs.existsSync(file)
        ){

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


      if(req.url==="/health"){

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json"
          }
        );

        return res.end(
          JSON.stringify({
            status:"ok",
            bot:"running"
          })
        );
      }


      res.writeHead(404);
      res.end("Not Found");
    }
  );


// =========================
// START
// =========================

server.listen(
  PORT,
  ()=>{
    console.log(
      "Server running on port "+PORT
    );

    console.log(
      "SUNNY 999 BOT started"
    );

    poll();
  }
);
