# YouTube AI Comment Responder 🤖

A modular, robust, and idempotent system for automating YouTube comment reflections using the **YouTube Data API v3**, **Supabase (PostgreSQL)**, and **Google Gemini AI**.

Designed for high-reliability community engagement with built-in protections against prompt injection and quota exhaustion.

---

## 🚀 Key Features

- **Identity Protection:** Human-in-the-loop persona that never admits to being an AI.
- **Prompt Injection Defense:** Hardened rules to deflect instruction overrides.
- **Smart Retries:** Automatic `retry_count` tracking with a cap at 3 attempts.
- **Idempotent Queuing:** Uses Supabase `.upsert()` to prevent duplicate comment processing.
- **Quota Optimized:** Batched processing (max 5) and inter-call delays (15s) to stay within free-tier limits.
- **CI/CD Ready:** Pre-configured for GitHub Actions with caching and timeout protections.

---

## 🛠️ Tech Stack

- **Runtime:** Node.js 20
- **Database:** Supabase (PostgreSQL + REST SDK)
- **AI Engine:** Google Gemini API (`gemini-2.0-flash`)
- **API Wrapper:** `googleapis` (OAuth2 Refresh Token flow)
- **CI/CD:** GitHub Actions (Scheduled Cron)

---

## 📁 File Structure

- `api/fetch-comments.js` — Fetches newest comments and populates the Supabase queue.
- `api/process-replies.js` — Processes pending replies, generates AI text, and posts to YouTube.
- `api/master-prompt.js` — Centralized, modular prompt builder for brand voice consistency.
- `get-youtube-token.js` — Helper for the initial OAuth2 authorization flow.
- `.github/workflows/youtube-bot.yml` — Automated cron schedule (runs 4x daily PST).

---

## 📋 Supabase Schema (`comments_queue`)

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | uuid (PK) | Unique record identifier. |
| `comment_id` | text (UNIQUE) | YouTube comment ID (used for deduplication). |
| `thread_id` | text | Parent thread ID for replies. |
| `author_name` | text | Viewer's display name. |
| `original_text` | text | Original comment content. |
| `scheduled_time`| timestamptz | When the bot is allowed to reply. |
| `status` | text | `pending`, `processing`, `replied`, or `failed`. |
| `retry_count` | int | Increments on failure (max 3). |
| `created_at` | timestamptz | Entry creation timestamp. |

---

## ⚙️ Setup & Environment

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment (`.env`):**
   ```env
   YOUTUBE_CLIENT_ID=your_id
   YOUTUBE_CLIENT_SECRET=your_secret
   YOUTUBE_REFRESH_TOKEN=your_refresh_token
   YOUTUBE_CHANNEL_HANDLE=@YourHandle
   GEMINI_API_KEY=your_key
   SUPABASE_URL=your_url
   SUPABASE_SERVICE_KEY=your_service_key
   ```

3. **Initialize YouTube Auth:**
   ```bash
   npm run token
   ```

---

## 🕒 Cron Schedule (GitHub Actions)

The bot is configured to run at peak engagement times in **PST (UTC-8)**:
- **08:00 AM PST** (`0 16 * * *` UTC)
- **12:00 PM PST** (`0 20 * * *` UTC)
- **04:00 PM PST** (`0 0 * * *` UTC)
- **08:00 PM PST** (`0 4 * * *` UTC)

---

## 🔒 Security & Constraints

- **GitHub Actions:** ~165 min/month usage (well within the 2,000 min free tier).
- **YouTube Quota:** 10,000 units/day. Each run costs ~255 units (Fetch=5, 5x Replies=250).
- **Gemini Rate Limit:** 15-second mandatory delay between generations to avoid `429` errors.
- **Identity:** Rule-based persona ensures no mention of "AI", "Gemini", or "Bots".

---

## 📄 License

MIT
