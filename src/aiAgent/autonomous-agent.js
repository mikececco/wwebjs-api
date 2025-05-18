// npm install @langchain-anthropic
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";


import { z } from "zod";
import { openaiApiKey } from '../config.js'; // Assuming config.js is CommonJS and .js can be resolved

let agent;
let model;

if (openaiApiKey) {
  model = new ChatOpenAI({
    apiKey: openaiApiKey,
    model: "gpt-4o-mini" // or your preferred model
  });

  const search = tool(async ({ query }) => {
    // Simple placeholder for search functionality
    // In a real scenario, you'd integrate a proper search tool (e.g., TavilySearchResults)
    console.log(`[Autonomous Agent] Searching for: ${query}`);
    if (query.toLowerCase().includes("sf") || query.toLowerCase().includes("san francisco")) {
      return "It's 60 degrees and foggy in San Francisco.";
    }
    if (query.toLowerCase().includes("weather")) {
        return "The weather is generally pleasant, but it varies by location.";
    }
    return "Sorry, I couldn't find specific information for that query with my current tools.";
  }, {
    name: "search",
    description: "Call to surf the web or get information about various topics including weather.",
    schema: z.object({
      query: z.string().describe("The query to use in your search."),
    }),
  });

  const agentCheckpointer = new MemorySaver();


  agent = createReactAgent({
    llm: model,
    tools: [search],
    checkpointer: agentCheckpointer,
  });
} else {
  console.warn('[Autonomous Agent] OpenAI API Key not found. Autonomous agent will not be fully functional.');
}

/**
 * Invokes the autonomous Langchain agent with the given user message.
 * @param {object} invokeInput The input payload for the agent, typically an object with a `messages` array.
 * @param {object} [invokeConfig] Optional configuration for the agent invocation (e.g., for thread_id).
 * @returns {Promise<object|null>} The agent's response object, or null if the agent is not initialized or an error occurs.
 */
export async function invokeAgent(invokeInput, invokeConfig) {
  if (!agent) {
    console.error('[Autonomous Agent] Agent not initialized due to missing API key or other setup issues.');
    // Return a structure that calling code expecting direct .content might handle
    return {
      messages: [{
        // type: "AIMessage", // Or role: "assistant" if that's what test/sessions expect
        content: "My autonomous capabilities are not available right now. Please check server configuration.",
        // id: "error-" + Date.now() // Ensure this matches what consuming code might expect
      }]
    };
  }

  console.log(`[Autonomous Agent] Invoking agent with input:`, JSON.stringify(invokeInput));
  if (invokeConfig) {
    console.log(`[Autonomous Agent] Using invoke config:`, JSON.stringify(invokeConfig));
  }
  try {
    const result = await agent.invoke(invokeInput, invokeConfig);
    console.log("[Autonomous Agent] Agent invocation successful. Raw Result:", JSON.stringify(result.messages[result.messages.length - 1].content, null, 2));
    
    // Now returning the raw result from agent.invoke()
    return result; 

  } catch (error) {
    console.error("[Autonomous Agent] Error invoking agent:", error);
    return {
      messages: [{
        // type: "AIMessage",
        content: "Sorry, I encountered an issue while processing your request with my autonomous capabilities.",
        // id: "error-" + Date.now()
      }]
    };
  }
}

// If you need to export it as a default or specific named exports for ESM convention:
// export default { invokeAgent }; // Option 1: default export
// export { invokeAgent }; // Option 2: named export (already done by 'export async function ...')