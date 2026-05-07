export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // === Отправка фото: POST /photo (multipart/form-data) ===
      if (path === "/photo" && request.method === "POST") {
        const contentType = request.headers.get("content-type") || "";
        const boundaryMatch = contentType.match(/boundary=(.+)$/);
        if (!boundaryMatch) {
          return new Response("No boundary in Content-Type", { status: 400 });
        }
        const boundary = boundaryMatch[1];

        const buffer = new Uint8Array(await request.arrayBuffer());
        const parts = parseMultipart(buffer, boundary);

        let token = null;
        let chatIds = null;
        let photoBytes = null;
        let photoFilename = "photo.gif";
        let caption = "";

        for (const p of parts) {
          if (p.name === "token") token = new TextDecoder().decode(p.data);
          else if (p.name === "chat_ids") chatIds = new TextDecoder().decode(p.data);
          else if (p.name === "caption") caption = new TextDecoder().decode(p.data);
          else if (p.name === "photo") {
            photoBytes = p.data;
            if (p.filename) photoFilename = p.filename;
          }
        }

        if (!token || !chatIds || !photoBytes) {
          return new Response("Missing token, chat_ids or photo", { status: 400 });
        }

        const photoBlob = new Blob([photoBytes], { type: "image/gif" });
        const ids = chatIds.split(",").map(s => s.trim()).filter(Boolean);
        const results = [];

        for (const chatId of ids) {
          const tgForm = new FormData();
          tgForm.append("chat_id", chatId);
          tgForm.append("photo", photoBlob, "screenshot.gif");
          if (caption) tgForm.append("caption", caption);

          const tgRes = await fetch(
            `https://api.telegram.org/bot${token}/sendPhoto`,
            { method: "POST", body: tgForm }
          );
          const tgBody = await tgRes.text();
          results.push({ chatId, status: tgRes.status, response: tgBody });
        }

        return new Response(JSON.stringify({ ok: true, results }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // === Отправка сообщения: POST / ===
      if (request.method === "POST") {
        const body = await request.json();
        const { type = "info", text = "", token, chat_ids, msg = "" } = body;

        //── VBA: есть token + chat_ids ──────────────────────────
        if (token && chat_ids) {
          const finalText = text || msg || "Уведомление";
          const ids = Array.isArray(chat_ids) ? chat_ids : String(chat_ids).split(",").map(s => s.trim());
          for (const chatId of ids) {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text: finalText, parse_mode: "Markdown", disable_web_page_preview: true })
            });
          }
          return new Response("OK");
        }

        //── Uptime Kuma webhook ─────────────────────────────────
        if (body.monitor || body.heartbeat) {
          const status = body.monitor?.status ?? body.heartbeat?.status;
          const monitorName = body.monitor?.name || "Неизвестный монитор";
          const monitorUrl = body.monitor?.url || body.heartbeat?.monitorURL || "";
          const kumaMsg = body.msg || body.message || "";

          let emoji = "⚠️";
          if (status === 1 || status === "up") emoji = "✅";
          if (status === 0 || status === "down") emoji = "❌";

          let telegramMessage = `${emoji} *${monitorName}*\n\n`;
          if (kumaMsg) telegramMessage += `${kumaMsg}\n\n`;
          if (monitorUrl) telegramMessage += `URL: ${monitorUrl}\n`;
          if (body.heartbeat?.time) telegramMessage += `Время: ${body.heartbeat.time}\n`;
          if (body.heartbeat?.ping !== undefined) telegramMessage += `Ping: ${body.heartbeat.ping}ms\n`;

          await sendTelegram(env, telegramMessage);
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        //── Общее уведомление (включая тест от Uptime Kuma) ────
        const finalText = text || msg || "Тестовое уведомление";
        let emoji = "ℹ️";
        switch (type.toLowerCase()) {
          case "critical": emoji = "🔴"; break;
          case "error":    emoji = "❌"; break;
          case "warning":  emoji = "⚠️"; break;
          case "info":     emoji = "ℹ️"; break;
          case "debug":    emoji = "🔍"; break;
        }
        await sendTelegram(env, `${emoji} *${type.toUpperCase()}*\n\n${finalText}`);
        return new Response("OK");
      }

      return new Response("Use POST / for messages or POST /photo for images", { status: 405 });
    } catch (error) {
      return new Response("Error: " + error.message, { status: 500 });
    }
  },

  async email(message, env, ctx) {
    try {
      const subject = message.headers.get("subject") || "Уведомление MikroTik";
      let decodedSubject = subject;
      if (subject.includes("=?") && subject.includes("?=")) {
        decodedSubject = decodeEmailSubject(subject);
      }

      let rawText = "";
      if (message.raw) {
        const rawEmail = await new Response(message.raw).text();
        const transferEncodingMatch = rawEmail.match(/Content-Transfer-Encoding: ([^\s]+)/i);
        const transferEncoding = transferEncodingMatch ? transferEncodingMatch[1].toLowerCase() : "7bit";

        const textMatch = rawEmail.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?:\r\n--|\r\n\r\n|$)/i);
        if (textMatch && textMatch[1]) {
          let extractedText = textMatch[1].trim();
          extractedText = extractedText.replace(/\[\w{8}-\w{4}-\w{4}-\w{4}-\w{12}\]/g, '');
          if (transferEncoding === "base64") {
            try {
              extractedText = atob(extractedText.replace(/\s/g, ""));
              const bytes = new Uint8Array(extractedText.length);
              for (let i = 0; i < extractedText.length; i++) bytes[i] = extractedText.charCodeAt(i);
              extractedText = new TextDecoder("utf-8").decode(bytes);
            } catch (e) {}
          } else if (transferEncoding === "quoted-printable") {
            extractedText = decodeQuotedPrintable(extractedText);
          }
          rawText = extractedText;
        }

        if (!rawText) {
          const fallbackMatch = rawEmail.match(/\r\n\r\n([\s\S]+)$/);
          if (fallbackMatch) {
            rawText = fallbackMatch[1].replace(/\[\w{8}-\w{4}-\w{4}-\w{4}-\w{12}\]/g, '').trim();
          }
        }
      }

      const logTypeMatch = decodedSubject.match(/(critical|error|warning|info|debug)/i)
                        || rawText.match(/(critical|error|warning|info|debug)/i);
      const logType = logTypeMatch ? logTypeMatch[1].toUpperCase() : "ALERT";

      let emoji = "ℹ️";
      switch (logType.toLowerCase()) {
        case "critical": emoji = "🔴"; break;
        case "error":    emoji = "❌"; break;
        case "warning":  emoji = "⚠️"; break;
        case "info":     emoji = "ℹ️"; break;
        case "debug":    emoji = "🔍"; break;
      }

      const formattedSubject = decodedSubject.replace(/^\[CRITICAL\] |^\[ERROR\] |^\[WARNING\] |^\[INFO\] /i, '');
      let messageText = `${emoji} *${logType}*: ${formattedSubject}\n\n`;
      if (rawText) {
        const cleanedText = rawText.replace(/\r\n\r\n+/g, '\n\n').replace(/^\s+|\s+$/gm, '').trim();
        messageText += `\`\`\`\n${cleanedText}\n\`\`\``;
      } else {
        messageText += "Нет дополнительной информации";
      }

      await sendTelegram(env, messageText);
      return new Response("OK");
    } catch (error) {
      try {
        await sendTelegram(env, `⚠️ *Ошибка обработки лога*\n\n\`\`\`\n${error.message}\n\`\`\``);
      } catch (e) {}
      return new Response("Error occurred, but accepted");
    }
  },
};

async function sendTelegram(env, text) {
  return await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    }),
  });
}

function parseMultipart(buffer, boundary) {
  const boundaryBytes = new TextEncoder().encode("--" + boundary);
  const positions = [];
  for (let i = 0; i <= buffer.length - boundaryBytes.length; i++) {
    let match = true;
    for (let j = 0; j < boundaryBytes.length; j++) {
      if (buffer[i + j] !== boundaryBytes[j]) { match = false; break; }
    }
    if (match) {
      positions.push(i);
      i += boundaryBytes.length - 1;
    }
  }

  const parts = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i] + boundaryBytes.length;
    const end = positions[i + 1];

    let dataStart = start;
    if (buffer[dataStart] === 0x0D && buffer[dataStart + 1] === 0x0A) dataStart += 2;

    let headerEnd = -1;
    for (let j = dataStart; j < end - 3; j++) {
      if (buffer[j] === 0x0D && buffer[j + 1] === 0x0A && buffer[j + 2] === 0x0D && buffer[j + 3] === 0x0A) {
        headerEnd = j;
        break;
      }
    }
    if (headerEnd === -1) continue;

    const headers = new TextDecoder().decode(buffer.slice(dataStart, headerEnd));
    const dataBegin = headerEnd + 4;
    let dataEnd = end;
    if (buffer[dataEnd - 2] === 0x0D && buffer[dataEnd - 1] === 0x0A) dataEnd -= 2;

    const nameMatch = headers.match(/name="([^"]+)"/i);
    const filenameMatch = headers.match(/filename="([^"]*)"/i);
    if (!nameMatch) continue;

    parts.push({
      name: nameMatch[1],
      filename: filenameMatch ? filenameMatch[1] : null,
      data: buffer.slice(dataBegin, dataEnd)
    });
  }

  return parts;
}

function decodeQuotedPrintable(input) {
  return input.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeEmailSubject(subject) {
  const regex = /=\?([^?]+)\?([QB])\?([^?]+)\?=/gi;
  return subject.replace(regex, (match, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const decoded = atob(text);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        return new TextDecoder(charset).decode(bytes);
      } else if (encoding.toUpperCase() === 'Q') {
        return decodeQuotedPrintable(text.replace(/_/g, ' '));
      }
    } catch (e) {}
    return match;
  });
}
