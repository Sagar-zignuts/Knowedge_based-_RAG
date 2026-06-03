/**
 * VectorStoreService.js
 *
 * PURPOSE: Bridge between EmbeddingService and PgService.
 * Handles storing embedded chunks into pgvector and
 * deleting all chunks when a document is removed.
 *
 * FLOW (indexing): EmbeddingService → VectorStoreService → PgService → pgvector
 * FLOW (delete):   DocumentController → VectorStoreService → PgService → pgvector
 *
 * This service keeps DocumentController clean — it calls one method
 * and doesn't need to know anything about PostgreSQL or pgvector.
 */

module.exports = {
  // ─────────────────────────────────────────────
  // INDEX DOCUMENT (store all chunks into pgvector)
  // ─────────────────────────────────────────────

  /**
   * Store all embedded chunks for a document into pgvector.
   * Called after EmbeddingService.embedChunks() completes.
   *
   * @param {string} docId           - MongoDB UUID of the document
   * @param {Array}  embeddedChunks  - Output from EmbeddingService.embedChunks()
   *   Each item = { chunk: { content, docTitle, docType, chunkIndex, pageNumber }, vector: [] }
   * @param {Function} onProgress    - Optional callback(storedCount, totalCount)
   *
   * @returns {Promise<number>} - Number of chunks stored
   */
  async indexDocument(docId, embeddedChunks, onProgress = null) {
    if (!embeddedChunks || embeddedChunks.length === 0) {
      throw new Error(
        "No embedded chunks provided to VectorStoreService.indexDocument()",
      );
    }

    sails.log.info(
      `[VectorStoreService] Storing ${embeddedChunks.length} chunks for doc: ${docId}`,
    );

    let storedCount = 0;

    // Use a PostgreSQL client from the pool for transaction safety.
    // If any insert fails, we can roll back — no partial indexes.
    const client = await PgService.getClient();

    try {
      await client.query("BEGIN"); // Start transaction

      for (const { chunk, vector } of embeddedChunks) {
        const sql = `
          INSERT INTO document_chunks
            (doc_id, doc_title, doc_type, chunk_index, page_number, content, embedding, metadata)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7::vector, $8)
        `;

        const params = [
          docId,
          chunk.docTitle || "Untitled",
          chunk.docType || "text",
          chunk.chunkIndex || 0,
          chunk.pageNumber || 1,
          chunk.content,
          JSON.stringify(vector), // pgvector expects: '[0.023, -0.018, ...]'
          JSON.stringify({
            // store extra metadata as JSONB
            totalChunks: chunk.totalChunks || embeddedChunks.length,
          }),
        ];

        await client.query(sql, params);
        storedCount++;

        // Call progress callback every 10 inserts (for status polling)
        if (onProgress && storedCount % 10 === 0) {
          onProgress(storedCount, embeddedChunks.length);
        }
      }

      await client.query("COMMIT"); // All inserts succeeded — commit

      sails.log.info(
        `[VectorStoreService] Committed ${storedCount} chunks for doc: ${docId}`,
      );
    } catch (err) {
      await client.query("ROLLBACK"); // Any failure → rollback everything
      sails.log.error(
        `[VectorStoreService] Transaction failed, rolled back: ${err.message}`,
      );
      throw new Error(`Failed to store chunks in pgvector: ${err.message}`);
    } finally {
      client.release(); // Always release client back to pool
    }

    return storedCount;
  },

  // ─────────────────────────────────────────────
  // DELETE DOCUMENT (remove all chunks from pgvector)
  // ─────────────────────────────────────────────

  /**
   * Remove ALL pgvector rows for a given document.
   * Called when admin deletes a document from the knowledge base.
   *
   * @param {string} docId - The document UUID (same in MongoDB and pgvector)
   * @returns {Promise<number>} - Number of chunk rows deleted
   */
  async deleteDocument(docId) {
    sails.log.info(
      `[VectorStoreService] Deleting all chunks for doc: ${docId}`,
    );

    try {
      const deletedCount = await PgService.deleteChunksByDocId(docId);

      sails.log.info(
        `[VectorStoreService] Deleted ${deletedCount} chunks for doc: ${docId}`,
      );
      return deletedCount;
    } catch (err) {
      sails.log.error(
        `[VectorStoreService] Delete failed for doc ${docId}: ${err.message}`,
      );
      throw new Error(`Failed to delete chunks from pgvector: ${err.message}`);
    }
  },

  // ─────────────────────────────────────────────
  // GET CHUNK COUNT (verify indexing)
  // ─────────────────────────────────────────────

  /**
   * Count how many chunks are stored for a document.
   * Used for verification after indexing and in analytics.
   *
   * @param {string} docId - Document UUID
   * @returns {Promise<number>}
   */
  async getChunkCount(docId) {
    return await PgService.countChunks(docId);
  },
};
