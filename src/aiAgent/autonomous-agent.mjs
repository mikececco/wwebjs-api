// npm install @langchain-anthropic
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import { TavilySearch } from "@langchain/tavily";

const searchTool = new TavilySearch({
  maxResults: 5,
  topic: "general",
});

// import { openaiApiKey } from '../config.js'; // Will be dynamically imported

let agent;
let model;
let openaiApiKey;

async function initializeAgent() {
  if (agent) return; // Already initialized

  try {
    const configModule = await import('../config.js');
    openaiApiKey = configModule.openaiApiKey;
  } catch (e) {
    console.error("[Autonomous Agent] Failed to load config.js:", e);
    openaiApiKey = null;
  }

  if (openaiApiKey) {
    model = new ChatOpenAI({
      apiKey: openaiApiKey,
      model: "gpt-4o-mini"
    });

    const search = tool(async ({ query }) => {
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
      tools: [searchTool],
      checkpointer: agentCheckpointer, // Corrected property name from checkpointSaver to checkpointer
    });
    console.log("[Autonomous Agent] Initialized successfully.");
  } else {
    console.warn('[Autonomous Agent] OpenAI API Key not found from config. Autonomous agent will not be fully functional.');
  }
}

/**
 * Invokes the autonomous Langchain agent with the given user message.
 * @param {object} invokeInput The input payload for the agent, typically an object with a `messages` array.
 * @param {object} [invokeConfig] Optional configuration for the agent invocation (e.g., for thread_id).
 * @returns {Promise<object|null>} The agent's response object, or null if the agent is not initialized or an error occurs.
 */
export async function invokeAgent(invokeInput, invokeConfig) {
  await initializeAgent(); // Ensure agent is initialized

  if (!agent) {
    console.error('[Autonomous Agent] Agent not initialized due to missing API key or other setup issues.');
    return {
      messages: [{
        content: "My autonomous capabilities are not available right now. Please check server configuration.",
      }]
    };
  }

  if (!invokeConfig || !invokeConfig.configurable || !invokeConfig.configurable.thread_id) {
    console.error('[Autonomous Agent] Error: invokeConfig must include { configurable: { thread_id: "your_thread_id" } } when using MemorySaver.');
    return {
      messages: [{
        content: "Error: Conversation thread_id is missing for the agent.",
      }]
    };
  }

  console.log(`[Autonomous Agent] Invoking agent with input:`, JSON.stringify(invokeInput));
  console.log(`[Autonomous Agent] Using invoke config:`, JSON.stringify(invokeConfig));
  
  try {
    const result = await agent.invoke(invokeInput, invokeConfig);
    // Log the entire messages array or the full result for better inspection
    console.log("[Autonomous Agent] Agent invocation successful. Raw Result Messages:", JSON.stringify(result.messages, null, 2));
    return result;
  } catch (error) {
    console.error("[Autonomous Agent] Error invoking agent:", error);
    return {
      messages: [{
        content: "Sorry, I encountered an issue while processing your request with my autonomous capabilities.",
      }]
    };
  }
}

// If you need to export it as a default or specific named exports for ESM convention:
// export default { invokeAgent }; // Option 1: default export
// export { invokeAgent }; // Option 2: named export (already done by 'export async function ...')