require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkQueue() {
  console.log('Checking comments_queue table...');
  const { data, error } = await supabase
    .from('comments_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching queue:', error.message);
    return;
  }

  if (data.length === 0) {
    console.log('Queue is empty.');
  } else {
    console.table(data.map(c => ({
      id: c.id,
      author: c.author_name,
      text: c.original_text.substring(0, 30),
      status: c.status,
      retries: c.retry_count,
      video: c.video_title.substring(0, 30)
    })));
  }
}

checkQueue();
