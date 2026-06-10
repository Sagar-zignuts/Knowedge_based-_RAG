// Polyfill ReadableStream for Node.js compatibility with LangChain
if (typeof global.ReadableStream === "undefined") {
  const { ReadableStream } = require("stream/web");
  global.ReadableStream = ReadableStream;
}

/**
 * ChunkingService.js
 *
 * PURPOSE: Split large extracted text into smaller overlapping chunks.
 * Each chunk is ~800 characters with 150-character overlap so that
 * context is not lost at chunk boundaries.
 *
 * WHY CHUNKING?
 * - Embedding models have token limits → can't embed a whole PDF at once
 * - Smaller chunks = more precise retrieval (find exact relevant section)
 * - Overlap ensures a sentence split across chunk boundary is still findable
 *
 * FLOW: DocumentProcessor → ChunkingService → EmbeddingService
 *
 * Input  → raw text string + document metadata
 * Output → array of chunk objects, each with text + metadata
 */

const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
module.exports = {
  // ─────────────────────────────────────────────
  // MAIN METHOD
  // ─────────────────────────────────────────────

  /**
   * Split document text into overlapping chunks.
   *
   * @param {string} text       - Raw extracted text from DocumentProcessor
   * @param {object} docMeta    - Metadata about the parent document
   *   @param {string} docMeta.docId       - MongoDB document UUID
   *   @param {string} docMeta.docTitle    - Document title
   *   @param {string} docMeta.docType     - 'pdf' | 'text' | 'markdown' | 'url' | 'image'
   *   @param {number} docMeta.pageCount   - Total pages (for PDFs)
   * @param {object} options    - Optional splitter config overrides
   *
   * @returns {Promise<Array<{
   *   content: string,
   *   docId: string,
   *   docTitle: string,
   *   docType: string,
   *   chunkIndex: number,
   *   pageNumber: number,
   *   charStart: number,
   *   charEnd: number
   * }>>}
   */
  async splitIntoChunks(text, docMeta, options = {}) {
    const {
      chunkSize = 800, // characters per chunk
      chunkOverlap = 150, // overlap between consecutive chunks
    } = options;

    if (!text || text.trim().length === 0) {
      throw new Error(
        "Cannot chunk empty text. DocumentProcessor may have failed.",
      );
    }

    sails.log.info(
      `[ChunkingService] Splitting ${text.length} chars for doc: "${docMeta.docTitle}" ` +
        `(chunkSize=${chunkSize}, overlap=${chunkOverlap})`,
    );

    // LangChain's RecursiveCharacterTextSplitter is the best general-purpose
    // splitter — it tries to split on: paragraphs → sentences → words → chars
    // in that order, so chunks stay semantically meaningful.
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: ["\n\n", "\n", ". ", "! ", "? ", " ", ""],
    });

    const langchainDocs = await splitter.createDocuments([text]);

    // Map LangChain Document objects → our chunk format with full metadata
    const chunks = langchainDocs.map((doc, index) => {
      // Estimate page number: divide chunk position by chars-per-page estimate
      // For PDFs this is approximate; exact page numbers come from pdf-parse
      const estimatedPage = this._estimatePageNumber(
        doc.metadata.loc ? doc.metadata.loc.lines.from : 0,
        text,
        docMeta.pageCount || 1,
      );

      return {
        content: doc.pageContent.trim(),
        docId: docMeta.docId,
        docTitle: docMeta.docTitle,
        docType: docMeta.docType,
        chunkIndex: index,
        pageNumber: estimatedPage,
        totalChunks: langchainDocs.length,
      };
    });

    // Filter out chunks that are too short to be useful (< 50 chars)
    const validChunks = chunks.filter((c) => c.content.length >= 50);

    sails.log.info(
      `[ChunkingService] Created ${validChunks.length} valid chunks ` +
        `(filtered ${chunks.length - validChunks.length} too-short chunks)`,
    );

    return validChunks;
  },

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

  /**
   * Estimate which page a chunk belongs to.
   * Based on character position relative to total text length.
   *
   * @param {number} lineNum      - Line number where chunk starts
   * @param {string} fullText     - Full document text
   * @param {number} totalPages   - Total pages in document
   * @returns {number} estimated page number (1-indexed)
   */
  _estimatePageNumber(lineNum, fullText, totalPages) {
    if (totalPages <= 1) return 1;

    const totalLines = (fullText.match(/\n/g) || []).length + 1;
    const ratio = lineNum / Math.max(totalLines, 1);
    const page = Math.max(1, Math.ceil(ratio * totalPages));

    return Math.min(page, totalPages);
  },
};
