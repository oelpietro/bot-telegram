// bot.js - modo C1 (CICLO GLOBAL)
require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const mysql = require("mysql2/promise");

const BOT_TOKEN = process.env.BOT_TOKEN; 
const SEND_INTERVAL_MS = 1100;
const CYCLE_INTERVAL_MS = 21600000;

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

// Conta quantos chats o usuário possui (limite 3)
async function contarDoUsuario(userId) {
  const [rows] = await db.query("SELECT COUNT(*) AS total FROM chats WHERE dono = ?", [userId]);
  return rows[0].total;
}

// Testar se o bot ainda está no chat
async function botAindaEstaNoChat(chatId) {
  try {
    await bot.telegram.getChat(chatId);
    return true;
  } catch (e) {
    return false;
  }
}

// Gera link t.me para chat (username se existir, caso contrário t.me/c/<id>/1)
function linkParaChat(g) {
  if (g.username) return `https://t.me/${g.username}`;
  const idLimpo = String(g.id).replace("-100", "");
  return `https://t.me/c/${idLimpo}/1`;
}

// ---------- START & comandos ----------
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    "✨ Destaque seu canal!\n\n" +
    "Adicione seu canal ou grupo à nossa lista e ganhe mais visibilidade!\n\n" +
    "🟢 Para participar seu canal/grupo precisa de:\n\n" +
    "✅ Ter usuários ativos\n" +
    "✅ Histórico de mensagens visível\n" +
    "✅ Bot com permissões de administrador\n\n" +
    "➡️ Adicione nosso bot e participe da parceria!",
    Markup.inlineKeyboard([
      [Markup.button.url("🔵 Adicionar Grupo", "https://t.me/divulgadorlistabot?startgroup&admin=post_messages+delete_messages+edit_messages+invite_users+pin_messages")],
      [Markup.button.url("🟢 Adicionar Canal", "https://t.me/divulgadorlistabot?startchannel&admin=post_messages+delete_messages+edit_messages+invite_users+pin_messages")],
      [Markup.button.callback("📁 Meus Grupos", "meus_grupos")],
      [Markup.button.callback("📂 Meus Canais", "meus_canais")]
    ])
  );
});
// ---------- BANIR CHAT MANUALMENTE (ADM) ----------
// Uso: /banchat <chat_id>
bot.command("banchat", async (ctx) => {
  const userId = ctx.from.id;

  // Lista dos administradores permitidos
  const ADMINS = [8420557601]; // coloque SEUS IDs aqui

  // Verificar permissão
  if (!ADMINS.includes(userId)) {
    return ctx.reply("❌ Você não tem permissão para usar este comando.");
  }

  // Pegar argumento: ID do chat
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("⚠️ Uso correto: /banchat <chat_id>");
  }

  const chatId = args[1];

  try {
    // Envia aviso ao grupo/canal banido
    await bot.telegram.sendMessage(
      chatId,
      "🚫 *Este chat violou as regras do sistema.*\n\nO bot será removido agora.",
      { parse_mode: "Markdown" }
    );

    // Remover da tabela
    await db.query("DELETE FROM chats WHERE id = ?", [chatId]);

    // Fazer o bot sair
    await bot.telegram.leaveChat(chatId);

    // Confirmar para o ADM
    await ctx.reply(`✔ Chat ${chatId} banido e removido com sucesso.`);

    console.log("BANIDO:", chatId);
  } catch (err) {
    console.log("Erro no /banchat:", err);
    await ctx.reply("❌ Erro ao banir. Talvez o bot não tenha acesso ao chat ou o ID esteja errado.");
  }
});

// ---------- my_chat_member (add/remove) ----------
bot.on("my_chat_member", async (ctx) => {
  const update = ctx.update.my_chat_member;
  const chat = update.chat;
  const newStatus = update.new_chat_member.status;
  const usuario = update.from;

  if (!usuario || usuario.is_bot) return; // ignora bots

  try {
    // ADICIONADO (administrator ou member)
    if (newStatus === "administrator" || newStatus === "member") {
      const total = await contarDoUsuario(usuario.id);
      if (total >= 3) {
        try { await bot.telegram.sendMessage(usuario.id, "❗ Limite máximo atingido (3/3). Remova um para continuar."); } catch {}
        return;
      }

      await db.query(
        "REPLACE INTO chats (id, titulo, username, tipo, dono) VALUES (?, ?, ?, ?, ?)",
        [chat.id, chat.title || null, chat.username || null, chat.type, usuario.id]
      );

      try { await bot.telegram.sendMessage(usuario.id, `✅ O bot foi adicionado em *${chat.title || "seu chat"}*!`, { parse_mode: "Markdown" }); } catch {}
      console.log("SALVO:", chat.title || chat.id);
    }

    // REMOVIDO
    if (newStatus === "left" || newStatus === "kicked") {
      await db.query("DELETE FROM chats WHERE id = ?", [chat.id]);
      try { await bot.telegram.sendMessage(usuario.id, `❌ O bot foi removido de *${chat.title || "um chat"}*.`); } catch {}
      console.log("REMOVIDO:", chat.title || chat.id);
    }
  } catch (err) {
    console.log("Erro em my_chat_member:", err);
  }
});

// ---------- Meus Grupos / Meus Canais ----------
bot.action("meus_grupos", async (ctx) => {
  try {
    const [rows] = await db.query("SELECT * FROM chats WHERE dono = ? AND (tipo = 'supergroup' OR tipo = 'group')", [ctx.from.id]);
    if (rows.length === 0) return ctx.answerCbQuery("Você não possui grupos cadastrados.");
    const botoes = rows.map(g => [Markup.button.url(g.titulo, linkParaChat(g))]);
    await ctx.reply("📁 *Seus Grupos:*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(botoes) });
    ctx.answerCbQuery();
  } catch (e) {
    console.log("Erro meus_grupos:", e);
    ctx.answerCbQuery("Erro ao buscar seus grupos.");
  }
});

bot.action("meus_canais", async (ctx) => {
  try {
    const [rows] = await db.query("SELECT * FROM chats WHERE dono = ? AND tipo = 'channel'", [ctx.from.id]);
    if (rows.length === 0) return ctx.answerCbQuery("Você não possui canais cadastrados.");
    const botoes = rows.map(g => [Markup.button.url(g.titulo, linkParaChat(g))]);
    await ctx.reply("📂 *Seus Canais:*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(botoes) });
    ctx.answerCbQuery();
  } catch (e) {
    console.log("Erro meus_canais:", e);
    ctx.answerCbQuery("Erro ao buscar seus canais.");
  }
});

// ---------- MODO C1: Construção de listas e fila de envio ----------

// Fila de envios (cada item: { targetChat, texto, inline_keyboard })
let fila = [];
let processing = false;

// Função que cria as listas para cada chat (um ciclo) e popula a fila
async function montarCicloEAtualizarFila() {
  try {
    // buscar todos os chats registrados
    const [todos] = await db.query("SELECT * FROM chats");
    if (!todos || todos.length === 0) {
      console.log("Nenhum chat cadastrado para divulgação.");
      return;
    }

    // remover chats mortos (bot não está lá) - faz limpeza inicial
    const vivos = [];
    for (const ch of todos) {
      const ok = await botAindaEstaNoChat(ch.id);
      if (!ok) {
        await db.query("DELETE FROM chats WHERE id = ?", [ch.id]);
        console.log("Removido chat morto:", ch.titulo || ch.id);
      } else {
        vivos.push(ch);
      }
    }

    if (vivos.length === 0) {
      console.log("Nenhum chat vivo após limpeza.");
      return;
    }

    // contagem por dono para aplicar limite 3 (donos com >3 são excluídos da participação)
    const contagem = {};
    vivos.forEach(g => { contagem[g.dono] = (contagem[g.dono] || 0) + 1; });
    const validos = vivos.filter(g => contagem[g.dono] <= 3);

    if (validos.length === 0) {
      console.log("Nenhum chat válido (todos donos com >3).");
      return;
    }

    // embaralhar ordem pra rotacionar (não precisa ser 100% aleatório, só variar)
    // usando Fisher-Yates
    const ordem = [...validos];
    for (let i = ordem.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
    }

    // window size W (quantos outros incluir): normalmente min(12, validCount-1)
    // garantir pelo menos 2 aparições por ciclo quando possível:
    let W = Math.min(12, Math.max(1, ordem.length - 1));
    // se existe possibilidade de cada um aparecer pelo menos 2x no ciclo? 
    // com W >= 2 fica garantido. Se W < 2 (caso ordem.length <=2), set W=2 (permitindo repetições)
    if (W < 2) W = 2;

    // montar listas para cada chat alvo (ordem)
    for (let idx = 0; idx < ordem.length; idx++) {
      const alvo = ordem[idx];

      // montar lista de outros indices (circular)
      const outros = [];
      let k = 1;
      while (outros.length < W) {
        const cand = ordem[(idx + k) % ordem.length];
        // não incluir o próprio alvo
        if (String(cand.id) !== String(alvo.id)) {
          // garantir que cand tenha link (username ou construível); se não, pule
          // (linkParaChat consegue construir mesmo sem username)
          outros.push(cand);
        }
        k++;
        // safety in case of small lists — avoid infinite loop
        if (k > ordem.length * 2) break;
      }

      // garantir que não exceda 12 reais (já W <=12)
      const selecionados = outros.slice(0, 12);

      // montar botões: 3 fixos + selecionados + final
      const botoes = [
        [Markup.button.url("𝐕𝟒𝐙𝐀𝐃𝐈𝐍𝐇𝟒𝑺 🔞", "https://t.me/+XIMONj_eoGsyMzRh")],
        [Markup.button.url("ONLY DAS FAMOSAS", "https://t.me/onlydasfamosabot?start=start")],
        [Markup.button.url("D4RK LINKS", "https://t.me/D4rkLINKSbot?start=start")]
      ];

      selecionados.forEach(g => botoes.push([Markup.button.url(g.titulo || "Grupo", linkParaChat(g))]));

      botoes.push([Markup.button.url("💥 Participar da lista", "https://t.me/divulgadorlistabot")]);

      const texto =
        "👋 *Grupos do Telegram*\n\n" +
        "🔥 Adicione no seu canal ou grupo: @divulgadorlistabot\n\n" +
        "🔽 *Confira estes grupos:*\n\n";

      // adicionar à fila
      fila.push({
        targetChat: alvo,
        texto,
        inline_keyboard: botoes
      });
    }

    console.log(`Fila atualizada: ${fila.length} envios programados.`);
  } catch (err) {
    console.log("Erro ao montar ciclo:", err);
  }
}

// Worker: processa a fila em série com rate limit e tratamento de flood-wait
async function processarFila() {
  if (processing) return;
  processing = true;

  while (fila.length > 0) {
    const item = fila.shift();
    const { targetChat, texto, inline_keyboard } = item;

    try {
      await bot.telegram.sendMessage(targetChat.id, texto, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });
      console.log("✔ Enviado para:", targetChat.titulo || targetChat.id);
    } catch (e) {
      // Se Telegram retornar flood-wait
      if (e && e.parameters && e.parameters.retry_after) {
        const wait = e.parameters.retry_after * 1000;
        console.log(`⏳ FLOOD-WAIT detectado: pausando por ${wait / 1000}s`);
        // colocar o item de volta no início
        fila.unshift(item);
        await sleep(wait + 500);
        continue;
      } else {
        console.log("❌ Erro ao enviar para", targetChat.titulo || targetChat.id, e.message || e);
      }
    }

    // delay entre envios para evitar flood
    await sleep(SEND_INTERVAL_MS);
  }

  processing = false;
}

// Agendadores:
// 1) A cada CYCLE_INTERVAL_MS monta um novo ciclo/popula a fila
setInterval(async () => {
  try {
    await montarCicloEAtualizarFila();
  } catch (e) {
    console.log("Erro no agendador montarCiclo:", e);
  }
}, CYCLE_INTERVAL_MS);

// 2) Processador de fila roda constantemente (tenta processar a fila)
setInterval(async () => {
  try {
    await processarFila();
  } catch (e) {
    console.log("Erro no processarFila:", e);
  }
}, 1000);

// Também acionamos uma montagem inicial ao iniciar
(async () => {
  try {
    await montarCicloEAtualizarFila();
  } catch (e) {
    console.log("Erro montagem inicial:", e);
  }
})();

// ---------- iniciar bot ----------
bot.launch().then(() => console.log("🤖 Bot iniciado (modo C1, ciclo a cada 1 min, 1.1s entre envios)")).catch(err => {
  console.log("Erro ao iniciar bot:", err);
});
