require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_KEY
);

async function checkQueue() {
  console.log('Checking recent comments in queue...');
  const { data, error } = await supabase
    .from('comments_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching from Supabase:', error.message);
    return;
  }

  console.table(data.map(c => ({
    id: c.id,
    author: c.author_name,
    text: c.original_text.substring(0, 50),
    status: c.status,
    retry: c.retry_count,
    time: c.scheduled_time
  })));
}

checkQueue();
