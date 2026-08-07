-- Database schema for KnowledgeChat AI
-- Execute this SQL block in your Supabase SQL Editor.

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing tables if they exist to start fresh (optional)
-- DROP TABLE IF EXISTS chat_history;
-- DROP TABLE IF EXISTS document_chunks;
-- DROP TABLE IF EXISTS documents;

-- 1. Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uid TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading', -- 'uploading', 'processing', 'indexed', 'failed'
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for searching documents by user
CREATE INDEX IF NOT EXISTS idx_documents_user_uid ON documents(user_uid);

-- 2. Create document chunks table
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536), -- text-embedding-3-small dimension
  page INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for filtering chunks by user
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_uid ON document_chunks(user_uid);

-- HNSW Index for vector cosine similarity search
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
ON document_chunks 
USING hnsw (embedding vector_cosine_ops);

-- 3. Create chat history table
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uid TEXT NOT NULL,
  message TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user', 'assistant'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fetching chat history by user
CREATE INDEX IF NOT EXISTS idx_chat_history_user_uid ON chat_history(user_uid);

-- 4. Create vector similarity matching function
CREATE OR REPLACE FUNCTION match_document_chunks (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_user_uid text
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  user_uid text,
  chunk_text text,
  similarity float,
  page int,
  metadata jsonb
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.user_uid,
    dc.chunk_text,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    dc.page,
    dc.metadata
  FROM document_chunks dc
  WHERE dc.user_uid = filter_user_uid
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ==========================================
-- PHASE 1: E-COMMERCE CATALOG ADDITIONS
-- ==========================================

-- 5. Create products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE, -- Link catalog items to document for automatic cascade cleanups
  user_uid TEXT NOT NULL, -- User isolation
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  category TEXT,
  color TEXT,
  size TEXT,
  in_stock BOOLEAN DEFAULT TRUE NOT NULL,
  description TEXT,
  image_url TEXT,
  product_url TEXT,
  embedding vector(1536), -- text-embedding-3-small dimension
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for isolating product operations by user
CREATE INDEX IF NOT EXISTS idx_products_user_uid ON products(user_uid);

-- Generated Full-Text Search Vector column for keyword indexing
ALTER TABLE products ADD COLUMN IF NOT EXISTS fts_vector tsvector GENERATED ALWAYS AS (
  to_tsvector('english', 
    coalesce(name, '') || ' ' || 
    coalesce(sku, '') || ' ' || 
    coalesce(description, '') || ' ' || 
    coalesce(category, '')
  )
) STORED;

-- GIN Index for fast full-text text matching
CREATE INDEX IF NOT EXISTS idx_products_fts ON products USING gin(fts_vector);

-- HNSW Vector Index for fast cosine similarity lookups
CREATE INDEX IF NOT EXISTS idx_products_embedding 
ON products 
USING hnsw (embedding vector_cosine_ops);

-- 6. Create product vector similarity matching function
CREATE OR REPLACE FUNCTION match_products (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_user_uid text
)
RETURNS TABLE (
  id uuid,
  sku text,
  name text,
  price numeric(10, 2),
  currency text,
  category text,
  color text,
  size text,
  in_stock boolean,
  description text,
  image_url text,
  product_url text,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.sku,
    p.name,
    p.price,
    p.currency,
    p.category,
    p.color,
    p.size,
    p.in_stock,
    p.description,
    p.image_url,
    p.product_url,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE p.user_uid = filter_user_uid
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

