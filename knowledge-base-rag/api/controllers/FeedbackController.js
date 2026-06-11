/**
 * FeedbackController.js
 *
 * PURPOSE: Let users rate AI answers (1-5 stars) with optional comments.
 * Used to measure answer quality and identify weak spots in the
 * knowledge base (e.g. low ratings on questions about a specific doc
 * might mean that document needs better content or re-indexing).
 *
 * ROUTES:
 *   POST /api/feedback        → create()  submit a rating
 *   GET  /api/feedback/:msgId → forMessage()  get feedback for a message
 *
 * POLICY: isAuthenticated (any logged-in user)
 */

const { v4: uuidv4, validate: isUuid } = require("uuid");

module.exports = {
  // ─────────────────────────────────────────────────────────────────
  // CREATE FEEDBACK
  // POST /api/feedback
  // ─────────────────────────────────────────────────────────────────

  /**
   * Submit a rating for an AI message.
   *
   * Body: { messageId: string, rating: 1-5, comment?: string }
   * Returns: { feedback: {...} }
   */
  create: async function (req, res) {
    try {
      const { messageId, rating, comment } = req.body;

      // ── Validation ────────────────────────────────────────────────
      if (!messageId) {
        return res.badRequest({ error: "messageId is required" });
      }

      if (rating === undefined || rating === null) {
        return res.badRequest({ error: "rating is required" });
      }

      const ratingNum = parseInt(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.badRequest({
          error: "rating must be an integer between 1 and 5",
        });
      }

      if (comment && comment.length > 1000) {
        return res.badRequest({
          error: "comment is too long (max 1000 characters)",
        });
      }

      // ── Verify the message exists ────────────────────────────────
      const message = await ChatMessage.findOne({ id: messageId });
      if (!message) {
        return res.notFound({ error: `Message not found: ${messageId}` });
      }

      // Only allow feedback on assistant messages (not user's own messages)
      if (message.role !== "assistant") {
        return res.badRequest({
          error:
            "Feedback can only be given on AI responses, not user messages",
        });
      }

      // ── Check if user already rated this message ────────────────
      // If yes — UPDATE existing feedback instead of creating duplicate
      const existing = await Feedback.findOne({
        messageId,
        userId: req.user.id,
      });

      let feedback;
      if (existing) {
        feedback = await Feedback.updateOne({ id: existing.id }).set({
          rating: ratingNum,
          comment: comment || existing.comment,
        });
        sails.log.info(
          `[FeedbackController] Updated feedback ${existing.id} for message ${messageId}`,
        );
      } else {
        feedback = await Feedback.create({
          messageId,
          userId: req.user.id,
          rating: ratingNum,
          comment: comment || "",
        }).fetch();
        sails.log.info(
          `[FeedbackController] Created feedback for message ${messageId}: ${ratingNum} stars`,
        );
      }

      return res.json({
        message: existing ? "Feedback updated" : "Feedback submitted",
        feedback,
      });
    } catch (err) {
      sails.log.error("[FeedbackController] create error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────────────────────────
  // GET FEEDBACK FOR A MESSAGE
  // GET /api/feedback/:messageId
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get all feedback for a specific message.
   * Useful to show "4.5 stars (12 ratings)" on an answer.
   */
  forMessage: async function (req, res) {
    try {
      const { messageId } = req.params;

      const feedbackList = await Feedback.find({ messageId });

      const avgRating =
        feedbackList.length > 0
          ? feedbackList.reduce((sum, f) => sum + f.rating, 0) /
            feedbackList.length
          : null;

      return res.json({
        messageId,
        feedback: feedbackList,
        totalRatings: feedbackList.length,
        averageRating: avgRating ? parseFloat(avgRating.toFixed(2)) : null,
      });
    } catch (err) {
      sails.log.error("[FeedbackController] forMessage error:", err);
      return res.serverError({ error: err.message });
    }
  },
};
