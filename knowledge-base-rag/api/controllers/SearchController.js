/**
 * SearchController.js
 *
 * PURPOSE: Standalone semantic search — find relevant document chunks
 * WITHOUT calling the LLM. Much faster and cheaper than full RAG chat.
 *
 * USE CASE: "Search my documents for X" — returns matching passages
 * with source info, but no AI-generated answer. Good for:
 *   - Quick lookups
 *   - Browsing/exploring the knowledge base
 *   - Building a "search results" page (like Google search)
 *
 * ROUTE: GET /api/search?q=...&topK=5
 * POLICY: isAuthenticated (any logged-in user)
 *
 * FLOW:
 *   query string → embed (Ollama) → pgvector similarity search → return chunks
 *   (NO LLM call — this is the key difference from /api/chat/message)
 */

module.exports = {
  /**
   * Semantic search across all indexed documents.
   *
   * Query params:
   *   q     (required) - search query text
   *   topK  (optional) - number of results, default 5, max 20
   *
   * Returns: { query, results: [...], total, tookMs }
   */
  search: async function (req, res) {
    const startTime = Date.now();

    try {
      const { q } = req.query;
      let topK = parseInt(req.query.topK) || 5;

      // ── Validation ────────────────────────────────────────────────
      if (!q || q.trim().length === 0) {
        return res.badRequest({ error: 'Query parameter "q" is required' });
      }
      if (q.trim().length > 500) {
        return res.badRequest({
          error: "Query is too long (max 500 characters)",
        });
      }
      if (topK > 20) topK = 20; // cap to prevent abuse
      if (topK < 1) topK = 5;

      sails.log.info(`[SearchController] Search query: "${q}" (topK=${topK})`);

      // ── Step 1: Embed the search query ──────────────────────────────
      // Uses the SAME embedding model as document indexing (nomic-embed-text)
      const queryVector = await Embeddingservice.embedText(q.trim());

      // ── Step 2: pgvector similarity search ──────────────────────────
      // NO LLM involved — this is a pure database query
      const chunks = await PgService.similaritySearch(queryVector, topK);

      // ── Step 3: Format results ───────────────────────────────────────
      const results = chunks.map((chunk) => ({
        docId: chunk.doc_id,
        docTitle: chunk.doc_title,
        docType: chunk.doc_type,
        pageNumber: chunk.page_number,
        chunkIndex: chunk.chunk_index,
        content: chunk.content,
        similarity: parseFloat(parseFloat(chunk.similarity).toFixed(4)),
      }));

      const tookMs = Date.now() - startTime;

      sails.log.info(
        `[SearchController] Found ${results.length} results in ${tookMs}ms`,
      );

      return res.json({
        query: q,
        results,
        total: results.length,
        tookMs,
      });
    } catch (err) {
      sails.log.error("[SearchController] search error:", err);

      if (
        err.message.includes("Ollama") ||
        err.message.includes("ECONNREFUSED")
      ) {
        return res.status(503).json({
          error:
            "Search service unavailable. Make sure Ollama is running (ollama serve).",
        });
      }

      return res.serverError({ error: err.message });
    }
  },
};
