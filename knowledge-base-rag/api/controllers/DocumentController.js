/**
 * DocumentController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 *
 * PURPOSE: Handle all HTTP requests related to document management.
 * All routes here require isAuthenticated + isAdmin policies.
 *
 * ROUTES (defined in config/routes.js):
 *   POST   /api/documents/upload     → upload()   upload + index a file
 *   POST   /api/documents/url        → addUrl()   crawl + index a URL
 *   GET    /api/documents            → list()     list all documents
 *   GET    /api/documents/:id        → find()     get one document
 *   GET    /api/documents/:id/status → status()   check indexing progress
 *   DELETE /api/documents/:id        → destroy()  delete doc + vectors
 *
 * PIPELINE for upload/addUrl:
 *   1. Save file / validate URL
 *   2. Create KnowledgeDocument in MongoDB (status: pending)
 *   3. Run full indexing pipeline ASYNCHRONOUSLY (don't block HTTP response)
 *   4. Return document record immediately so admin gets fast response
 *   5. Admin polls /status to track progress
 */

const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOADS_DIR || "./uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    "application/pdf",
    "text/plain",
    "text/markdown",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
}).single("file"); // form field name must be 'file'

module.exports = {
  // ─────────────────────────────────────────────
  // UPLOAD FILE
  // POST /api/documents/upload
  // ─────────────────────────────────────────────

  upload: function (req, res) {
    // Run multer middleware manually inside Sails action
    upload(req, res, async (multerErr) => {
      if (multerErr) {
        return res.badRequest({ error: multerErr.message });
      }

      if (!req.file) {
        return res.badRequest({
          error: 'No file uploaded. Use field name "file" in multipart form.',
        });
      }

      const { title } = req.body;
      const file = req.file;

      // Detect document type from mimetype
      const typeMap = {
        "application/pdf": "pdf",
        "text/plain": "text",
        "text/markdown": "markdown",
        "image/jpeg": "image",
        "image/png": "image",
        "image/gif": "image",
        "image/webp": "image",
      };
      const docType = typeMap[file.mimetype] || "text";

      try {
        // 1. Create MongoDB document record (status: pending)
        const doc = await KnowledgeDocument.create({
          title: title || file.originalname,
          type: docType,
          status: "pending",
          filePath: file.path,
          uploadedBy: req.user.id,
          metadata: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
          },
        }).fetch();

        // 2. Return IMMEDIATELY so admin doesn't wait for indexing
        res.json({
          message: "File uploaded. Indexing started.",
          document: doc,
        });

        // 3. Run indexing pipeline ASYNCHRONOUSLY (non-blocking)
        DocumentController._runIndexingPipeline(
          doc.id,
          docType,
          file.path,
        ).catch((err) => {
          sails.log.error(
            `[DocumentController] Async indexing failed for doc ${doc.id}: ${err.message}`,
          );
        });
      } catch (err) {
        sails.log.error("[DocumentController] upload error:", err);
        // Clean up uploaded file if DB create failed
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.serverError({ error: err.message });
      }
    });
  },

  // ─────────────────────────────────────────────
  // ADD URL
  // POST /api/documents/url
  // ─────────────────────────────────────────────

  addUrl: async function (req, res) {
    try {
      const { url, title } = req.body;

      if (!url) {
        return res.badRequest({ error: "url is required in request body" });
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return res.badRequest({
          error: "Invalid URL format. Must start with http:// or https://",
        });
      }

      // 1. Create MongoDB document record
      const doc = await KnowledgeDocument.create({
        title: title || url,
        type: "url",
        status: "pending",
        sourceUrl: url,
        uploadedBy: req.user.id,
        metadata: { sourceUrl: url },
      }).fetch();

      // 2. Return immediately
      res.json({
        message: "URL added. Indexing started.",
        document: doc,
      });

      // 3. Run indexing asynchronously using URL as the "filePath"
      DocumentController._runIndexingPipeline(doc.id, "url", url).catch(
        (err) => {
          sails.log.error(
            `[DocumentController] Async URL indexing failed for doc ${doc.id}: ${err.message}`,
          );
        },
      );
    } catch (err) {
      sails.log.error("[DocumentController] addUrl error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────
  // LIST ALL DOCUMENTS
  // GET /api/documents?page=1&limit=20
  // ─────────────────────────────────────────────

  list: async function (req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const docs = await KnowledgeDocument.find()
        .populate("uploadedBy")
        .sort("createdAt DESC")
        .skip(skip)
        .limit(limit);

      const total = await KnowledgeDocument.count();

      return res.json({
        documents: docs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      sails.log.error("[DocumentController] list error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────
  // GET ONE DOCUMENT
  // GET /api/documents/:id
  // ─────────────────────────────────────────────

  find: async function (req, res) {
    try {
      const doc = await KnowledgeDocument.findOne({
        id: req.params.id,
      }).populate("uploadedBy");

      if (!doc) {
        return res.notFound({ error: `Document not found: ${req.params.id}` });
      }

      return res.json({ document: doc });
    } catch (err) {
      sails.log.error("[DocumentController] find error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────
  // GET INDEXING STATUS (for polling)
  // GET /api/documents/:id/status
  // ─────────────────────────────────────────────

  status: async function (req, res) {
    try {
      const doc = await KnowledgeDocument.findOne({ id: req.params.id });

      if (!doc) {
        return res.notFound({ error: `Document not found: ${req.params.id}` });
      }

      return res.json({
        id: doc.id,
        status: doc.status,
        chunkCount: doc.chunkCount,
        errorMsg: doc.errorMsg || null,
      });
    } catch (err) {
      sails.log.error("[DocumentController] status error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────
  // DELETE DOCUMENT
  // DELETE /api/documents/:id
  // ─────────────────────────────────────────────

  destroy: async function (req, res) {
    try {
      const doc = await KnowledgeDocument.findOne({ id: req.params.id });

      if (!doc) {
        return res.notFound({ error: `Document not found: ${req.params.id}` });
      }

      // 1. Delete all vector chunks from pgvector (using UUID bridge)
      const deletedChunks = await VectorStoreService.deleteDocument(doc.id);

      // 2. Delete the physical file from disk (if it exists)
      if (doc.filePath && fs.existsSync(doc.filePath)) {
        fs.unlinkSync(doc.filePath);
        sails.log.info(`[DocumentController] Deleted file: ${doc.filePath}`);
      }

      // 3. Delete MongoDB record
      await KnowledgeDocument.destroyOne({ id: doc.id });

      sails.log.info(
        `[DocumentController] Document ${doc.id} fully deleted. Chunks removed: ${deletedChunks}`,
      );

      return res.json({
        message: `Document "${doc.title}" deleted successfully`,
        chunksDeleted: deletedChunks,
      });
    } catch (err) {
      sails.log.error("[DocumentController] destroy error:", err);
      return res.serverError({ error: err.message });
    }
  },

  // ─────────────────────────────────────────────
  // PRIVATE: FULL INDEXING PIPELINE
  // Called asynchronously from upload() and addUrl()
  // ─────────────────────────────────────────────

  /**
   * Run the complete document indexing pipeline:
   * Extract → Chunk → Embed → Store → Update status
   *
   * This is called without await so it runs in the background.
   * Status updates are written to MongoDB so admin can poll /status.
   *
   * @param {string} docId    - MongoDB document UUID
   * @param {string} docType  - 'pdf' | 'text' | 'markdown' | 'image' | 'url'
   * @param {string} filePath - File path or URL string
   */
  async _runIndexingPipeline(docId, docType, filePath) {
    sails.log.info(
      `[DocumentController] Starting indexing pipeline for doc: ${docId}`,
    );

    try {
      // ── Step 1: Get document metadata from MongoDB ──────────────────────
      const doc = await KnowledgeDocument.findOne({ id: docId });
      if (!doc) throw new Error(`Document ${docId} not found in MongoDB`);

      // ── Step 2: Update status → indexing ────────────────────────────────
      await KnowledgeDocument.updateOne({ id: docId }).set({
        status: "indexing",
      });

      // ── Step 3: Extract text ─────────────────────────────────────────────
      sails.log.info(`[DocumentController] Step 3: Extracting text...`);
      const { text, pageCount, metadata } = await DocumentProcessor.extractText(
        docType,
        filePath,
      );

      // ── Step 4: Split into chunks ────────────────────────────────────────
      sails.log.info(
        `[DocumentController] Step 4: Chunking text (${text.length} chars)...`,
      );
      const chunks = await ChunkingService.splitIntoChunks(text, {
        docId: doc.id,
        docTitle: doc.title,
        docType: doc.type,
        pageCount: pageCount || 1,
      });

      sails.log.info(
        `[DocumentController] Step 4 done: ${chunks.length} chunks created`,
      );

      // ── Step 5: Generate embeddings ──────────────────────────────────────
      sails.log.info(`[DocumentController] Step 5: Generating embeddings...`);
      const embeddedChunks = await EmbeddingService.embedChunks(chunks);

      // ── Step 6: Store in pgvector ────────────────────────────────────────
      sails.log.info(`[DocumentController] Step 6: Storing in pgvector...`);
      const storedCount = await VectorStoreService.indexDocument(
        doc.id,
        embeddedChunks,
        // Progress callback — update MongoDB chunkCount every 10 inserts
        async (stored, total) => {
          await KnowledgeDocument.updateOne({ id: docId }).set({
            chunkCount: stored,
          });
        },
      );

      // ── Step 7: Mark as indexed ──────────────────────────────────────────
      await KnowledgeDocument.updateOne({ id: docId }).set({
        status: "indexed",
        chunkCount: storedCount,
        metadata: { ...doc.metadata, ...metadata, pageCount },
      });

      sails.log.info(
        `[DocumentController] Indexing complete for "${doc.title}". ` +
          `Chunks: ${storedCount}, Pages: ${pageCount}`,
      );
    } catch (err) {
      // If anything fails, mark document as failed with error message
      sails.log.error(
        `[DocumentController] Indexing pipeline failed for doc ${docId}: ${err.message}`,
      );

      await KnowledgeDocument.updateOne({ id: docId })
        .set({
          status: "failed",
          errorMsg: err.message,
        })
        .catch(() => {}); // Don't throw if this update also fails
    }
  },
};
