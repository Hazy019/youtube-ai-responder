# youtube-ai-responder

Automated, human-like YouTube comment responder using Node.js, the YouTube Data API, and AI.

## Overview

This project fetches new YouTube comments for your channel and auto-replies using Google Gemini (Generative AI). It stores pending comment replies in a Supabase queue, enforces safe rules, and posts short replies through the YouTube Data API.

## Components

- `get-youtube-token.js` — OAuth flow to generate `YOUTUBE_REFRESH_TOKEN`
- `api/fetch-comments.js` — fetches newest channel comments and inserts pending items into Supabase
- `api/process-replies.js` — generates AI replies and posts them to YouTube

## Requirements

- Node.js 18+ (or latest LTS)
- YouTube Data API enabled in a Google Cloud project
- OAuth 2.0 client credentials (Desktop app)
- Geminis API key (Google Generative AI)
- Supabase project with table `comments_queue`

### Supabase table schema example

- `id` (serial, primary key)
- `comment_id` (text)
- `thread_id` (text)
- `author_name` (text)
- `original_text` (text)
- `scheduled_time` (timestamptz)
- `status` (text: 'pending' | 'processing' | 'replied')

## Environment variables

Create a `.env` file in the project root with:

```
YOUTUBE_CLIENT_ID=<your-client-id>
YOUTUBE_CLIENT_SECRET=<your-client-secret>
YOUTUBE_REFRESH_TOKEN=<copy from get-youtube-token output>
GEMINI_API_KEY=<your-gemini-api-key>
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_KEY=<your-supabase-service-key>
```

## 1) Get YouTube refresh token

```bash
npm install
node get-youtube-token.js
```

Follow the prompt:
- open the URL
- approve YouTube permissions
- copy `code=...` from redirect
- paste into terminal
- save `YOUTUBE_REFRESH_TOKEN` into `.env`

## 2) Fetch channel comments

```bash
node api/fetch-comments.js
```

This finds your channel ID, grabs recent top-level comments across all videos, and queues them in Supabase.

## 3) Process replies

```bash
node api/process-replies.js
```

This checks `comments_queue` for ready rows (`pending` + `scheduled_time <= now`), uses Gemini to generate a reply, posts to YouTube, and updates status.

## Reply guidelines enforced in `process-replies.js`

- Human persona (no AI/bot mention)
- No politics/religion/competitor/NSFW or personal info
- Short (1-2 sentences)
- Max 1 emoji
- Block “ignore previous instructions” style prompt injection

## Notes

- `fetch-comments.js` skips your own comments by author, adjust `@Hazy_Insight` to your username.
- delay/timing is built in; run `process-replies.js` periodically (cron or schedule) rather than constantly.

## Testing and extension

- Add scripts in `package.json` as needed.
- Replace hard-coded persona or model settings in `process-replies.js` to match channel voice.
- Add more error handling if you need idempotent dedupe safeguards beyond Supabase unique constraint.

## License

MIT-style (or change as needed).
