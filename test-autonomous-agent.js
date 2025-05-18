require('dotenv').config(); // To load OPENAI_API_KEY from .env

// Note: We will dynamically import these inside runTest
// const { invokeAgent } = require('./src/aiAgent/autonomous-agent.js');
// const { HumanMessage } = require('@langchain/core/messages');

async function runTest() {
  const { AIMessage } = await import('@langchain/core/messages'); // For instanceof check
  // HumanMessage is not strictly needed if constructing inputs as plain objects
  // const { HumanMessage } = await import('@langchain/core/messages'); 
  const { invokeAgent } = await import('./src/aiAgent/autonomous-agent.mjs'); // Updated to .mjs

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
  const testConfig1 = { configurable: { thread_id: "test_thread_sf" } };

  console.log("\n--- Test Case 1: Weather in SF with thread_id ---");
  try {
    const result1 = await invokeAgent(testPayload1, testConfig1);
    if (result1 && result1.messages && result1.messages.length > 0) {
      const lastMessage = result1.messages[result1.messages.length - 1];
      if (lastMessage instanceof AIMessage && typeof lastMessage.content === 'string') {
        console.log("Agent Response:", lastMessage.content);
      } else {
        console.log("Last message was not a suitable AI response or not an AIMessage instance:", lastMessage);
      }
    } else {
      console.log("Agent did not return messages or messages array was empty.", result1);
    }
  } catch (error) {
    console.error("Error during Test Case 1:", error);
  }

  const testPayload2 = {
    messages: [{ role: "user", content: "What about New York?"}]
  };
  // MemorySaver requires a thread_id for each call
  const testConfig2 = { configurable: { thread_id: "test_thread_ny" } }; 

  console.log("\n--- Test Case 2: Weather in NY with thread_id ---");
  try {
    const result2 = await invokeAgent(testPayload2, testConfig2);
     if (result2 && result2.messages && result2.messages.length > 0) {
      const lastMessage = result2.messages[result2.messages.length - 1];
      if (lastMessage instanceof AIMessage && typeof lastMessage.content === 'string') {
        console.log("Agent Response:", lastMessage.content);
      } else {
        console.log("Last message was not a suitable AI response or not an AIMessage instance:", lastMessage);
      }
    } else {
      console.log("Agent did not return messages or messages array was empty.", result2);
    }
  } catch (error) {
    console.error("Error during Test Case 2:", error);
  }

  const testPayload3 = {
    messages: [{role: 'user', content: 'Can you tell me a joke?'}]
  };
  const testConfig3 = { configurable: { thread_id: "test_thread_joke" } };

  console.log("\n--- Test Case 3: Simple user message (joke) with thread_id ---");
  try {
    const result3 = await invokeAgent(testPayload3, testConfig3);
    if (result3 && result3.messages && result3.messages.length > 0) {
      const lastMessage = result3.messages[result3.messages.length - 1];
      if (lastMessage instanceof AIMessage && typeof lastMessage.content === 'string') {
        console.log("Agent Response:", lastMessage.content);
      } else {
        console.log("Last message was not a suitable AI response or not an AIMessage instance:", lastMessage);
      }
    } else {
      console.log("Agent did not return messages or messages array was empty.", result3);
    }
  } catch (error) {
    console.error("Error during Test Case 3:", error);
  }
}

runTest(); 