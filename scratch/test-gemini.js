require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Say hello!");
    console.log('Gemini Response:', result.response.text());
    console.log('✅ Gemini API Key is working!');
  } catch (error) {
    console.error('❌ Gemini API Error:', error.message);
  }
}

testGemini();
