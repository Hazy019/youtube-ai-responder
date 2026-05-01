require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// --- SPEED UTILITY ---
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

log('⚡ Starting Fast-Token Script...');

/**
 * 1. CONFIGURATION
 * We use 127.0.0.1 instead of 'localhost' to bypass DNS delays on Windows.
 */
const PORT = 3000;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

log('🔍 Checking .env credentials...');
if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
  console.error('❌ ERROR: Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

async function getAuthenticatedClient() {
  return new Promise((resolve, reject) => {
    log(`🌐 Opening local server on ${REDIRECT_URI}...`);
    
    const server = http.createServer(async (req, res) => {
      log(`📡 Browser reached out: ${req.url}`);

      if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        if (req.url.includes('code=')) {
          const qs = new url.URL(req.url, REDIRECT_URI).searchParams;
          const code = qs.get('code');
          
          log('🔑 Code captured! Sending response to browser...');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Success!</h1><p>Check your terminal.</p>');
          
          log('📡 Exchanging code for token via Google API...');
          const { tokens } = await oauth2Client.getToken(code);
          log('✅ Tokens received from Google!');
          
          server.close();
          resolve(tokens);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Waiting for Auth...</h1>');
        }
      } catch (e) {
        log(`❌ Error in request: ${e.message}`);
        res.writeHead(500);
        res.end('Server Error');
        reject(e);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      log('✅ Server is listening.');
      
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
      });

      console.log('\n=============================================');
      console.log('🔗 CLICK THIS LINK:');
      console.log(authUrl);
      console.log('=============================================\n');
      log('⏳ Waiting for you to click and authorize...');
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log(`❌ ERROR: Port ${PORT} is already in use by another app!`);
      } else {
        log(`❌ Server Error: ${err.message}`);
      }
      reject(err);
    });
  });
}

function updateEnvFile(newToken) {
  log('💾 Saving new token to .env...');
  const envPath = path.join(__dirname, '.env');
  let envContent = fs.readFileSync(envPath, 'utf8');

  const key = 'YOUTUBE_REFRESH_TOKEN';
  const newLine = `${key}=${newToken}`;

  if (envContent.includes(key)) {
    const regex = new RegExp(`${key}=.*`, 'g');
    envContent = envContent.replace(regex, newLine);
  } else {
    envContent += `\n${newLine}`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  log('✅ .env updated.');
}

async function run() {
  try {
    const tokens = await getAuthenticatedClient();
    
    if (tokens.refresh_token) {
      updateEnvFile(tokens.refresh_token);
      log('🎉 ALL DONE! Your bot is ready.');
    } else {
      log('⚠️  No refresh token found. Try revoking access first.');
    }
    process.exit(0);
  } catch (err) {
    log(`❌ FATAL ERROR: ${err.message}`);
    process.exit(1);
  }
}

run();