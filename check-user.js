require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkUser() {
  console.log('Searching for williamlangley2044...');
  const { data, error } = await supabase
    .from('comments_queue')
    .select('*')
    .ilike('author_name', '%williamlangley2044%');

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  if (data.length === 0) {
    console.log('User not found in queue.');
  } else {
    console.table(data);
  }
}

checkUser();
