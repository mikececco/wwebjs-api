// npm install @langchain-anthropic
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import {
  // GmailCreateDraft,
  // GmailGetMessage,
  // GmailGetThread,
  // GmailSearch,
  GmailSendMessage,
} from "@langchain/community/tools/gmail";
// import { TavilySearch } from "@langchain/tavily";

let agent;
let model;
let openaiApiKey;
// let tavilyApiKey;
let gmailSendEmailTool;

async function initializeAgent() {
  if (agent) return; // Already initialized

  try {
    const configModule = await import('../config.js');
    openaiApiKey = configModule.openaiApiKey;
    // tavilyApiKey = configModule.tavilyApiKey;
  } catch (e) {
    console.error("[Autonomous Agent] Failed to load config.js:", e);
    openaiApiKey = null;
    // tavilyApiKey = null;
  }

  if (openaiApiKey) {
    model = new ChatOpenAI({
      apiKey: openaiApiKey,
      model: "gpt-4o-mini"
    });

    // const tavilyToolOptions = { maxResults: 5, topic: "general" };
    // if (tavilyApiKey) {
    //   tavilyToolOptions.apiKey = tavilyApiKey;
    //   console.log("[Autonomous Agent] Tavily API Key loaded and will be used.");
    // } else {
    //   console.warn("[Autonomous Agent] Tavily API Key not found. TavilySearch might not function correctly or use a default/environment key if set elsewhere.");
    // }
    // searchTool = new TavilySearch(tavilyToolOptions);

    const agentCheckpointer = new MemorySaver();

    agent = createReactAgent({
      llm: model,
      tools: [searchTool],
      checkpointer: agentCheckpointer,
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