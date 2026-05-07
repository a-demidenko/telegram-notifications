// src/worker.js
export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET") {
      return new Response("Email-to-Telegram Worker активен", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
    
    if (request.method === "POST") {
      try {
        const data = await request.json();
        
        const status = data.monitor?.status || data.heartbeat?.status;
        const monitorName = data.monitor?.name || "Неизвестный монитор";
        const monitorUrl = data.monitor?.url || data.heartbeat?.monitorURL || "";
        const msg = data.msg || data.message || "";
        
        let emoji = "⚠️";
        if (status === 1 || status === "up") emoji = "✅";
        if (status === 0 || status === "down") emoji = "❌";
        
        let telegramMessage = `${emoji} *${monitorName}*\n\n`;
        if (msg) telegramMessage += `${msg}\n\n`;
        if (monitorUrl) telegramMessage += `URL: ${monitorUrl}\n`;
        
        if (data.heartbeat) {
          if (data.heartbeat.time) telegramMessage += `Время: ${data.heartbeat.time}\n`;
          if (data.heartbeat.ping !== undefined) telegramMessage += `Ping: ${data.heartbeat.ping}ms\n`;
        }
        
        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              text: telegramMessage,
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            }),
          }
        );

        const telegramResult = await telegramResponse.json();
        console.log("Telegram API response:", JSON.stringify(telegramResult));
        
        if (!telegramResult.ok) {
          return new Response(JSON.stringify({ error: "Telegram API error", details: telegramResult }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
        
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
        
      } catch (error) {
        console.error("Ошибка обработки webhook:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
    return new Response("Method not allowed", { status: 405 });
  },

  async email(message, env, ctx) {
    try {
      const from = message.from;
      const to = message.to;
      const subject = message.headers.get("subject") || "Без темы";
      
      let decodedSubject = subject;
      if (subject.includes("=?") && subject.includes("?=")) {
        decodedSubject = decodeEmailSubject(subject);
      }
      
      let emailBody = "";
      
      if (message.raw) {
        const rawEmail = await new Response(message.raw).text();
        
        const textMatch = rawEmail.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?:\r\n--|\r\n\r\n|$)/i);
        
        if (textMatch && textMatch[1]) {
          let extractedText = textMatch[1].trim();
          
          const transferEncodingMatch = rawEmail.match(/Content-Transfer-Encoding: ([^\s]+)/i);
          const transferEncoding = transferEncodingMatch ? transferEncodingMatch[1].toLowerCase() : "7bit";
          
          if (transferEncoding === "base64") {
            try {
              extractedText = atob(extractedText.replace(/\s/g, ""));
              const bytes = new Uint8Array(extractedText.length);
              for (let i = 0; i < extractedText.length; i++) {
                bytes[i] = extractedText.charCodeAt(i);
              }
              extractedText = new TextDecoder("utf-8").decode(bytes);
            } catch (e) {
              console.error("Ошибка декодирования base64:", e);
            }
          } else if (transferEncoding === "quoted-printable") {
            extractedText = decodeQuotedPrintable(extractedText);
          }
          
          emailBody = extractedText;
        }
      }
      
      let telegramMessage = `📧 *Новое письмо*\n\n`;
      telegramMessage += `*От:* ${from}\n`;
      telegramMessage += `*Кому:* ${to}\n`;
      telegramMessage += `*Тема:* ${decodedSubject}\n\n`;
      
      if (emailBody && emailBody.trim()) {
        let body = emailBody.trim();
        if (body.length > 3000) {
          body = body.substring(0, 3000) + "...\n\n[Сообщение обрезано]";
        }
        telegramMessage += `*Содержание:*\n\`\`\`\n${body}\n\`\`\``;
      } else {
        telegramMessage += `_Текст письма не найден или пустой_`;
      }
      
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: telegramMessage,
            parse_mode: "Markdown",
          }),
        }
      );

      const telegramResult = await telegramResponse.json();
      console.log("Telegram API response:", JSON.stringify(telegramResult));
      
      // Если Markdown вызывает ошибки — отправляем без форматирования
      if (!telegramResult.ok && telegramResult.error_code === 400) {
        console.log("Повторная отправка без Markdown...");
        const simpleTelegramMessage = `Новое письмо\n\nОт: ${from}\nКому: ${to}\nТема: ${decodedSubject}\n\nСодержание:\n${emailBody || 'Текст не найден'}`;
        const retryResponse = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              text: simpleTelegramMessage.substring(0, 4000),
            }),
          }
        );
        console.log("Retry response:", await retryResponse.json());
      }
      
      return new Response("OK");
    } catch (error) {
      console.error("Ошибка обработки письма:", error.stack || error);
      try {
        await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              text: `❌ Ошибка при обработке письма: ${error.message}`,
            }),
          }
        );
      } catch (e) {
        console.error("Не удалось отправить уведомление об ошибке:", e);
      }
      return new Response("Error occurred, but accepted");
    }
  },
};

function decodeQuotedPrintable(input) {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

function decodeEmailSubject(subject) {
  const regex = /=\?([^?]+)\?([QB])\?([^?]+)\?=/gi;
  return subject.replace(regex, (match, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const decoded = atob(text);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          bytes[i] = decoded.charCodeAt(i);
        }
        return new TextDecoder(charset).decode(bytes);
      } else if (encoding.toUpperCase() === 'Q') {
        return decodeQuotedPrintable(text.replace(/_/g, ' '));
      }
    } catch (e) {
      console.error('Ошибка декодирования темы:', e);
    }
    return match;
  });
}
