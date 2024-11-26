import express from 'express';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '../lib/providers';
import {
  getGroqApiKey,
  getOllamaApiEndpoint,
  getAnthropicApiKey,
  getOpenaiApiKey,
  updateConfig,
  getMultiHopConfig,
  getOllamaToolConfig,
} from '../config';
import logger from '../utils/logger';
import { z } from 'zod'; // For validation

const router = express.Router();

// Validation schemas
const MultiHopConfigSchema = z.object({
  enabled: z.boolean(),
  maxHops: z.number().int().min(1).max(10),
  validationThreshold: z.number().min(0).max(1),
  timeoutMs: z.number().int().min(1000),
  recursionDepth: z.number().int().min(1).max(5),
});

const OllamaToolConfigSchema = z.object({
  enabled: z.boolean(),
  toolModels: z.array(z.string()),
  timeoutMs: z.number().int().min(1000),
  maxConcurrent: z.number().int().min(1),
  capabilities: z.object({
    codeInterpreter: z.boolean(),
    retrieval: z.boolean(),
    functionCalling: z.boolean(),
  }),
});

const ApiEndpointConfigSchema = z.object({
  OLLAMA: z.string().url(),
  CUSTOM_ENDPOINTS: z.record(z.string(), z.string().url()).optional(),
  TIMEOUT_MS: z.number().int().min(1000).optional(),
  RETRY_COUNT: z.number().int().min(0).max(5).optional(),
});

// Enhanced GET route
router.get('/', async (_, res) => {
  try {
    const config: any = {};

    // Fetch model providers
    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    // Process chat model providers
    config.chatModelProviders = Object.entries(chatModelProviders).reduce(
      (acc, [provider, models]) => ({
        ...acc,
        [provider]: Object.entries(models).map(([name, details]) => ({
          name,
          displayName: details.displayName,
          supportsTool: details.supportsTool || false,
          maxTokens: details.maxTokens,
        })),
      }),
      {}
    );

    // Process embedding model providers
    config.embeddingModelProviders = Object.entries(embeddingModelProviders).reduce(
      (acc, [provider, models]) => ({
        ...acc,
        [provider]: Object.entries(models).map(([name, details]) => ({
          name,
          displayName: details.displayName,
          dimensions: details.dimensions,
        })),
      }),
      {}
    );

    // Add API keys and endpoints
    config.apiKeys = {
      openai: getOpenaiApiKey(),
      anthropic: getAnthropicApiKey(),
      groq: getGroqApiKey(),
    };

    config.apiEndpoints = {
      ollama: getOllamaApiEndpoint(),
    };

    // Add multi-hop configuration
    config.multiHop = getMultiHopConfig();

    // Add Ollama tool configuration
    config.ollamaTool = getOllamaToolConfig();

    res.status(200).json(config);
  } catch (err: any) {
    logger.error(`Error getting config: ${err.message}`);
    res.status(500).json({ 
      message: 'An error has occurred.',
      error: err.message 
    });
  }
});

// Enhanced POST route
router.post('/', async (req, res) => {
  try {
    const { 
      apiKeys, 
      apiEndpoints, 
      multiHop, 
      ollamaTool 
    } = req.body;

    // Validate configurations
    try {
      if (multiHop) {
        MultiHopConfigSchema.parse(multiHop);
      }
      if (ollamaTool) {
        OllamaToolConfigSchema.parse(ollamaTool);
      }
      if (apiEndpoints) {
        ApiEndpointConfigSchema.parse(apiEndpoints);
      }
    } catch (validationError: any) {
      return res.status(400).json({
        message: 'Invalid configuration',
        errors: validationError.errors
      });
    }

    // Update configuration
    const updatedConfig = {
      API_KEYS: {
        OPENAI: apiKeys?.openai,
        GROQ: apiKeys?.groq,
        ANTHROPIC: apiKeys?.anthropic,
      },
      API_ENDPOINTS: {
        OLLAMA: apiEndpoints?.ollama,
        CUSTOM_ENDPOINTS: apiEndpoints?.customEndpoints,
        TIMEOUT_MS: apiEndpoints?.timeoutMs,
        RETRY_COUNT: apiEndpoints?.retryCount,
      },
      MULTI_HOP: multiHop && {
        ENABLED: multiHop.enabled,
        MAX_HOPS: multiHop.maxHops,
        VALIDATION_THRESHOLD: multiHop.validationThreshold,
        TIMEOUT_MS: multiHop.timeoutMs,
        RECURSION_DEPTH: multiHop.recursionDepth,
      },
      OLLAMA_TOOL: ollamaTool && {
        ENABLED: ollamaTool.enabled,
        TOOL_MODELS: ollamaTool.toolModels,
        TIMEOUT_MS: ollamaTool.timeoutMs,
        MAX_CONCURRENT: ollamaTool.maxConcurrent,
        CAPABILITIES: ollamaTool.capabilities,
      },
    };

    // Update configuration
    updateConfig(updatedConfig);

    res.status(200).json({ 
      message: 'Configuration updated successfully',
      config: updatedConfig
    });
  } catch (err: any) {
    logger.error(`Error updating config: ${err.message}`);
    res.status(500).json({ 
      message: 'Failed to update configuration',
      error: err.message 
    });
  }
});

// New route for validating configuration
router.post('/validate', async (req, res) => {
  try {
    const config = req.body;
    const validationResults = {
      multiHop: MultiHopConfigSchema.safeParse(config.multiHop),
      ollamaTool: OllamaToolConfigSchema.safeParse(config.ollamaTool),
      apiEndpoints: ApiEndpointConfigSchema.safeParse(config.apiEndpoints),
    };

    const isValid = Object.values(validationResults).every(result => result.success);

    res.status(200).json({
      isValid,
      validationResults,
    });
  } catch (err: any) {
    logger.error(`Validation error: ${err.message}`);
    res.status(500).json({ 
      message: 'Validation failed',
      error: err.message 
    });
  }
});

export default router;
