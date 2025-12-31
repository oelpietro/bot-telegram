// bot.js - modo C1 (CICLO GLOBAL)
require("dns").setDefaultResultOrder("ipv4first");
require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const mysql = require("mysql2/promise");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SEND_INTERVAL_MS = 1100;
const CYCLE_INTERVAL_MS = 21600000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN não definido");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
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
      expire_date: 0
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
      "🟢 Requisitos:\n\n" +
      "✅ Usuários ativos\n" +
      "✅ Histórico visível\n" +
      "✅ Bot administrador\n\n",
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          "🔵 Adicionar Grupo",
          "https://t.me/divulgadorlistabot?startgroup&admin=post_messages+delete_messages+edit_messages+invite_users+pin_messages"
        )
      ],
      [
        Markup.button.url(
          "🟢 Adicionar Canal",
          "https://t.me/divulgadorlistabot?startchannel&admin=post_messages+delete_messages+edit_messages+invite_users+pin_messages"
        )
      ],
      [Markup.button.callback("📁 Meus Grupos", "meus_grupos")],
      [Markup.button.callback("📂 Meus Canais", "meus_canais")]
    ])
  );
});

// ---------- BAN CHAT ----------
bot.command("banchat", async (ctx) => {
  const ADMINS = [8420557601];
  if (!ADMINS.includes(ctx.from.id)) {
    return ctx.reply("❌ Sem permissão.");
  }

  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("Uso: /banchat <chat_id>");
  }

  const chatId = args[1];

  try {
    await bot.telegram.sendMessage(
      chatId,
      "🚫 *Este chat foi removido do sistema.*",
      { parse_mode: "Markdown" }
    );

    await db.query("DELETE FROM chats WHERE id = ?", [chatId]);
    await bot.telegram.leaveChat(chatId);

    await ctx.reply(`✔ Chat ${chatId} removido.`);
  } catch (e) {
    console.log("Erro /banchat:", e);
    ctx.reply("❌ Falha ao remover chat.");
  }
});

// ---------- my_chat_member ----------
bot.on("my_chat_member", async (ctx) => {
  const upd = ctx.update.my_chat_member;
  const chat = upd.chat;
  const status = upd.new_chat_member.status;
  const user = upd.from;

  if (!user || user.is_bot) return;

  try {
    if (status === "administrator" || status === "member") {
      const total = await contarDoUsuario(user.id);
      if (total >= 3) {
        try {
          await bot.telegram.sendMessage(
            user.id,
            "❗ Limite máximo atingido (3/3)."
          );
        } catch {}
        return;
      }

      await db.query(
        "REPLACE INTO chats (id, titulo, username, tipo, dono) VALUES (?, ?, ?, ?, ?)",
        [chat.id, chat.title, chat.username, chat.type, user.id]
      );

      try {
        await bot.telegram.sendMessage(
          user.id,
          `✅ Bot adicionado em *${chat.title}*`,
          { parse_mode: "Markdown" }
        );
      } catch {}
    }

    if (status === "left" || status === "kicked") {
      await db.query("DELETE FROM chats WHERE id = ?", [chat.id]);
    }
  } catch (e) {
    console.log("Erro my_chat_member:", e);
  }
});

// ---------- Meus Grupos / Canais ----------
bot.action("meus_grupos", async (ctx) => {
  const [rows] = await db.query(
    "SELECT * FROM chats WHERE dono = ? AND tipo IN ('group','supergroup')",
    [ctx.from.id]
  );
  if (!rows.length) return ctx.answerCbQuery("Nenhum grupo.");
  const kb = rows.map((g) => [
    Markup.button.url(g.titulo, linkParaChat(g))
  ]);
  await ctx.reply("📁 *Seus Grupos:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(kb)
  });
  ctx.answerCbQuery();
});

bot.action("meus_canais", async (ctx) => {
  const [rows] = await db.query(
    "SELECT * FROM chats WHERE dono = ? AND tipo = 'channel'",
    [ctx.from.id]
  );
  if (!rows.length) return ctx.answerCbQuery("Nenhum canal.");
  const kb = rows.map((g) => [
    Markup.button.url(g.titulo, linkParaChat(g))
  ]);
  await ctx.reply("📂 *Seus Canais:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(kb)
  });
  ctx.answerCbQuery();
});

// ---------- FILA ----------
let fila = [];
let processing = false;

async function montarCicloEAtualizarFila() {
  try {
    const [todos] = await db.query("SELECT * FROM chats");
    if (!todos.length) return;

    for (const ch of todos) {
      if (!ch.invite_link) {
        ch.invite_link = await getOrCreateInvite(ch.id);
      }
    }

    const contagem = {};
    todos.forEach((g) => {
      contagem[g.dono] = (contagem[g.dono] || 0) + 1;
    });

    const validos = todos.filter((g) => contagem[g.dono] <= 3);
    if (!validos.length) return;

    const ordem = [...validos].sort(() => Math.random() - 0.5);
    let W = Math.min(12, Math.max(2, ordem.length - 1));

    for (let i = 0; i < ordem.length; i++) {
      const alvo = ordem[i];
      const outros = [];

      let k = 1;
      while (outros.length < W && k < ordem.length * 2) {
        const c = ordem[(i + k) % ordem.length];
        if (c.id !== alvo.id) outros.push(c);
        k++;
      }

      const botoes = [
        [Markup.button.url("𝐕𝟒𝐙𝐀𝐃𝐈𝐍𝐇𝟒𝑺 🔞", "https://t.me/+XIMONj_eoGsyMzRh")],
        [Markup.button.url("ONLY DAS FAMOSAS", "https://t.me/onlydasfamosabot?start=start")],
        [Markup.button.url("D4RK LINKS", "https://t.me/D4rkLINKSbot?start=start")]
      ];

      outros.slice(0, 12).forEach((g) =>
        botoes.push([Markup.button.url(g.titulo, linkParaChat(g))])
      );

      botoes.push([
        Markup.button.url("💥 Participar da lista", "https://t.me/divulgadorlistabot")
      ]);

      fila.push({
        targetChat: alvo,
        texto:
          "👋 *Grupos do Telegram*\n\n" +
          "🔥 Adicione: @divulgadorlistabot\n\n" +
          "🔽 *Confira:*",
        inline_keyboard: botoes
      });
    }

    console.log(`Fila criada: ${fila.length}`);
  } catch (e) {
    console.log("Erro montar ciclo:", e);
  }
}

async function processarFila() {
  if (processing) return;
  processing = true;

  while (fila.length) {
    const { targetChat, texto, inline_keyboard } = fila.shift();
    try {
      const msg = await bot.telegram.sendMessage(targetChat.id, texto, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });

      try {
        await bot.telegram.pinChatMessage(targetChat.id, msg.message_id, {
          disable_notification: true
        });
      } catch {}
    } catch (e) {
      if (e?.parameters?.retry_after) {
        fila.unshift({ targetChat, texto, inline_keyboard });
        await sleep(e.parameters.retry_after * 1000 + 500);
        continue;
      }
    }
    await sleep(SEND_INTERVAL_MS);
  }

  processing = false;
}

// ---------- AGENDADORES ----------
setInterval(montarCicloEAtualizarFila, CYCLE_INTERVAL_MS);
setInterval(processarFila, 1000);

// ---------- START BOT ----------
(async () => {
  try {
    await bot.launch({ dropPendingUpdates: true });
    console.log("🤖 Bot iniciado com sucesso");
    await montarCicloEAtualizarFila();
  } catch (err) {
    console.error("❌ Falha ao iniciar:", err);
    process.exit(1);
  }
})();

