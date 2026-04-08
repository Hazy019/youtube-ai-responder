require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { buildReplyPrompt } = require('./master-prompt');

// Helper function to pause the script so we don't hit the Gemini API rate limit
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 1. Initialize Clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

async function processReplies() {
  console.log('🤖 Bot waking up to check the queue...');

  try {
    // 2. Fetch comments that are ready (status: pending AND time has passed)
    // We limit to 5 per run to ensure the script doesn't time out on the server
    const { data: pendingComments, error } = await supabase
      .from('comments_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .lte('scheduled_time', new Date().toISOString())
      .limit(5); 

    if (error) throw error;

    if (!pendingComments || pendingComments.length === 0) {
      console.log('💤 No comments ready. Going back to sleep.');
      return;
    }

    console.log(`🚀 Found ${pendingComments.length} comment(s) ready to process!`);

    for (const comment of pendingComments) {
      // 3. Inner try-catch so one bad comment doesn't crash the whole bot
      try {
        console.log(`\n💬 Processing comment from ${comment.author_name}...`);

        // STEP A: Lock the comment immediately so no other script double-posts
        await supabase
          .from('comments_queue')
          .update({ status: 'processing' })
          .eq('id', comment.id)
          .select();

        // STEP B: Generate AI Response
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = buildReplyPrompt(
          comment.author_name, 
          comment.original_text,
          comment.video_title,
          comment.video_description
        );

        const result = await model.generateContent(prompt);
        const aiReplyText = result.response.text().trim();

        if (!aiReplyText) throw new Error("AI returned an empty response.");
        console.log(`🧠 AI Response: "${aiReplyText}"`);

        // STEP C: Post to YouTube
        await youtube.comments.insert({
          part: 'snippet',
          requestBody: {
            snippet: {
              parentId: comment.thread_id,
              textOriginal: aiReplyText
            }
          }
        });

        // STEP D: Mark as completed
        await supabase
          .from('comments_queue')
          .update({ status: 'replied' })
          .eq('id', comment.id)
          .select();

        console.log('✅ Reply successfully posted to YouTube!');

      } catch (innerError) {
        console.error(`⚠️ Error with comment ${comment.id}:`, innerError.message);
        
        const newRetryCount = (comment.retry_count || 0) + 1;
        const newStatus = newRetryCount >= 3 ? 'failed' : 'pending';

        await supabase
          .from('comments_queue')
          .update({ 
            status: newStatus,
            retry_count: newRetryCount 
          })
          .eq('id', comment.id)
          .select();
      }

      // STEP E: 15-second breathing room for the API
      console.log('⏳ Waiting 15 seconds for rate limits...');
      await delay(15000);
    }

    console.log('\n🎉 Finished processing the batch!');

  } catch (error) {
    console.error('❌ Critical System Error:', error.message);
  }
}

processReplies();