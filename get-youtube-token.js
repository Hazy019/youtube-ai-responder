require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');

// 1. Set up the OAuth2 client using your .env credentials
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  'http://localhost' // This is the standard redirect URL for local desktop apps
);

// 2. Request permission to manage YouTube comments
const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

// 3. Generate the login link
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // 'offline' is required to get a refresh token!
  scope: SCOPES,
  prompt: 'consent' // Forces Google to show the consent screen to guarantee a token
});

console.log('\n=============================================');
console.log('1. Click this link to authorize the bot:');
console.log('=============================================\n');
console.log(authUrl);
console.log('\n=============================================');

// 4. Create an input terminal to paste the code
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('2. After logging in, you will be redirected to a broken "localhost" page.\nLook at the URL in your browser and copy everything AFTER "code=" and BEFORE "&scope".\n\nPaste that code here: ', async (code) => {
  try {
    // 5. Exchange the code for the permanent tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log('\n✅ SUCCESS! Copy the line below and add it to your .env file:');
    console.log('\n-------------------------------------------');
    console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('-------------------------------------------\n');
    
  } catch (error) {
    console.error('\n❌ Error getting tokens. Make sure you copied the code correctly!', error.message);
  }
  rl.close();
});