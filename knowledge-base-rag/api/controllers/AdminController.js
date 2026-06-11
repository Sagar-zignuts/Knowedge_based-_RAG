/**
 * AdminController.js
 *
 * PURPOSE: Admin-only analytics endpoint. Gives a bird's-eye view of
 * the entire knowledge base — how many docs, chunks, conversations,
 * and how users are rating AI answers.
 *
 * ROUTE: GET /api/admin/analytics
 * POLICY: isAuthenticated + isAdmin
 *
 * Pulls data from BOTH databases:
 *   MongoDB  → documents, sessions, messages, feedback
 *   pgvector → total chunk count
 */

module.exports = {
  /**
   * Get overall system analytics.
   *
   * Returns: {
   *   documents: { total, byStatus, byType },
   *   chunks: { total },
   *   chat: { totalSessions, totalMessages, avgMessagesPerSession },
   *   feedback: { totalRatings, averageRating, distribution },
   *   users: { total, byRole }
   * }
   */
  analytics: async function (req, res) {
    try {
      sails.log.info("[AdminController] Generating analytics...");

      // ── Documents stats (MongoDB) ────────────────────────────────
      const allDocs = await KnowledgeDocument.find();

      const docsByStatus = {
        pending: 0,
        indexing: 0,
        indexed: 0,
        failed: 0,
      };
      const docsByType = {
        pdf: 0,
        text: 0,
        markdown: 0,
        url: 0,
        image: 0,
      };

      allDocs.forEach((doc) => {
        if (docsByStatus[doc.status] !== undefined) docsByStatus[doc.status]++;
        if (docsByType[doc.type] !== undefined) docsByType[doc.type]++;
      });

      // ── Chunks stats (pgvector) ──────────────────────────────────
      const chunkResult = await PgService.query(
        "SELECT COUNT(*) as total FROM document_chunks",
      );
      const totalChunks = parseInt(chunkResult.rows[0].total);

      // Chunks per document type (pgvector)
      const chunksByTypeResult = await PgService.query(`
        SELECT doc_type, COUNT(*) as count
        FROM document_chunks
        GROUP BY doc_type
      `);
      const chunksByType = {};
      chunksByTypeResult.rows.forEach((row) => {
        chunksByType[row.doc_type] = parseInt(row.count);
      });

      // ── Chat stats (MongoDB) ──────────────────────────────────────
      const totalSessions = await ChatSession.count();
      const totalMessages = await ChatMessage.count();
      const userMessages = await ChatMessage.count({ role: "user" });
      const aiMessages = await ChatMessage.count({ role: "assistant" });

      const avgMessagesPerSession =
        totalSessions > 0
          ? parseFloat((totalMessages / totalSessions).toFixed(2))
          : 0;

      // ── Feedback stats (MongoDB) ──────────────────────────────────
      const allFeedback = await Feedback.find();

      const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let ratingSum = 0;

      allFeedback.forEach((f) => {
        if (ratingDistribution[f.rating] !== undefined) {
          ratingDistribution[f.rating]++;
        }
        ratingSum += f.rating;
      });

      const averageRating =
        allFeedback.length > 0
          ? parseFloat((ratingSum / allFeedback.length).toFixed(2))
          : null;

      // ── Users stats (MongoDB) ──────────────────────────────────────
      const totalUsers = await User.count();
      const adminUsers = await User.count({ role: "admin" });
      const regularUsers = await User.count({ role: "user" });

      // ── Most active sessions (top 5 by message count) ──────────────
      const topSessions = await ChatSession.find()
        .sort("messageCount DESC")
        .limit(5)
        .populate("userId");

      // ── Recently uploaded documents (last 5) ───────────────────────
      const recentDocs = await KnowledgeDocument.find()
        .sort("createdAt DESC")
        .limit(5)
        .populate("uploadedBy");

      // ── Build response ───────────────────────────────────────────
      const analytics = {
        documents: {
          total: allDocs.length,
          byStatus: docsByStatus,
          byType: docsByType,
          recent: recentDocs.map((d) => ({
            id: d.id,
            title: d.title,
            type: d.type,
            status: d.status,
            chunkCount: d.chunkCount,
            uploadedBy: d.uploadedBy ? d.uploadedBy.name : "Unknown",
            createdAt: d.createdAt,
          })),
        },
        chunks: {
          total: totalChunks,
          byType: chunksByType,
        },
        chat: {
          totalSessions,
          totalMessages,
          userMessages,
          aiMessages,
          avgMessagesPerSession,
          topSessions: topSessions.map((s) => ({
            sessionId: s.sessionId,
            title: s.title,
            messageCount: s.messageCount,
            user: s.userId ? s.userId.name : "Unknown",
          })),
        },
        feedback: {
          totalRatings: allFeedback.length,
          averageRating,
          distribution: ratingDistribution,
        },
        users: {
          total: totalUsers,
          byRole: {
            admin: adminUsers,
            user: regularUsers,
          },
        },
        generatedAt: new Date().toISOString(),
      };

      sails.log.info("[AdminController] Analytics generated successfully");

      return res.json(analytics);
    } catch (err) {
      sails.log.error("[AdminController] analytics error:", err);
      return res.serverError({ error: err.message });
    }
  },
};
