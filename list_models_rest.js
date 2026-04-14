require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// The SDK doesn't have a direct listModels, so we have to use the REST API
const https = require('https');

const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.models) {
        console.log('Available Models:');
        json.models.forEach(m => console.log(`- ${m.name}`));
      } else {
        console.log('No models found in response:', data);
      }
    } catch (e) {
      console.error('Error parsing response:', e.message);
      console.log('Raw data:', data);
    }
  });
}).on('error', (err) => {
  console.error('Error fetching models:', err.message);
});
