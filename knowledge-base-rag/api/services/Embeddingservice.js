/**
 * EmbeddingService.js
 *
 * PURPOSE: Convert text into embedding vectors using OpenAI's API.
 * These vectors are 1536-dimension float arrays that mathematically
 * represent the MEANING of the text.
 *
 * TWO USE CASES:
 * 1. embedChunks()  → called during INDEXING (Phase 2) to embed all chunks
 * 2. embedText()    → called during CHAT (Phase 3) to embed the user's query
 *
 * CRITICAL RULE: Both must use the EXACT same model.
 * If indexing uses text-embedding-3-small and query uses text-embedding-3-large,
 * the vector spaces are incompatible and similarity search returns garbage.
 *
 * FLOW: ChunkingService → EmbeddingService → VectorStoreService
 */

require("dotenv").config();
const { OpenAIEmbeddings } = require("@langchain/openai");

// ── Single shared embeddings instance ──────────────────────────────────────
// LangChain wrapper around OpenAI's embeddings API.
// Reads OPENAI_API_KEY from process.env automatically.
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small", // 1536 dimensions, cheap & fast
  openAIApiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3, // auto-retry on transient errors
  maxConcurrency: 5, // max parallel embedding calls
});

// Batch size: how many chunks we send per API call.
// OpenAI allows up to 2048 inputs per request but 20 is safe for all sizes.
const BATCH_SIZE = 20;

// Delay between batches in ms — avoids hitting rate limits
const BATCH_DELAY_MS = 300;

module.exports = {
  // ─────────────────────────────────────────────
  // EMBED MULTIPLE CHUNKS (used during indexing)
  // ─────────────────────────────────────────────

  /**
   * Generate embeddings for an array of chunks.
   * Processes in batches to respect OpenAI rate limits.
   *
   * @param {Array<object>} chunks - Array from ChunkingService.splitIntoChunks()
   * @returns {Promise<Array<{ chunk: object, vector: number[] }>>}
   *   Each item = original chunk object + its 1536-dim embedding vector
   */
  async embedChunks(chunks) {
    if (!chunks || chunks.length === 0) {
      throw new Error("No chunks provided to EmbeddingService.embedChunks()");
    }

    sails.log.info(
      `[EmbeddingService] Embedding ${chunks.length} chunks in batches of ${BATCH_SIZE}`,
    );

    const results = [];
    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map((c) => c.content);

      sails.log.info(
        `[EmbeddingService] Processing batch ${batchNum}/${totalBatches} (${batch.length} chunks)`,
      );

      try {
        // LangChain embedDocuments sends all texts in one API call
        const vectors = await embeddings.embedDocuments(batchTexts);

        // Pair each chunk with its vector
        batch.forEach((chunk, idx) => {
          results.push({
            chunk,
            vector: vectors[idx],
          });
        });

        // Delay between batches to avoid rate limits (skip after last batch)
        if (i + BATCH_SIZE < chunks.length) {
          await this._sleep(BATCH_DELAY_MS);
        }
      } catch (err) {
        // Handle OpenAI rate limit specifically
        if (
          err.status === 429 ||
          (err.message && err.message.includes("429"))
        ) {
          sails.log.warn(
            `[EmbeddingService] Rate limit hit on batch ${batchNum}. Waiting 10s before retry...`,
          );
          await this._sleep(10000);

          // Retry this batch once
          const vectors = await embeddings.embedDocuments(batchTexts);
          batch.forEach((chunk, idx) => {
            results.push({ chunk, vector: vectors[idx] });
          });
        } else {
          sails.log.error(
            `[EmbeddingService] Batch ${batchNum} failed: ${err.message}`,
          );
          throw new Error(
            `Embedding failed at batch ${batchNum}: ${err.message}`,
          );
        }
      }
    }

    sails.log.info(
      `[EmbeddingService] Successfully embedded ${results.length} chunks`,
    );
    return results;
  },

  // ─────────────────────────────────────────────
  // EMBED SINGLE TEXT (used during chat/search)
  // ─────────────────────────────────────────────

  /**
   * Generate embedding for a single text string.
   * Used to embed the user's query before similarity search.
   *
   * @param {string} text - The user's question or search query
   * @returns {Promise<number[]>} - 1536-dimension vector
   */
  async embedText(text) {
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot embed empty text");
    }

    try {
      // LangChain embedQuery is optimized for single query embedding
      const vector = await embeddings.embedQuery(text.trim());

      sails.log.info(
        `[EmbeddingService] Single text embedded. Vector dim: ${vector.length}`,
      );
      return vector;
    } catch (err) {
      sails.log.error(`[EmbeddingService] embedText failed: ${err.message}`);
      throw new Error(`Failed to embed query text: ${err.message}`);
    }
  },

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

  /**
   * Sleep for a given number of milliseconds.
   * Used for rate limit delays between batches.
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
