/**
 * EmbeddingService.js  (Updated for Ollama)
 *
 * PURPOSE: Convert text into embedding vectors using Ollama's nomic-embed-text.
 * These vectors are 768-dimension float arrays that mathematically
 * represent the MEANING of the text.
 *
 * TWO USE CASES:
 * 1. embedChunks() → called during INDEXING (Phase 2) to embed all chunks
 * 2. embedText()   → called during CHAT (Phase 3) to embed the user's query
 *
 * CRITICAL RULE: Both MUST use the EXACT same model.
 * RagService.js also uses nomic-embed-text for query embedding.
 * If they ever differ, similarity search returns garbage results.
 *
 * CHANGED FROM OPENAI:
 *   Before: OpenAIEmbeddings({ model: 'text-embedding-3-small' }) → 1536 dims
 *   After:  OllamaEmbeddings({ model: 'nomic-embed-text' })       → 768 dims
 *
 * FLOW: ChunkingService → EmbeddingService → VectorStoreService
 */

require("dotenv").config();
const { OllamaEmbeddings } = require("@langchain/ollama");

// ── Single shared embeddings instance ──────────────────────────────────────
const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text", // 768 dimensions
  baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
});

// Batch size: how many chunks per embedding call
// Ollama runs locally so we can use smaller batches safely
const BATCH_SIZE = 10;

// Small delay between batches (ms) — gives Ollama time to breathe
const BATCH_DELAY_MS = 200;

module.exports = {
  // ─────────────────────────────────────────────
  // EMBED MULTIPLE CHUNKS (used during indexing)
  // ─────────────────────────────────────────────

  /**
   * Generate embeddings for an array of chunks.
   * Processes in batches to avoid overloading local Ollama.
   *
   * @param {Array<object>} chunks - Array from ChunkingService.splitIntoChunks()
   * @returns {Promise<Array<{ chunk: object, vector: number[] }>>}
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
        `[EmbeddingService] Batch ${batchNum}/${totalBatches} (${batch.length} chunks)`,
      );

      try {
        // OllamaEmbeddings.embedDocuments() sends all texts in one call
        const vectors = await embeddings.embedDocuments(batchTexts);

        // Pair each chunk with its vector
        batch.forEach((chunk, idx) => {
          results.push({
            chunk,
            vector: vectors[idx],
          });
        });

        // Small delay between batches — not strictly needed for Ollama
        // but good practice to avoid memory spikes
        if (i + BATCH_SIZE < chunks.length) {
          await this._sleep(BATCH_DELAY_MS);
        }
      } catch (err) {
        sails.log.error(
          `[EmbeddingService] Batch ${batchNum} failed: ${err.message}`,
        );

        // Check if Ollama is running
        if (
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("fetch failed")
        ) {
          throw new Error(
            'Cannot connect to Ollama. Make sure Ollama is running: run "ollama serve" in terminal',
          );
        }

        // Check if model is pulled
        if (
          err.message.includes("model") &&
          err.message.includes("not found")
        ) {
          throw new Error(
            "Ollama model not found. Run: ollama pull nomic-embed-text",
          );
        }

        throw new Error(
          `Embedding failed at batch ${batchNum}: ${err.message}`,
        );
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
   * Used to embed user's query before similarity search.
   *
   * @param {string} text - The user's question or search query
   * @returns {Promise<number[]>} - 768-dimension vector
   */
  async embedText(text) {
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot embed empty text");
    }

    try {
      const vector = await embeddings.embedQuery(text.trim());
      sails.log.info(
        `[EmbeddingService] Query embedded. Dimensions: ${vector.length}`,
      );
      return vector;
    } catch (err) {
      if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed")
      ) {
        throw new Error(
          "Cannot connect to Ollama. Make sure it is running: ollama serve",
        );
      }
      throw new Error(`Failed to embed query: ${err.message}`);
    }
  },

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
