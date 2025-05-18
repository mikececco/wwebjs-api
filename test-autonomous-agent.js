require('dotenv').config(); // To load OPENAI_API_KEY from .env

// Note: We will dynamically import these inside runTest
// const { invokeAgent } = require('./src/aiAgent/autonomous-agent.js');
// const { HumanMessage } = require('@langchain/core/messages');

async function runTest() {
  // Dynamically import modules
  // const { HumanMessage } = await import('@langchain/core/messages'); // Not strictly needed if using plain objects for input
  const { invokeAgent } = await import('./src/aiAgent/autonomous-agent.js');

  console.log("Testing Autonomous Agent...");

  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY is not set in your .env file.");
    console.log("Please ensure your .env file exists in the project root and contains OPENAI_API_KEY.");
    return;
  }

  // The complex extractFinalAssistantResponse function is no longer needed 
  // as messages are transformed to have direct .content by invokeAgent.

  const testPayload1 = {
    messages: [{ role: "user", content: "what is the weather in sf?"}] 
  };
  const testConfig1 = { configurable: { thread_id: "thread_123" } };

  console.log("\n--- Test Case 1: Weather in SF with thread_id ---");
  try {
    const result1 = await invokeAgent(testPayload1, testConfig1);
    if (result1 && result1.messages && result1.messages.length > 0) {
      const lastMessage = result1.messages[result1.messages.length - 1];
      // Check if the last message is from the AI and has content
      if (lastMessage.type === 'AIMessage' && lastMessage.content) {
        console.log("Agent Response:", lastMessage.content);
      } else {
        console.log("Last message was not a suitable AI response:", lastMessage);
      }
    } else {
      console.log("Agent did not return messages or messages array was empty.", result1);
    }
  } catch (error) {
    console.error("Error during Test Case 1:", error);
  }
}

runTest(); 