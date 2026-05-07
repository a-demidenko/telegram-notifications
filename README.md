# CF Telegram Gate

> Cloudflare Worker — универсальный шлюз уведомлений в Telegram.  
> Cloudflare Worker — universal notification gateway to Telegram.

---

## 🇷🇺 Русский

### Что умеет

| Источник | Метод | Описание |
|---|---|---|
| VBA (Excel) | `POST /photo` | Скриншот листа → Telegram |
| VBA (Excel) | `POST /` | Текстовое сообщение → Telegram |
| Uptime Kuma | `POST /` | Webhook уведомления UP/DOWN |
| Email | SMTP → Worker | Письма любых сервисов → Telegram |

### Переменные окружения

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен Telegram бота (для email и Uptime Kuma) |
| `TELEGRAM_CHAT_ID` | ID чата для уведомлений |

> VBA использует собственный токен передаваемый в теле запроса.

### Развёртывание

**1. Клонируйте репозиторий**
```bash
git clone https://github.com/ваш-username/cf-telegram-gate
cd cf-telegram-gate
```

**2. Установите Wrangler**
```bash
npm install -g wrangler
wrangler login
```

**3. Создайте переменные окружения в Cloudflare**

Dashboard → Workers → ваш воркер → Settings → Variables:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

**4. Задеплойте**
```bash
wrangler deploy
```

### Настройка Uptime Kuma

- Тип уведомления: **Webhook**
- Post URL: `https://ваш-воркер.workers.dev`
- HTTP метод: `POST`
- Тело запроса: **Пресет - application/json**

### Настройка VBA (Excel)

```vb
Const GatewayUrl = "https://ваш-воркер.workers.dev"
```

### Настройка Email

В Cloudflare: **Email Routing** → добавьте правило пересылки на ваш воркер.

---

## 🇬🇧 English

### Features

| Source | Method | Description |
|---|---|---|
| VBA (Excel) | `POST /photo` | Sheet screenshot → Telegram |
| VBA (Excel) | `POST /` | Text message → Telegram |
| Uptime Kuma | `POST /` | Webhook UP/DOWN alerts |
| Email | SMTP → Worker | Any email → Telegram |

### Environment Variables

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (for email & Uptime Kuma) |
| `TELEGRAM_CHAT_ID` | Target chat ID |

> VBA uses its own token passed in the request body.

### Deploy

**1. Clone the repository**
```bash
git clone https://github.com/your-username/cf-telegram-gate
cd cf-telegram-gate
```

**2. Install Wrangler**
```bash
npm install -g wrangler
wrangler login
```

**3. Set environment variables in Cloudflare**

Dashboard → Workers → your worker → Settings → Variables:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

**4. Deploy**
```bash
wrangler deploy
```

### Uptime Kuma Setup

- Notification type: **Webhook**
- Post URL: `https://your-worker.workers.dev`
- HTTP method: `POST`
- Body: **Preset - application/json**

### VBA (Excel) Setup

```vb
Const GatewayUrl = "https://your-worker.workers.dev"
```

### Email Setup

In Cloudflare: **Email Routing** → add forwarding rule to your worker.

---

## Architecture

```
Email ──────────────────────────────┐
                                    ▼
VBA /photo ─── multipart ──► Cloudflare Worker ──► Telegram Bot API
                                    ▲
VBA /     ─── JSON ─────────────────┤
                                    │
Uptime Kuma ── JSON ────────────────┘
```

## License

MIT
