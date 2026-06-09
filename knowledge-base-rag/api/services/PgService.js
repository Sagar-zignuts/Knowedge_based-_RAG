require("dotenv").config();
const { Pool } = require("pg");
const {
  host,
  port,
  user,
  database,
  max,
  idleTimeoutMillis,
} = require("pg/lib/defaults");

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  sails.log.error("Unexpected PG pool error:", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),

  async testConnection() {
    const client = await pool.connect();
    try {
      await client.query("SELECT NOW()");
      sails.log.info("PostgreSQL connected successfully.");
    } finally {
      client.release();
    }
  },

  /**
   * Delete all chunks for a specific document
   * @param {string} docId - Document UUID
   * @returns {Promise<number>} - Number of rows deleted
   */
  async deleteChunksByDocId(docId) {
    const sql = `DELETE FROM document_chunks WHERE doc_id = $1`;
    const result = await pool.query(sql, [docId]);
    return result.rowCount || 0;
  },

  /**
   * Count chunks for a specific document
   * @param {string} docId - Document UUID
   * @returns {Promise<number>} - Number of chunks
   */
  async countChunks(docId) {
    const sql = `SELECT COUNT(*) as count FROM document_chunks WHERE doc_id = $1`;
    const result = await pool.query(sql, [docId]);
    return parseInt(result.rows[0].count) || 0;
  },

  /**
   * Perform vector similarity search using pgvector
   * @param {number[]} queryVector - The embedding vector to search for (768 dimensions)
   * @param {number} topK - Number of top results to return (default: 5)
   * @returns {Promise<Array>} - Array of similar chunks with metadata and similarity scores
   */
  async similaritySearch(queryVector, topK = 5) {
    if (!queryVector || !Array.isArray(queryVector)) {
      throw new Error("queryVector must be an array of numbers");
    }

    // Convert JavaScript array to PostgreSQL vector format
    const vectorString = `[${queryVector.join(",")}]`;

    // pgvector cosine distance operator: <=>
    // Lower distance = higher similarity
    // ORDER BY distance ASC gives us the most similar chunks first
    const sql = `
      SELECT 
        id,
        doc_id,
        doc_title,
        doc_type,
        chunk_index,
        page_number,
        content,
        metadata,
        (embedding <=> $1::vector) as similarity
      FROM document_chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;

    try {
      const result = await pool.query(sql, [vectorString, topK]);
      return result.rows;
    } catch (err) {
      sails.log.error(`[PgService] similaritySearch error: ${err.message}`);
      throw err;
    }
  },
};
