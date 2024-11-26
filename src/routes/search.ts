import express from 'express';
import logger from '../utils/logger';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Embeddings } from 'langchain/embeddings/base';
import { ChatOpenAI } from '@langchain/openai';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '../lib/providers';
import { searchHandlers } from '../websocket/messageHandler';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';

const router = express.Router();

// Enhanced interface with multi-hop and optimization settings
interface ChatRequestBody {
  optimizationMode: 'speed' | 'balanced' | 'quality';
  focusMode: string;
  chatModel?: chatModel;
  embeddingModel?: embeddingModel;
  query: string;
  history: Array<[string, string]>;
  multiHop?: {
    enabled: boolean;
    maxHops: number;
    validationThreshold: number;
  };
  responseFormat?: 'simple' | 'detailed';
}

// Add new route for multi-hop search
router.post('/multi-hop', async (req, res) => {
  try {
    const body: ChatRequestBody = req.body;
    
    if (!body.query || !body.multiHop?.enabled) {
      return res.status(400).json({ 
        message: 'Invalid multi-hop search request' 
      });
    }

    // Process multi-hop specific logic here
    const response = await handleMultiHopSearch(body);
    res.status(200).json(response);
  } catch (err: any) {
    logger.error(`Multi-hop search error: ${err.message}`);
    res.status(500).json({ message: 'Multi-hop search failed' });
  }
});

// Main search route with enhanced capabilities
router.post('/', async (req, res) => {
  try {
    const body: ChatRequestBody = req.body;

    if (!body.focusMode || !body.query) {
      return res.status(400).json({ message: 'Missing focus mode or query' });
    }

    // Initialize default values
    body.history = body.history || [];
    body.optimizationMode = body.optimizationMode || 'balanced';
    body.responseFormat = body.responseFormat || 'simple';
    body.multiHop = body.multiHop || {
      enabled: false,
      maxHops: 3,
      validationThreshold: 0.7
    };

    const history: BaseMessage[] = body.history.map((msg) => 
      msg[0] === 'human' ? new HumanMessage({ content: msg[1] }) 
                        : new AIMessage({ content: msg[1] })
    );

    // Load models
    const [llm, embeddings] = await loadModels(body);

    if (!llm || !embeddings) {
      return res.status(400).json({ message: 'Invalid model configuration' });
    }

    const searchHandler = searchHandlers[body.focusMode];
    if (!searchHandler) {
      return res.status(400).json({ message: 'Invalid focus mode' });
    }

    // Create response accumulator
    const responseAccumulator = createResponseAccumulator(body.responseFormat);

    // Initialize search emitter with enhanced options
    const emitter = searchHandler(
      body.query,
      history,
      llm,
      embeddings,
      body.optimizationMode,
      {
        multiHop: body.multiHop,
        responseFormat: body.responseFormat
      }
    );

    // Enhanced event handling
    setupEventHandlers(emitter, responseAccumulator, res);

  } catch (err: any) {
    logger.error(`Search error: ${err.message}`);
    res.status(500).json({ 
      message: 'Search failed',
      error: err.message 
    });
  }
});

// Helper functions
async function loadModels(body: ChatRequestBody) {
  const [chatModelProviders, embeddingModelProviders] = await Promise.all([
    getAvailableChatModelProviders(),
    getAvailableEmbeddingModelProviders(),
  ]);

  let llm: BaseChatModel | undefined;
  let embeddings: Embeddings | undefined;

  if (body.chatModel?.provider === 'custom_openai') {
    if (!body.chatModel?.customOpenAIBaseURL || !body.chatModel?.customOpenAIKey) {
      throw new Error('Invalid custom OpenAI configuration');
    }

    llm = new ChatOpenAI({
      modelName: body.chatModel.model,
      openAIApiKey: body.chatModel.customOpenAIKey,
      temperature: 0.7,
      configuration: {
        baseURL: body.chatModel.customOpenAIBaseURL,
      },
    }) as unknown as BaseChatModel;
  } else {
    const provider = body.chatModel?.provider || Object.keys(chatModelProviders)[0];
    const model = body.chatModel?.model || Object.keys(chatModelProviders[provider])[0];
    llm = chatModelProviders[provider]?.[model]?.model as unknown as BaseChatModel;
  }

  const embeddingProvider = body.embeddingModel?.provider || Object.keys(embeddingModelProviders)[0];
  const embeddingModel = body.embeddingModel?.model || Object.keys(embeddingModelProviders[embeddingProvider])[0];
  embeddings = embeddingModelProviders[embeddingProvider]?.[embeddingModel]?.model as Embeddings;

  return [llm, embeddings];
}

function createResponseAccumulator(format: string = 'simple') {
  return {
    message: '',
    sources: [],
    metadata: {
      format,
      timestamp: new Date().toISOString(),
      hops: [],
      confidence: 0
    }
  };
}

function setupEventHandlers(emitter: any, accumulator: any, res: any) {
  emitter.on('data', (data: string) => {
    const parsedData = JSON.parse(data);
    switch (parsedData.type) {
      case 'response':
        accumulator.message += parsedData.data;
        break;
      case 'sources':
        accumulator.sources = parsedData.data;
        break;
      case 'hop':
        accumulator.metadata.hops.push(parsedData.data);
        break;
      case 'confidence':
        accumulator.metadata.confidence = parsedData.data;
        break;
    }
  });

  emitter.on('end', () => {
    res.status(200).json(accumulator);
  });

  emitter.on('error', (data: string) => {
    const parsedData = JSON.parse(data);
    res.status(500).json({ 
      message: parsedData.data,
      metadata: accumulator.metadata 
    });
  });
}

async function handleMultiHopSearch(body: ChatRequestBody) {
  // Implement multi-hop specific logic here
  const hops = [];
  let currentQuery = body.query;

  for (let i = 0; i < body.multiHop!.maxHops; i++) {
    const hopResult = await executeSearchHop(currentQuery, body);
    hops.push(hopResult);

    if (hopResult.confidence >= body.multiHop!.validationThreshold) {
      break;
    }
    currentQuery = hopResult.nextQuery;
  }

  return {
    finalAnswer: hops[hops.length - 1].answer,
    hops: hops,
    metadata: {
      hopCount: hops.length,
      confidence: hops[hops.length - 1].confidence
    }
  };
}

async function executeSearchHop(query: string, config: ChatRequestBody) {
  // Implement individual hop execution logic
  // This would be implemented based on your specific search logic
  return {
    query: query,
    answer: '',
    confidence: 0,
    nextQuery: ''
  };
}

export default router;
