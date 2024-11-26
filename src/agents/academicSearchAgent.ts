import { BaseMessage } from '@langchain/core/messages';
import {
  PromptTemplate,
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import {
  RunnableSequence,
  RunnableMap,
  RunnableLambda,
} from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Document } from '@langchain/core/documents';
import { searchSearxng } from '../lib/searxng';
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import formatChatHistoryAsString from '../utils/formatHistory';
import eventEmitter from 'events';
import computeSimilarity from '../utils/computeSimilarity';
import logger from '../utils/logger';
import { IterableReadableStream } from '@langchain/core/utils/stream';

const basicAcademicSearchRetrieverPrompt = `
You will be given a conversation below and a follow up question. You need to rephrase the follow-up question if needed so it is a standalone question that can be used by the LLM to search academic sources for information.
If it is a writing task or a simple hi, hello rather than a question, you need to return \`not_needed\` as the response.

Example:
1. Follow up question: What are the latest developments in quantum computing?
Rephrased: Recent advances in quantum computing research

2. Follow up question: Explain machine learning algorithms
Rephrased: Overview of machine learning algorithms

3. Follow up question: What is the impact of climate change?
Rephrased: Climate change effects and impacts research

Conversation:
{chat_history}

Follow up question: {query}
Rephrased question:
`;

const basicAcademicSearchResponsePrompt = `
You are Perplexica, an AI model who is expert at searching and synthesizing academic information. You are set on focus mode 'Academic Search', this means you will be searching academic sources including arxiv, google scholar, and pubmed.

Generate a response that is informative and relevant to the user's query based on provided context (the context consists of search results from academic sources).
You must use this context to answer the user's query in the best way possible. Use an unbiased and academic tone in your response. Do not repeat the text verbatim.
You must not tell the user to open any link or visit any website to get the answer. You must provide the answer in the response itself. If the user asks for citations you can provide them.

Your responses should be:
- Medium to long in length
- Informative and relevant to the user's query
- Written in an academic style
- Well-structured with clear sections when appropriate
- Include citations using [number] notation

Citation guidelines:
- Cite each claim or piece of information
- Place citations at the end of relevant sentences
- You can cite multiple sources for a single claim using [number1][number2] format
- The number refers to the search result number in the provided context

<context>
{context}
</context>

If you think there's nothing relevant in the search results, you can say that 'I apologize, but I could not find any relevant academic sources on this specific topic. Would you like me to search again with a different approach?'

Anything between the \`context\` tags is retrieved from academic sources and is not part of the conversation with the user. Today's date is ${new Date().toISOString()}
`;

// [Rest of the code remains unchanged as provided in the original file]

interface SimilarityResult {
  index: number;
  similarity: number;
}

const strParser = new StringOutputParser();

const handleStream = async (
  stream: IterableReadableStream<StreamEvent>,
  emitter: eventEmitter,
) => {
  for await (const event of stream) {
    if (
      event.event === 'on_chain_end' &&
      event.name === 'FinalSourceRetriever'
    ) {
      emitter.emit(
        'data',
        JSON.stringify({ type: 'sources', data: event.data.output }),
      );
    }
    if (
      event.event === 'on_chain_stream' &&
      event.name === 'FinalResponseGenerator'
    ) {
      emitter.emit(
        'data',
        JSON.stringify({ type: 'response', data: event.data.chunk }),
      );
    }
    if (
      event.event === 'on_chain_end' &&
      event.name === 'FinalResponseGenerator'
    ) {
      emitter.emit('end');
    }
  }
};

type BasicChainInput = {
  chat_history: BaseMessage[];
  query: string;
};

const createBasicAcademicSearchRetrieverChain = (llm: BaseChatModel) => {
  return RunnableSequence.from([
    PromptTemplate.fromTemplate(basicAcademicSearchRetrieverPrompt),
    llm,
    strParser,
    RunnableLambda.from(async (input: string) => {
      if (input === 'not_needed') {
        return { query: '', docs: [] };
      }

      const res = await searchSearxng(input, {
        language: 'en',
        engines: ['arxiv', 'google scholar', 'pubmed'],
      });

      const documents = res.results.map(
        (result) =>
          new Document({
            pageContent: result.content,
            metadata: {
              title: result.title,
              url: result.url,
              ...(result.img_src && { img_src: result.img_src }),
            },
          }),
      );

      return { query: input, docs: documents };
    }),
  ]);
};

const createBasicAcademicSearchAnsweringChain = (
  llm: BaseChatModel,
  embeddings: Embeddings,
  optimizationMode: 'speed' | 'balanced' | 'quality',
) => {
  const basicAcademicSearchRetrieverChain =
    createBasicAcademicSearchRetrieverChain(llm);

  const processDocs = async (docs: Document[]) => {
    return docs
      .map((_, index) => `${index + 1}. ${docs[index].pageContent}`)
      .join('\n');
  };

  const rerankDocs = async ({
    query,
    docs,
  }: {
    query: string;
    docs: Document[];
  }) => {
    if (docs.length === 0) {
      return docs;
    }

    const docsWithContent = docs.filter(
      (doc) => doc.pageContent && doc.pageContent.length > 0,
    );

    if (optimizationMode === 'speed') {
      return docsWithContent.slice(0, 15);
    } else if (optimizationMode === 'balanced') {
      const [docEmbeddings, queryEmbedding] = await Promise.all([
        embeddings.embedDocuments(
          docsWithContent.map((doc) => doc.pageContent),
        ),
        embeddings.embedQuery(query),
      ]);

      const similarity: SimilarityResult[] = docEmbeddings.map((docEmbedding, i) => {
        const sim = computeSimilarity(queryEmbedding, docEmbedding);
        
        return {
          index: i,
          similarity: typeof sim === 'number' ? sim : sim.value // Handle both number and object returns
        };
      });
SearchRetriever
      const sortedDocs = similarity
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 15)
        .map((sim) => docsWithContent[sim.index]);

      return sortedDocs;
    }
  };

  return RunnableSequence.from([
    RunnableMap.from({
      query: (input: BasicChainInput) => input.query,
      chat_history: (input: BasicChainInput) => input.chat_history,
      context: RunnableSequence.from([
        (input) => ({
          query: input.query,
          chat_history: formatChatHistoryAsString(input.chat_history),
        }),
        basicAcademicSearchRetrieverChain
          .pipe(rerankDocs)
          .withConfig({
            runName: 'FinalSourceRetriever',
          })
          .pipe(processDocs),
      ]),
    }),
    ChatPromptTemplate.fromMessages([
      ['system', basicAcademicSearchResponsePrompt],
      new MessagesPlaceholder('chat_history'),
      ['user', '{query}'],
    ]),
    llm,
    strParser,
  ]).withConfig({
    runName: 'FinalResponseGenerator',
  });
};

const basicAcademicSearch = (
  query: string,
  history: BaseMessage[],
  llm: BaseChatModel,
  embeddings: Embeddings,
  optimizationMode: 'speed' | 'balanced' | 'quality',
) => {
  const emitter = new eventEmitter();

  try {
    const basicAcademicSearchAnsweringChain =
      createBasicAcademicSearchAnsweringChain(
        llm,
        embeddings,
        optimizationMode,
      );

    const stream = basicAcademicSearchAnsweringChain.streamEvents(
      {
        chat_history: history,
        query: query,
      },
      {
        version: 'v1',
      },
    );

    handleStream(stream, emitter);
  } catch (err) {
    emitter.emit(
      'error',
      JSON.stringify({ data: 'An error has occurred please try again later' }),
    );
    logger.error(`Error in academic search: ${err}`);
  }

  return emitter;
};

const handleAcademicSearch = (
  message: string,
  history: BaseMessage[],
  llm: BaseChatModel,
  embeddings: Embeddings,
  optimizationMode: 'speed' | 'balanced' | 'quality',
) => {
  const emitter = basicAcademicSearch(
    message,
    history,
    llm,
    embeddings,
    optimizationMode,
  );
  return emitter;
};

export default handleAcademicSearch;
