require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

// 1. Connect to Supabase
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_KEY
);

// 2. Connect to YouTube using your new Refresh Token
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

// 3. The upgraded channel-wide function
async function fetchChannelWideComments() {

  const currentHourPST = (new Date().getUTCHours() + 8) % 24;
  if (currentHourPST < 8 || currentHourPST >= 20) {
    console.log("🌙 Sleeping... Bot only operates 8 AM - 8 PM PST to save minutes.");
    return;
  }

  console.log('🔍 Looking up your Channel ID...');

  try {
    // Step A: Automatically find your Channel ID
    const channelInfo = await youtube.channels.list({
      part: 'id',
      mine: true
    });

    if (!channelInfo.data.items || channelInfo.data.items.length === 0) {
      console.log('❌ Could not find a YouTube channel attached to this account.');
      return;
    }

    const myChannelId = channelInfo.data.items[0].id;
    console.log(`✅ Found Channel ID: ${myChannelId}`);
    console.log('📡 Fetching the newest comments across ALL your videos...\n');

    // Step B: Fetch comments for the entire channel
    const response = await youtube.commentThreads.list({
      part: 'snippet,replies',
      allThreadsRelatedToChannelId: myChannelId, 
      maxResults: 100, 
      order: 'time'
    });

    const comments = response.data.items;
    if (!comments || comments.length === 0) {
      console.log('No recent comments found on your channel.');
      return;
    }

    let addedCount = 0;

    // Step C: Loop through and save them
    for (const item of comments) {
      const topComment = item.snippet.topLevelComment.snippet;
      const commentId = item.id;
      const videoId = item.snippet.videoId;
      
      // Prevent the bot from replying to your own comments!
      if (topComment.authorDisplayName === '@Hazy_Insight') continue;

      // Calculate a random delay between 5 and 10 minutes
      const randomMinutes = Math.floor(Math.random() * (10 - 5 + 1)) + 5;
      const scheduledTime = new Date(Date.now() + randomMinutes * 60000);

      // Attempt to save it to Supabase
      const { data, error } = await supabase
        .from('comments_queue')
        .insert([{
          comment_id: commentId,
          thread_id: commentId,
          author_name: topComment.authorDisplayName,
          original_text: topComment.textOriginal,
          scheduled_time: scheduledTime.toISOString(),
          status: 'pending'
        }])
        .select();

      // If it saves successfully (meaning it wasn't already in the database)
      if (!error) {
        console.log(`✅ Queued new comment from ${topComment.authorDisplayName} (Video: ${videoId})`);
        addedCount++;
      }
    }

    console.log(`\n🎉 Finished! Added ${addedCount} new channel-wide comments to the waiting room.`);

  } catch (error) {
    console.error('❌ Error fetching comments:', error.message);
  }
}

fetchChannelWideComments();