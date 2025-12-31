// bot.js - modo C1 (CICLO GLOBAL) — VERSÃO SEGURA
require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const mysql = require("mysql2/promise");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SEND_INTERVAL_MS = 1100;
const CYCLE_INTERVAL_MS = 21600000;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN não definido");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ---------- DB ----------
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
});

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function contarDoUsuario(userId) {
  const [rows] = await db.query(
    "SELECT COUNT(*) AS total FROM chats WHERE dono = ?",
    [userId]
  );
  return rows[0].total;
}

function linkParaChat(chat) {
  if (chat.invite_link) return chat.invite_link;
  if (chat.username) return `https://t.me/${chat.username}`;
  if (String(chat.id).startsWith("-100")) {
    return `https://t.me/c/${String(chat.id).replace("-100", "")}/1`;
  }
  return "https://t.me/divulgadorlistabot";
}

// ---------- Invite (SEM EXCLUSÃO AUTOMÁTICA) ----------
async function getOrCreateInvite(chatId) {
  const [rows] = await db.query(
    "SELECT invite_link FROM chats WHERE id = ?",
    [chatId]
  );
  if (rows[0]?.invite_link) return rows[0].invite_link;

  try {
    const link = await bot.telegram.exportChatInviteLink(chatId);
    if (link) {
      await db.query(
        "UPDATE chats SET invite_link = ? WHERE id = ?",
        [link, chatId]
      );
      return link;
    }
  } catch {}

  try {
    const invite = await bot.telegram.createChatInviteLink(chatId, {
      member_limit: 0,
      expire_date: 0,
    });
    if (invite?.invite_link) {
      await db.query(
        "UPDATE chats SET invite_link = ? WHERE id = ?",
        [invite.invite_link, chatId]
      );
      return invite.invite_link;
    }
  } catch {}

  return null;
}

// ---------- START ----------
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    "✨ Destaque seu canal!\n\n" +
      "Adicione seu canal ou grupo à nossa lista e ganhe mais visibilidade!\n\n" +
      "➡️ Adicione o bot e participe!",
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          "🔵 Adicionar Grupo",
          "https://t.me/divulgadorlistabot?startgroup&admin=post_messages+delete_messages+edit_messages+invite_users+pin_messages"
        ),
      ],
      [
        Markup.button.url(
          "🟢 Adicionar Canal",
          "https://t.me/divulgadorlistabot?startchannel&admin=post_messages+delete_messages+edit_messages+invite_users+pin_messages"
        ),
      ],
      [Markup.button.callback("📁 Meus Grupos", "meus_grupos")],
      [Markup.button.callback("📂 Meus Canais", "meus_canais")],
    ])
  );
});

// ---------- BANIR CHAT (ADM) ----------
bot.command("banchat", async (ctx) => {
  const ADMINS = [8420557601];
  if (!ADMINS.includes(ctx.from.id))
    return ctx.reply("❌ Sem permissão.");

  const chatId = ctx.message.text.split(" ")[1];
  if (!chatId) return ctx.reply("Uso: /banchat <chat_id>");

  try {
    await db.query("DELETE FROM chats WHERE id = ?", [chatId]);
    await bot.telegram.leaveChat(chatId);
    ctx.reply("✔ Chat banido.");
  } catch (e) {
    ctx.reply("❌ Erro ao banir.");
  }
});

// ---------- my_chat_member ----------
bot.on("my_chat_member", async (ctx) => {
  const { chat, new_chat_member } = ctx.update.my_chat_member;
  const usuario = ctx.update.my_chat_member.from;

  if (!usuario || usuario.is_bot) return;

  try {
    if (
      new_chat_member.status === "administrator" ||
      new_chat_member.status === "member"
    ) {
      const total = await contarDoUsuario(usuario.id);
      if (total >= 3) return;

      await db.query(
        "REPLACE INTO chats (id, titulo, username, tipo, dono) VALUES (?, ?, ?, ?, ?)",
        [chat.id, chat.title, chat.username, chat.type, usuario.id]
      );
    }

    if (
      new_chat_member.status === "left" ||
      new_chat_member.status === "kicked"
    ) {
      await db.query("DELETE FROM chats WHERE id = ?", [chat.id]);
    }
  } catch (e) {
    console.log("Erro my_chat_member:", e.message);
  }
});

// ---------- AÇÕES ----------
bot.action("meus_grupos", async (ctx) => {
  const [rows] = await db.query(
    "SELECT * FROM chats WHERE dono = ? AND tipo IN ('group','supergroup')",
    [ctx.from.id]
  );
  if (!rows.length) return ctx.answerCbQuery("Nenhum grupo.");
  ctx.reply(
    "📁 *Seus Grupos:*",
    Markup.inlineKeyboard(
      rows.map((g) => [Markup.button.url(g.titulo, linkParaChat(g))])
    )
  );
});

bot.action("meus_canais", async (ctx) => {
  const [rows] = await db.query(
    "SELECT * FROM chats WHERE dono = ? AND tipo = 'channel'",
    [ctx.from.id]
  );
  if (!rows.length) return ctx.answerCbQuery("Nenhum canal.");
  ctx.reply(
    "📂 *Seus Canais:*",
    Markup.inlineKeyboard(
      rows.map((g) => [Markup.button.url(g.titulo, linkParaChat(g))])
    )
  );
});

// ---------- MODO C1 ----------
let fila = [];
let processing = false;

async function montarCicloEAtualizarFila() {
  const [todos] = await db.query("SELECT * FROM chats");
  if (!todos.length) return;

  for (const ch of todos) {
    if (!ch.invite_link) {
      ch.invite_link = await getOrCreateInvite(ch.id);
    }
  }

  const ordem = [...todos];
  for (let i = ordem.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }

  for (const alvo of ordem) {
    const botoes = [
      [Markup.button.url("💥 Participar da lista", "https://t.me/divulgadorlistabot")],
    ];

    fila.push({
      targetChat: alvo,
      texto:
        "👋 *Grupos do Telegram*\n\n" +
        "🔥 Adicione seu grupo: @divulgadorlistabot",
      inline_keyboard: botoes,
    });
  }

  console.log("Fila montada:", fila.length);
}

async function processarFila() {
  if (processing) return;
  processing = true;

  while (fila.length) {
    const { targetChat, texto, inline_keyboard } = fila.shift();
    try {
      const msg = await bot.telegram.sendMessage(targetChat.id, texto, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard },
      });
      await bot.telegram.pinChatMessage(targetChat.id, msg.message_id, {
        disable_notification: true,
      });
    } catch (e) {
      console.log("Erro envio:", e.message);
    }
    await sleep(SEND_INTERVAL_MS);
  }
  processing = false;
}

// ---------- START SEGURO ----------
(async () => {
  try {
    await bot.launch({ dropPendingUpdates: true });
    console.log("🤖 Bot iniciado com segurança");

    await montarCicloEAtualizarFila();

    setInterval(montarCicloEAtualizarFila, CYCLE_INTERVAL_MS);
    setInterval(processarFila, 1000);
  } catch (err) {
    console.log("Erro ao iniciar bot:", err);
    process.exit(1);
  }
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
