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

        // STEP B: Generate AI Response (Model Cascade)
        // Updated for 2026 environment: Using Gemini 2.5 and 3 models
        const modelsToTry = [
          "gemini-2.5-flash", 
          "gemini-3-flash-preview", 
          "gemini-2.0-flash",
          "gemini-flash-latest"
        ];
        let aiReplyText = "";
        let successfulModel = "";

        for (const modelName of modelsToTry) {
          try {
            console.log(`🤖 Attempting generation with ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const prompt = buildReplyPrompt(
              comment.author_name, 
              comment.original_text,
              comment.video_title,
              comment.video_description
            );

            const result = await model.generateContent(prompt);
            aiReplyText = result.response.text().trim();
            
            if (aiReplyText) {
              successfulModel = modelName;
              break; 
            }
          } catch (modelError) {
            if (modelError.message.includes('429')) {
              console.error(`⚠️ ${modelName} is busy (Rate Limit/Quota). Skipping to next model...`);
            } else {
              console.error(`⚠️ ${modelName} failed:`, modelError.message);
            }
            // Continue to next model in the cascade
          }
        }

        if (!aiReplyText) throw new Error("All models failed to return a response.");
        console.log(`🧠 AI Response (${successfulModel}): "${aiReplyText}"`);

        // STEP C: Post to YouTube
        const ytResponse = await youtube.comments.insert({
          part: 'snippet',
          requestBody: {
            snippet: {
              parentId: comment.thread_id,
              textOriginal: aiReplyText
            }
          }
        });

        const newCommentId = ytResponse.data.id;

        // STEP D: Mark as completed
        await supabase
          .from('comments_queue')
          .update({ 
            status: 'replied',
            reply_text: aiReplyText // Log the text we actually sent
          })
          .eq('id', comment.id)
          .select();

        console.log(`✅ Reply successfully posted! (ID: ${newCommentId})`);
        console.log(`🔗 Verification Link: https://www.youtube.com/comment?lc=${newCommentId}`);

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