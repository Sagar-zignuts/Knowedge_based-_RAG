/**
 * config/bootstrap.js
 *
 * PURPOSE: Runs automatically every time "sails lift" starts the server.
 * Tests both database connections before accepting any requests.
 * If either DB is unreachable — server fails fast with a clear error
 * instead of silently serving broken requests.
 *
 * Also confirms Ollama is reachable so we know AI features will work.
 */

require("dotenv").config();
const axios = require("axios");

module.exports.bootstrap = async function () {
  sails.log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  sails.log.info("  KnowledgeBase AI — Starting up");
  sails.log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // ── 1. Test MongoDB connection ──────────────────────────────────────
  try {
    await User.count(); // Simple query to verify MongoDB is responding
    sails.log.info("  ✅ MongoDB connected successfully");
  } catch (err) {
    sails.log.error("  ❌ MongoDB connection failed:", err.message);
    sails.log.error(
      "  → Check MONGODB_URL in .env and ensure MongoDB is running",
    );
    throw err; // Stop server from starting
  }

  // ── 2. Test PostgreSQL + pgvector connection ────────────────────────
  try {
    await PgService.testConnection();
    sails.log.info("  ✅ PostgreSQL (pgvector) connected successfully");
  } catch (err) {
    sails.log.error("  ❌ PostgreSQL connection failed:", err.message);
    sails.log.error(
      "  → Check POSTGRES_* vars in .env and ensure PostgreSQL is running",
    );
    throw err;
  }

  // ── 3. Verify pgvector extension is enabled ─────────────────────────
  try {
    const result = await PgService.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    if (result.rows.length === 0) {
      throw new Error(
        "pgvector extension not enabled. Run: CREATE EXTENSION vector;",
      );
    }
    sails.log.info("  ✅ pgvector extension active");
  } catch (err) {
    sails.log.error("  ❌ pgvector check failed:", err.message);
    throw err;
  }

  // ── 4. Check Ollama is running (non-fatal warning) ──────────────────
  try {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    await axios.get(`${ollamaUrl}/api/tags`, { timeout: 3000 });
    sails.log.info("  ✅ Ollama is running and reachable");
  } catch (err) {
    // Warning only — don't stop server if Ollama is not running
    // It might be started later, and other endpoints still work
    sails.log.warn("  ⚠️  Ollama not reachable. AI features will not work.");
    sails.log.warn('  → Run "ollama serve" in a separate terminal');
  }

  sails.log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  sails.log.info("  All checks passed. Server is ready.");
  sails.log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
};
