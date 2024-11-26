import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama';
import { ChatOllama } from '@langchain/community/chat_models/ollama';
import { getKeepAlive, getOllamaApiEndpoint } from '../../config';
import logger from '../../utils/logger';

// Define tool interfaces
interface OllamaTool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

// Default tools configuration
const defaultTools: OllamaTool[] = [
  {
    type: "function",
    function: {
      name: "search",
      description: "Search through documents and return relevant information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Maximum number of results" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze",
      description: "Analyze and extract key information from text",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to analyze" },
          aspects: { type: "array", items: { type: "string" } }
        },
        required: ["text"]
      }
    }
  }
];

// Enhanced API endpoint handling
async function fetchFromOllama(endpoint: string, options = {}) {
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000, // 30 second timeout
  };

  try {
    const response = await fetch(`${endpoint}`, {
      ...defaultOptions,
      ...options
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error(`Ollama API request failed: ${error}`);
    throw error;
  }
}

export const loadOllamaChatModels = async () => {
  const ollamaEndpoint = getOllamaApiEndpoint();
  const keepAlive = getKeepAlive();
  
  if (!ollamaEndpoint) {
    logger.warn('Ollama endpoint not configured');
    return {};
  }

  try {
    const { models: ollamaModels } = await fetchFromOllama(`${ollamaEndpoint}/api/tags`);

    const chatModels = ollamaModels.reduce((acc, model) => {
      try {
        acc[model.model] = {
          displayName: model.name,
          model: new ChatOllama({
            baseUrl: ollamaEndpoint,
            model: model.model,
            temperature: 0.7,
            keepAlive: keepAlive,
            tools: defaultTools,
            // New Ollama 0.4 specific configurations
            context_window: 4096,
            num_ctx: 4096,
            repeat_penalty: 1.1,
            seed: 42,
            threads: navigator.hardwareConcurrency || 4,
            error_handling: {
              retry_on_failure: true,
              max_retries: 3,
              retry_delay: 1000
            }
          }),
          metadata: {
            ...model,
            supported_features: ['tools', 'streaming', 'function_calling']
          }
        };
        return acc;
      } catch (err) {
        logger.error(`Error initializing chat model ${model.name}: ${err}`);
        return acc;
      }
    }, {});

    logger.info(`Loaded ${Object.keys(chatModels).length} chat models`);
    return chatModels;
  } catch (err) {
    logger.error(`Error loading Ollama models: ${err}`);
    throw new Error(`Failed to load Ollama models: ${err.message}`);
  }
};

export const loadOllamaEmbeddingsModels = async () => {
  const ollamaEndpoint = getOllamaApiEndpoint();

  if (!ollamaEndpoint) {
    logger.warn('Ollama endpoint not configured');
    return {};
  }

  try {
    const { models: ollamaModels } = await fetchFromOllama(`${ollamaEndpoint}/api/tags`);

    const embeddingsModels = ollamaModels.reduce((acc, model) => {
      try {
        acc[model.model] = {
          displayName: model.name,
          model: new OllamaEmbeddings({
            baseUrl: ollamaEndpoint,
            model: model.model,
            // Enhanced embeddings configuration
            dimensions: 384,
            batchSize: 32,
            error_handling: {
              retry_on_failure: true,
              max_retries: 3,
              retry_delay: 1000
            }
          }),
          metadata: {
            ...model,
            supported_features: ['embeddings', 'batching']
          }
        };
        return acc;
      } catch (err) {
        logger.error(`Error initializing embeddings model ${model.name}: ${err}`);
        return acc;
      }
    }, {});

    logger.info(`Loaded ${Object.keys(embeddingsModels).length} embeddings models`);
    return embeddingsModels;
  } catch (err) {
    logger.error(`Error loading Ollama embeddings models: ${err}`);
    throw new Error(`Failed to load Ollama embeddings models: ${err.message}`);
  }
};

// Export tool configurations for external use
export const getDefaultTools = () => defaultTools;
