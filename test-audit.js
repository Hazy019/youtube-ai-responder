/**
 * TEST AUDIT SCRIPT — youtube-ai-responder
 * ==========================================
 * Run locally: node test-audit.js
 *
 * This script does a FULL diagnostic:
 *   1. Hits YouTube API for ALL unresponded comment threads on your channel
 *   2. Checks Supabase to see which ones are known/queued/replied/missing
 *   3. Shows what context (video title, description) the AI would receive
 *   4. Previews the AI prompt for a specific comment without posting anything
 *
 * Nothing is written to YouTube or Supabase. Read-only.
 */

require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { buildReplyPrompt } = require('./api/master-prompt');

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────
function hoursAgo(isoString) {
  const ms = Date.now() - new Date(isoString).getTime();
  return (ms / 3600000).toFixed(1);
}

function truncate(str, n = 80) {
  if (!str) return '(empty)';
  return str.length > n ? str.substring(0, n) + '...' : str;
}

// ──────────────────────────────────────────────
// MAIN AUDIT
// ──────────────────────────────────────────────
async function runAudit() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           YOUTUBE BOT — FULL DIAGNOSTIC AUDIT           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Step 1: Get Channel ID ──────────────────────────────────────────
  console.log('🔍 [1/4] Resolving Channel ID...');
  const channelInfo = await youtube.channels.list({ part: 'id,snippet', mine: true });
  if (!channelInfo.data.items?.length) {
    console.error('❌ No YouTube channel found. Check your OAuth credentials.');
    return;
  }
  const channelId = channelInfo.data.items[0].id;
  const channelHandle = channelInfo.data.items[0].snippet.customUrl || '(no handle)';
  const channelTitle = channelInfo.data.items[0].snippet.title;
  console.log(`   ✅ Channel: "${channelTitle}" (${channelHandle}) — ID: ${channelId}\n`);

  // ── Step 2: Fetch ALL comment threads from YouTube ──────────────────
  console.log('📡 [2/4] Fetching up to 100 comment threads from YouTube API...');
  let allThreads = [];
  let pageToken = undefined;

  // Paginate to get up to 100 results (2 pages of 50)
  for (let page = 0; page < 2; page++) {
    const response = await youtube.commentThreads.list({
      part: 'snippet,replies',
      allThreadsRelatedToChannelId: channelId,
      maxResults: 50,
      order: 'time',
      ...(pageToken ? { pageToken } : {})
    });
    allThreads = allThreads.concat(response.data.items || []);
    pageToken = response.data.nextPageToken;
    if (!pageToken) break;
  }
  console.log(`   ✅ Retrieved ${allThreads.length} comment threads from YouTube\n`);

  // ── Step 3: Fetch video metadata ────────────────────────────────────
  console.log('🎬 [3/4] Fetching video metadata...');
  const videoIds = [...new Set(allThreads.map(t => t.snippet.videoId).filter(Boolean))];
  const videoMap = {};
  if (videoIds.length > 0) {
    const videoRes = await youtube.videos.list({ part: 'snippet', id: videoIds.join(',') });
    videoRes.data.items.forEach(v => {
      videoMap[v.id] = {
        title: v.snippet.title,
        description: v.snippet.description?.substring(0, 500) || ''
      };
    });
  }
  console.log(`   ✅ Metadata for ${Object.keys(videoMap).length} unique videos\n`);

  // ── Step 4: Cross-reference with Supabase ───────────────────────────
  console.log('🗄️  [4/4] Cross-referencing with Supabase queue...');
  const commentIds = allThreads.map(t => t.id);
  const { data: dbRows, error: dbError } = await supabase
    .from('comments_queue')
    .select('comment_id, status, scheduled_time, retry_count, author_name')
    .in('comment_id', commentIds);

  if (dbError) {
    console.error('   ❌ Supabase error:', dbError.message);
    return;
  }

  const dbMap = {};
  (dbRows || []).forEach(r => { dbMap[r.comment_id] = r; });

  console.log(`   ✅ Found ${dbRows?.length || 0} matching rows in Supabase\n`);

  // ── Analysis ─────────────────────────────────────────────────────────
  const HANDLE = (process.env.YOUTUBE_CHANNEL_HANDLE || '').toLowerCase();

  const results = {
    unresponded_missing_from_db: [],   // YouTube shows no reply, not in DB at all
    unresponded_pending: [],           // In DB as pending but not yet replied
    unresponded_stuck: [],             // In DB as processing (stuck)
    unresponded_failed: [],            // Hit max retries, gave up
    already_replied: [],               // Bot posted a reply
    self_comments: [],                 // Your own channel comments (filtered correctly)
    has_human_reply: [],               // Already replied by a human
  };

  for (const thread of allThreads) {
    const top = thread.snippet.topLevelComment.snippet;
    const commentId = thread.id;
    const authorName = top.authorDisplayName;
    const videoId = thread.snippet.videoId;
    const videoInfo = videoMap[videoId] || { title: 'Unknown Video', description: '' };
    const postedHoursAgo = hoursAgo(top.publishedAt);
    const replyCount = thread.snippet.totalReplyCount;

    const entry = {
      commentId,
      authorName,
      text: truncate(top.textOriginal),
      videoTitle: videoInfo.title,
      postedHoursAgo,
      replyCount,
      dbStatus: dbMap[commentId]?.status || '⚠️  NOT IN DB',
      scheduledTime: dbMap[commentId]?.scheduled_time || null,
      retryCount: dbMap[commentId]?.retry_count || 0,
    };

    // Classify
    if (authorName.toLowerCase() === HANDLE || authorName.toLowerCase().includes(channelTitle.toLowerCase().substring(0, 10).toLowerCase())) {
      results.self_comments.push(entry);
      continue;
    }

    if (replyCount > 0) {
      // Check if any reply is from the channel itself
      const replies = thread.replies?.comments || [];
      const hasChannelReply = replies.some(r =>
        r.snippet.authorDisplayName.toLowerCase() === HANDLE ||
        r.snippet.authorChannelId?.value === channelId
      );
      if (hasChannelReply) {
        results.already_replied.push(entry);
        continue;
      } else {
        results.has_human_reply.push(entry);
        continue;
      }
    }

    // No replies at all — where is it in the DB?
    const dbStatus = dbMap[commentId]?.status;
    if (!dbStatus) {
      results.unresponded_missing_from_db.push(entry);
    } else if (dbStatus === 'pending') {
      results.unresponded_pending.push(entry);
    } else if (dbStatus === 'processing') {
      results.unresponded_stuck.push(entry);
    } else if (dbStatus === 'failed') {
      results.unresponded_failed.push(entry);
    } else if (dbStatus === 'replied') {
      // DB says replied but YT shows 0 replies — potential posting failure
      entry.dbStatus = '⚠️  DB=replied but YT shows 0 replies!';
      results.unresponded_failed.push(entry);
    }
  }

  // ── Print Report ──────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    AUDIT REPORT                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const printGroup = (label, emoji, items) => {
    console.log(`${emoji}  ${label} (${items.length})`);
    console.log('─'.repeat(60));
    if (items.length === 0) {
      console.log('   (none)\n');
      return;
    }
    items.forEach((e, i) => {
      console.log(`   [${i + 1}] ${e.authorName} — ${e.postedHoursAgo}h ago`);
      console.log(`       Video  : ${truncate(e.videoTitle, 60)}`);
      console.log(`       Comment: "${e.text}"`);
      console.log(`       DB     : ${e.dbStatus}${e.scheduledTime ? ` | sched: ${e.scheduledTime}` : ''}${e.retryCount ? ` | retries: ${e.retryCount}` : ''}`);
    });
    console.log('');
  };

  printGroup('MISSING FROM DB — bot never saw these!', '🔴', results.unresponded_missing_from_db);
  printGroup('PENDING in DB (queued, waiting for schedule)', '🟡', results.unresponded_pending);
  printGroup('STUCK in processing state', '🟠', results.unresponded_stuck);
  printGroup('FAILED (max retries hit)', '❌', results.unresponded_failed);
  printGroup('Already replied by bot ✅', '🟢', results.already_replied);
  printGroup('Has a human reply (no bot action needed)', '🔵', results.has_human_reply);
  printGroup('Self-comments (correctly skipped)', '⚫', results.self_comments);

  // ── Prompt Preview ────────────────────────────────────────────────────
  const previewTarget =
    results.unresponded_missing_from_db[0] ||
    results.unresponded_pending[0];

  if (previewTarget) {
    const threadForPreview = allThreads.find(t => t.id === previewTarget.commentId);
    const top = threadForPreview.snippet.topLevelComment.snippet;
    const videoInfo = videoMap[threadForPreview.snippet.videoId] || { title: 'Unknown', description: '' };

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║           AI PROMPT PREVIEW (no API call made)          ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    console.log(`Generating prompt for comment from: ${top.authorDisplayName}\n`);
    const prompt = buildReplyPrompt(
      top.authorDisplayName,
      top.textOriginal,
      videoInfo.title,
      videoInfo.description
    );
    console.log('─'.repeat(60));
    console.log(prompt);
    console.log('─'.repeat(60));
    console.log('\n💡 This is exactly what would be sent to Gemini. No reply was posted.\n');
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                      SUMMARY                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Total threads scanned : ${allThreads.length}`);
  console.log(`  🔴 Missing from DB    : ${results.unresponded_missing_from_db.length}  ← bot never fetched these`);
  console.log(`  🟡 Pending in queue   : ${results.unresponded_pending.length}`);
  console.log(`  🟠 Stuck (processing) : ${results.unresponded_stuck.length}`);
  console.log(`  ❌ Failed             : ${results.unresponded_failed.length}`);
  console.log(`  🟢 Bot replied        : ${results.already_replied.length}`);
  console.log(`  🔵 Human replied      : ${results.has_human_reply.length}`);
  console.log(`  ⚫ Self-comments      : ${results.self_comments.length}`);
  console.log('');
}

runAudit().catch(console.error);
