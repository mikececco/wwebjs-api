const { OpenAI } = require('openai');
const { openaiApiKey } = require('../config.js'); // Corrected path

let openai;
if (openaiApiKey) {
  openai = new OpenAI({
    apiKey: openaiApiKey,
  });
} else {
  console.warn('[AI Agent] OpenAI API Key not found. AI Agent will not be able to connect to OpenAI.');
}

/**
 * Processes an incoming message text with OpenAI and returns a response.
 * @param {string} messageText The text of the incoming message.
 * @returns {Promise<string|null>} The AI's response string, or null if no response or an error occurs.
 */
async function getAIResponse(messageText) {
  if (!openai) {
    console.error('[AI Agent] OpenAI client not initialized due to missing API key.');
    return 'I am currently unable to connect to my AI brain. Please check server configuration.'; // Or return null
  }

  console.log(`[AI Agent] Received message for OpenAI processing: "${messageText}"`);

  try {
    // Using a try-catch block for the API call
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Or your preferred model, e.g., gpt-4
      messages: [
        { role: 'system', content: 'You are a helpful WhatsApp assistant integrated into a Node.js application. Keep your responses concise and suitable for a chat interface.' },
        { role: 'user', content: messageText },
      ],
      max_tokens: 150, // Adjust as needed
      temperature: 0.7, // Adjust for creativity vs. determinism
    });

    const aiGeneratedResponse = completion.choices[0]?.message?.content?.trim();

    if (aiGeneratedResponse) {
      console.log(`[AI Agent] OpenAI generated response: "${aiGeneratedResponse}"`);
      return aiGeneratedResponse;
    } else {
      console.log('[AI Agent] OpenAI did not return a message content.');
      return 'I seem to be at a loss for words right now.'; // Fallback response
    }
  } catch (error) {
    console.error('[AI Agent] Error calling OpenAI API:', error.message);
    // You might want to check error.response.data for more details from OpenAI API
    if (error.response && error.response.data && error.response.data.error) {
        console.error('[AI Agent] OpenAI API Error Details:', error.response.data.error.message);
    }
    return 'Sorry, I encountered an issue trying to process your request with my AI brain.'; // Fallback response for errors
  }
}

module.exports = {
  getAIResponse,
}; 