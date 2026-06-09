/**
 * RagService.js
 *
 * PURPOSE: The complete RAG (Retrieval-Augmented Generation) pipeline.
 * This is the brain of Phase 3. It combines:
 *   1. pgvector similarity search  → finds relevant document chunks
 *   2. MongoDB chat history        → gives AI conversation context
 *   3. LangChain prompt template   → structures the AI prompt
 *   4. Ollama LLM (llama3.2)       → generates the answer
 *   5. SSE streaming               → sends tokens to frontend in real time
 *
 * TWO MODES:
 *   chat()       → returns full answer string (non-streaming)
 *   chatStream() → calls onChunk() for each token as it arrives (streaming)
 *
 * CALLED BY: ChatController.js
 *
 * FLOW:
 *   question → embed → pgvector search → load history →
 *   build prompt → LLM → stream answer → save to MongoDB
 */

require("dotenv").config();

const { ChatOllama } = require("@langchain/ollama");
const { OllamaEmbeddings } = require("@langchain/ollama");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");

// ── Ollama LLM instance ───────────────────────────────────────────────────
// llama3.2 is a capable 8B parameter model — good for RAG tasks
// temperature: 0 = deterministic answers (good for factual knowledge base)
// temperature: 0.7 = more creative (good for conversational bots)
const llm = new ChatOllama({
  model: "llama3.2",
  baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  temperature: 0.1, // low = more factual, less hallucination
  streaming: true,
});

// ── Ollama Embeddings instance ────────────────────────────────────────────
// MUST be same model as EmbeddingService.js uses for indexing
// Different model = incompatible vector spaces = wrong search results
const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text",
  baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
});

// ── System prompt ─────────────────────────────────────────────────────────
// This is the instruction we give the AI before every conversation.
// It tells the AI exactly how to behave — only use provided context,
// always cite sources, be honest when it doesn't know.
const SYSTEM_PROMPT = `You are a helpful company knowledge base assistant.

Answer questions using ONLY the context documents provided below.

RULES:
1. Use ONLY the provided context to answer.
2. If context is insufficient, say: "The knowledge base doesn't have enough detail about that. Based on what I can find: ..." and share what partial info exists.
3. Never say "I don't have information" and then answer anyway — pick one.
4. Always cite the source document and page number.
5. For follow-up questions, use the chat history to understand what was previously discussed.

CONTEXT FROM KNOWLEDGE BASE:
{context}`;

// ── Build the LangChain prompt template ──────────────────────────────────
// MessagesPlaceholder('chat_history') is where we inject past messages
// {input} is the current user question
const chatPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(SYSTEM_PROMPT),
  new MessagesPlaceholder("chat_history"),
  HumanMessagePromptTemplate.fromTemplate("{input}"),
]);

// ── Output parser ─────────────────────────────────────────────────────────
// Converts LLM response object to a plain string
const outputParser = new StringOutputParser();

// ── Full chain ────────────────────────────────────────────────────────────
// prompt | llm | parser  =  LCEL pipe operator
// Each step passes its output to the next step
const chain = chatPrompt.pipe(llm).pipe(outputParser);

module.exports = {
  // ─────────────────────────────────────────────────────────────────────
  // MAIN CHAT METHOD (non-streaming)
  // Returns complete answer string
  // Used by: ChatController.message()
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Process a user question and return a complete AI answer.
   *
   * @param {string} sessionId - Chat session UUID
   * @param {string} question  - User's question
   * @returns {Promise<{ answer: string, sources: Array }>}
   */
  async chat(sessionId, question) {
    sails.log.info(`[RagService] chat() — session: ${sessionId}`);
    sails.log.info(`[RagService] Original question: "${question}"`);

    // Step 1: Load chat history FIRST (needed for rephrasing)
    const chatHistory = await this._loadChatHistory(sessionId);

    // Step 2: Rephrase follow-up questions using history
    const smartQuestion = await this._rephraseQuestion(question, chatHistory);

    // Step 3: Embed the rephrased question
    const queryVector = await this._embedQuestion(smartQuestion);

    // Step 4: Search pgvector with the smart question
    const relevantChunks = await this._searchVectors(queryVector);

    // Step 5: Build context
    const { contextString, sources } = this._buildContext(relevantChunks);

    // Step 6: Invoke LLM
    const answer = await chain.invoke({
      context: contextString,
      chat_history: chatHistory,
      input: question, // Always pass ORIGINAL question to LLM
    });

    // Step 7: Save messages
    await this._saveMessages(sessionId, question, answer, sources);

    return { answer, sources };
  },

  // ─────────────────────────────────────────────────────────────────────
  // STREAMING CHAT METHOD
  // Calls onChunk(token) for each token as it arrives
  // Used by: ChatController.stream()
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Process a user question and stream the AI answer token by token.
   *
   * @param {string}   sessionId - Chat session UUID
   * @param {string}   question  - User's question
   * @param {Function} onChunk   - Called with each token string as it arrives
   * @returns {Promise<{ sources: Array }>}
   */
  async chatStream(sessionId, question, onChunk) {
    sails.log.info(`[RagService] chatStream() — session: ${sessionId}`);

    // Step 1: Load history first
    const chatHistory = await this._loadChatHistory(sessionId);

    // Step 2: Rephrase for better search
    const smartQuestion = await this._rephraseQuestion(question, chatHistory);

    // Step 3: Embed rephrased question
    const queryVector = await this._embedQuestion(smartQuestion);

    // Step 4: Search pgvector
    const relevantChunks = await this._searchVectors(queryVector);

    // Step 5: Build context
    const { contextString, sources } = this._buildContext(relevantChunks);

    // Step 6: Stream response
    const stream = await chain.stream({
      context: contextString,
      chat_history: chatHistory,
      input: question, // Original question always shown to user
    });

    let fullAnswer = "";
    for await (const chunk of stream) {
      fullAnswer += chunk;
      onChunk(chunk);
    }

    // Step 7: Save
    await this._saveMessages(sessionId, question, fullAnswer, sources);

    return { sources };
  },

  // ─────────────────────────────────────────────────────────────────────
  // PRIVATE HELPER METHODS
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Embed a question text using Ollama nomic-embed-text.
   * Returns 768-dimension vector array.
   */
  async _embedQuestion(question) {
    sails.log.info(`[RagService] Embedding question...`);
    try {
      const vector = await embeddings.embedQuery(question.trim());
      sails.log.info(
        `[RagService] Question embedded. Dimensions: ${vector.length}`,
      );
      return vector;
    } catch (err) {
      sails.log.error(`[RagService] Embedding failed: ${err.message}`);
      throw new Error(`Failed to embed question: ${err.message}`);
    }
  },

  /**
   * Search pgvector for the top K most similar chunks to the query vector.
   * Uses cosine similarity via the <=> operator.
   * Returns array of chunk objects with similarity scores.
   */
  async _searchVectors(queryVector, topK = 5) {
    sails.log.info(`[RagService] Searching pgvector for top ${topK} chunks...`);
    try {
      const chunks = await PgService.similaritySearch(queryVector, topK);
      sails.log.info(`[RagService] Found ${chunks.length} relevant chunks`);

      // Log what was found for debugging
      chunks.forEach((c, i) => {
        sails.log.info(
          `[RagService] Chunk ${i + 1}: "${c.doc_title}" page ${c.page_number} ` +
            `similarity: ${parseFloat(c.similarity).toFixed(4)}`,
        );
      });

      return chunks;
    } catch (err) {
      sails.log.error(`[RagService] pgvector search failed: ${err.message}`);
      throw new Error(`Failed to search knowledge base: ${err.message}`);
    }
  },

  /**
   * Load the last 10 messages for a session from MongoDB.
   * Converts to LangChain message objects for the prompt.
   *
   * HumanMessage = what the user said
   * AIMessage    = what the AI responded
   */
  async _loadChatHistory(sessionId, limit = 10) {
    try {
      const messages = await ChatMessage.find({ sessionId })
        .sort("createdAt ASC")
        .limit(limit);

      // Convert MongoDB records → LangChain message objects
      const history = messages.map((msg) => {
        if (msg.role === "user") {
          return new HumanMessage(msg.content);
        }
        return new AIMessage(msg.content);
      });

      sails.log.info(
        `[RagService] Loaded ${history.length} history messages for session: ${sessionId}`,
      );
      return history;
    } catch (err) {
      sails.log.warn(
        `[RagService] Could not load chat history: ${err.message}. Using empty history.`,
      );
      return []; // Return empty history on failure — don't break the chat
    }
  },

  /**
   * Build a formatted context string from retrieved chunks.
   * This string is injected into the system prompt as {context}.
   *
   * Also builds the sources array that is returned to the user
   * so they can see which documents the answer came from.
   */
  _buildContext(chunks) {
    if (!chunks || chunks.length === 0) {
      return {
        contextString: "No relevant documents found in the knowledge base.",
        sources: [],
      };
    }

    // Build formatted context string
    // Each chunk shows: source doc name, page number, then the content
    const contextParts = chunks.map((chunk, index) => {
      return (
        `[Document ${index + 1}: ${chunk.doc_title} — Page ${chunk.page_number}]\n` +
        chunk.content
      );
    });

    const contextString = contextParts.join("\n\n---\n\n");

    // Build sources array for the API response
    // This tells the frontend which docs to show as citations
    const sources = chunks.map((chunk) => ({
      docId: chunk.doc_id,
      docTitle: chunk.doc_title,
      docType: chunk.doc_type,
      pageNumber: chunk.page_number,
      similarity: parseFloat(parseFloat(chunk.similarity).toFixed(4)),
      preview: chunk.content.substring(0, 150) + "...", // first 150 chars
    }));

    sails.log.info(`[RagService] Built context from ${chunks.length} chunks`);
    return { contextString, sources };
  },

  /**
   * Save the user question and AI answer to MongoDB.
   * Also updates the session's messageCount and title.
   *
   * Sources are stored with the assistant message so the
   * frontend can show citation links under each AI answer.
   */
  async _saveMessages(sessionId, question, answer, sources) {
    try {
      // Save user message
      await ChatMessage.create({
        sessionId,
        role: "user",
        content: question,
        sources: [],
      });

      // Save assistant message with sources
      await ChatMessage.create({
        sessionId,
        role: "assistant",
        content: answer,
        sources: sources || [],
      });

      // Update session message count
      const session = await ChatSession.findOne({ sessionId });
      if (session) {
        const newCount = (session.messageCount || 0) + 2; // +2 for user + assistant
        const updates = { messageCount: newCount };

        // Auto-set session title from first user message
        if (session.messageCount === 0 && question.length > 0) {
          updates.title =
            question.length > 50 ? question.substring(0, 50) + "..." : question;
        }

        await ChatSession.updateOne({ sessionId }).set(updates);
      }

      sails.log.info(`[RagService] Messages saved for session: ${sessionId}`);
    } catch (err) {
      // Don't throw — saving failed but answer was already sent to user
      sails.log.error(`[RagService] Failed to save messages: ${err.message}`);
    }
  },

  async _rephraseQuestion(question, chatHistory) {
    // If no history — use question as-is
    if (!chatHistory || chatHistory.length === 0) {
      return question;
    }

    // Build a simple history string for context
    const historyText = chatHistory
      .slice(-4) // last 4 messages = 2 exchanges
      .map((m) => {
        if (m._getType && m._getType() === "human") return `User: ${m.content}`;
        return `Assistant: ${m.content.substring(0, 300)}`; // trim long answers
      })
      .join("\n");

    const rephrasePrompt = `Given this conversation history:
${historyText}

Rephrase this follow-up question into a standalone search query that includes all necessary context. Return ONLY the rephrased question, nothing else.

Follow-up question: ${question}
Standalone question:`;

    try {
      const response = await llm.invoke(rephrasePrompt);
      const rephrased = response.content.trim();
      sails.log.info(
        `[RagService] Original: "${question}" → Rephrased: "${rephrased}"`,
      );
      return rephrased;
    } catch (err) {
      sails.log.warn(
        `[RagService] Rephrase failed, using original: ${err.message}`,
      );
      return question; // Fall back to original if rephrase fails
    }
  },
};
