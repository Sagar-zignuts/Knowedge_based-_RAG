/**
 * ChatController.js
 *
 * PURPOSE: Handle all HTTP requests for the chat system.
 * This controller is the HTTP layer — it receives requests,
 * calls RagService for AI logic, and returns responses.
 *
 * All routes protected by isAuthenticated policy (config/policies.js).
 *
 * ROUTES (config/routes.js):
 *   POST   /api/chat/session        → createSession()
 *   GET    /api/chat/sessions       → listSessions()
 *   POST   /api/chat/message        → message()      (non-streaming)
 *   GET    /api/chat/stream         → stream()        (SSE streaming)
 *   GET    /api/chat/:sessionId     → history()
 *   DELETE /api/chat/:sessionId     → clearSession()
 *
 * STREAMING EXPLAINED:
 *   Server-Sent Events (SSE) is a one-way stream from server → client.
 *   Frontend uses EventSource API to receive tokens as they arrive.
 *   Each token is sent as: data: {"chunk":"word"}\n\n
 *   When done: data: [DONE]\n\n
 *   On error: data: {"error":"message"}\n\n
 */

const { v4: uuidv4 } = require("uuid");

module.exports = {
  // ─────────────────────────────────────────────────────────────────────
  // CREATE SESSION
  // POST /api/chat/session
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Create a new chat session for the logged-in user.
   * Returns a sessionId that must be passed in all subsequent chat requests.
   *
   * Body: { title? } — optional custom title
   */
  createSession: async function (req, res) {
    try {
      const sessionId = uuidv4(); // Generate unique session ID
      const { title } = req.body;

      const session = await ChatSession.create({
        sessionId,
        userId: req.user.id,
        title: title || "New conversation",
        messageCount: 0,
      }).fetch();

      sails.log.info(
        `[ChatController] Session created: ${sessionId} for user: ${req.user.id}`,
      );

      return res.json({
        message: "Chat session created",
        session,
      });
    } catch (err) {
      sails.log.error("[ChatController] createSession error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  // LIST SESSIONS
  // GET /api/chat/sessions
  // ─────────────────────────────────────────────────────────────────────

  /**
   * List all chat sessions for the currently logged-in user.
   * Sorted by most recent first.
   * Used to show chat history sidebar.
   */
  listSessions: async function (req, res) {
    try {
      const sessions = await ChatSession.find({ userId: req.user.id }).sort(
        "updatedAt DESC",
      );

      return res.json({
        sessions,
        total: sessions.length,
      });
    } catch (err) {
      sails.log.error("[ChatController] listSessions error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  // SEND MESSAGE (non-streaming)
  // POST /api/chat/message
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Send a message and get the complete answer in one response.
   * Good for programmatic use, API clients, Postman testing.
   * For browser UI, use /stream for better UX.
   *
   * Body: { sessionId: string, question: string }
   * Returns: { answer: string, sources: Array, sessionId: string }
   */
  message: async function (req, res) {
    try {
      const { sessionId, question } = req.body;

      // ── Validation ──────────────────────────────────────────────────
      if (!sessionId) {
        return res.badRequest({ error: "sessionId is required" });
      }
      if (!question || question.trim().length === 0) {
        return res.badRequest({
          error: "question is required and cannot be empty",
        });
      }
      if (question.trim().length > 2000) {
        return res.badRequest({
          error: "question is too long (max 2000 characters)",
        });
      }

      // ── Verify session belongs to this user ─────────────────────────
      const session = await ChatSession.findOne({
        sessionId,
        userId: req.user.id,
      });
      if (!session) {
        return res.notFound({
          error: "Session not found or does not belong to you",
        });
      }

      sails.log.info(
        `[ChatController] message() — session: ${sessionId}, user: ${req.user.id}`,
      );

      // ── Run RAG pipeline ────────────────────────────────────────────
      const { answer, sources } = await RagService.chat(
        sessionId,
        question.trim(),
      );

      return res.json({
        sessionId,
        question,
        answer,
        sources,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      sails.log.error("[ChatController] message error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  // STREAM MESSAGE (Server-Sent Events)
  // GET /api/chat/stream?sessionId=xxx&question=yyy
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Stream the AI answer token by token using Server-Sent Events (SSE).
   * The frontend uses EventSource API to receive tokens in real time.
   * This creates the "typing" effect like ChatGPT.
   *
   * Query params: sessionId, question
   *
   * SSE Event format:
   *   data: {"chunk":"Hello"}\n\n       ← each token
   *   data: {"sources":[...]}\n\n       ← sources after answer
   *   data: [DONE]\n\n                  ← signals end of stream
   *   data: {"error":"message"}\n\n     ← if something goes wrong
   */
  stream: async function (req, res) {
    const { sessionId, question } = req.query;

    // ── Validation ────────────────────────────────────────────────────
    if (!sessionId) {
      return res.badRequest({ error: "sessionId query param is required" });
    }
    if (!question || question.trim().length === 0) {
      return res.badRequest({ error: "question query param is required" });
    }

    // ── Verify session belongs to this user ───────────────────────────
    const session = await ChatSession.findOne({
      sessionId,
      userId: req.user.id,
    }).catch(() => null);

    if (!session) {
      return res.notFound({
        error: "Session not found or does not belong to you",
      });
    }

    // ── Set SSE headers ───────────────────────────────────────────────
    // These headers tell the browser this is a streaming response
    res.set({
      "Content-Type": "text/event-stream", // SSE content type
      "Cache-Control": "no-cache", // Never cache SSE
      Connection: "keep-alive", // Keep connection open
      "X-Accel-Buffering": "no", // Disable nginx buffering
      "Access-Control-Allow-Origin": "*", // Allow cross-origin
    });
    res.flushHeaders(); // Send headers immediately — opens the stream

    sails.log.info(`[ChatController] stream() started — session: ${sessionId}`);

    try {
      // ── Stream tokens via SSE ────────────────────────────────────────
      const { sources } = await RagService.chatStream(
        sessionId,
        question.trim(),
        (chunk) => {
          // This callback is called for EACH token as LLM generates it
          // We write it immediately to the SSE stream
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        },
      );

      // ── Send sources after answer is complete ─────────────────────
      res.write(`data: ${JSON.stringify({ sources })}\n\n`);

      // ── Signal end of stream ──────────────────────────────────────
      res.write("data: [DONE]\n\n");

      sails.log.info(
        `[ChatController] stream() completed — session: ${sessionId}`,
      );
    } catch (err) {
      sails.log.error(`[ChatController] stream() error: ${err.message}`);
      // Send error through SSE so frontend knows something went wrong
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    } finally {
      res.end(); // Always close the stream
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  // GET CHAT HISTORY
  // GET /api/chat/:sessionId
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Get all messages for a specific chat session.
   * Used to restore a conversation when user reopens a session.
   *
   * Returns messages sorted oldest first (chronological order).
   * Each message includes sources array for assistant messages.
   */
  history: async function (req, res) {
    try {
      const { sessionId } = req.params;

      // Verify session belongs to this user
      const session = await ChatSession.findOne({
        sessionId,
        userId: req.user.id,
      });
      if (!session) {
        return res.notFound({
          error: "Session not found or does not belong to you",
        });
      }

      // Get all messages sorted chronologically
      const messages = await ChatMessage.find({ sessionId }).sort(
        "createdAt ASC",
      );

      return res.json({
        session,
        messages,
        total: messages.length,
      });
    } catch (err) {
      sails.log.error("[ChatController] history error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  // CLEAR SESSION
  // DELETE /api/chat/:sessionId
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Delete all messages in a session but keep the session record.
   * User can start a fresh conversation in the same session.
   *
   * To fully delete a session, destroy both messages and the session record.
   */
  clearSession: async function (req, res) {
    try {
      const { sessionId } = req.params;

      // Verify session belongs to this user
      const session = await ChatSession.findOne({
        sessionId,
        userId: req.user.id,
      });
      if (!session) {
        return res.notFound({
          error: "Session not found or does not belong to you",
        });
      }

      // Delete all messages for this session
      const deletedRecords = await ChatMessage.destroy({ sessionId }).fetch();

      // Reset session message count and title
      await ChatSession.updateOne({ sessionId }).set({
        messageCount: 0,
        title: "New conversation",
      });

      sails.log.info(
        `[ChatController] Session cleared: ${sessionId}, messages deleted: ${deletedRecords.length}`,
      );

      return res.json({
        message: "Session cleared successfully",
        sessionId,
        messagesDeleted: deletedRecords.length,
      });
    } catch (err) {
      sails.log.error("[ChatController] clearSession error:", err);
      return res.serverError({ error: err.message });
    }
  },
};
