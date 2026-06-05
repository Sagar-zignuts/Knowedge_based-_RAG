CREATE TABLE document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      VARCHAR(255) NOT NULL,
  doc_title   VARCHAR(500),
  doc_type    VARCHAR(50),
  chunk_index INTEGER NOT NULL,
  page_number INTEGER DEFAULT 1,
  content     TEXT NOT NULL,
  embedding   vector(768),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMP DEFAULT NOW()
);


-- Index 1 — ivfflat (The Similarity Search Index) 
/* To make similarity search efficient and fast */
CREATE INDEX ON document_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Index 2 — B-tree Index on doc_id (The Delete Index)
-- To make delete chunks from db faster
CREATE INDEX ON document_chunks (doc_id);
