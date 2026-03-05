/**
 * Embeddings & Chunking Service for RAG
 *
 * Handles section-aware chunking, OpenAI embedding generation,
 * hybrid search via Supabase RPC, and backfill of existing entries.
 */

import OpenAI from 'openai';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { cleanText } from './documentProcessor.js';
import { getRetrievalSettings } from './retrievalSettings.js';

// ── Types ──────────────────────────────────────────

export interface ChunkMetadata {
  sourceEntryTitle: string;
  sourceFileName: string | null;
  sourceType: string;
  contentType?: string;
  sectionHeading: string | null;
  sectionHierarchy: string[];
  pageNumbers: number[];
  chunkIndex: number;
  totalChunks: number;
}

export interface DocumentChunk {
  content: string;
  metadata: ChunkMetadata;
}

export interface SearchResult {
  id: string;
  entryId: string;
  knowledgeBaseId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  vectorRank: number;
  ftsRank: number;
  rrfScore: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface SearchOptions {
  knowledgeBaseIds?: string[];
  matchCount?: number;
  retrievalMethod?: 'vector' | 'fts' | 'hybrid';
  vectorWeight?: number;
  ftsWeight?: number;
}

// ── Constants ──────────────────────────────────────
// Chunking & search thresholds are now configurable via super admin panel.
// Defaults defined in retrievalSettings.ts, loaded at runtime from DB.
// Only non-configurable constants remain here.

const EMBEDDING_MODEL = 'text-embedding-3-small' as const;
const EMBEDDING_BATCH_SIZE = 20;   // keep batches small to stay within token limits

// Semantic chunking
const SEMANTIC_MIN_SENTENCES = 8;        // minimum sentences to trigger semantic splitting
const SENTENCE_BUFFER_SIZE = 1;          // neighbors on each side (window of 3)
const BREAKPOINT_PERCENTILE = 95;        // split at 95th percentile of cosine distances
const MIN_DISTANCE_THRESHOLD = 0.15;     // absolute floor — skip breakpoints below this

// ── OpenAI Client ──────────────────────────────────

const openai = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;

export function isEmbeddingsAvailable(): boolean {
  return openai !== null;
}

// ── Section Parsing ────────────────────────────────

interface AnnotatedSection {
  text: string;
  heading: string | null;
  headingHierarchy: string[];
}

/** Parse markdown into annotated sections based on headings */
function parseMarkdownSections(markdown: string): AnnotatedSection[] {
  const lines = markdown.split('\n');
  const sections: AnnotatedSection[] = [];

  let currentHeadingStack: { level: number; text: string }[] = [];
  let currentText: string[] = [];

  const flushSection = () => {
    const text = currentText.join('\n').trim();
    if (text) {
      sections.push({
        text,
        heading: currentHeadingStack.length > 0
          ? currentHeadingStack[currentHeadingStack.length - 1].text
          : null,
        headingHierarchy: currentHeadingStack.map((h) => h.text),
      });
    }
    currentText = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      flushSection();

      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      // Pop headings of same or deeper level
      while (
        currentHeadingStack.length > 0 &&
        currentHeadingStack[currentHeadingStack.length - 1].level >= level
      ) {
        currentHeadingStack.pop();
      }
      currentHeadingStack.push({ level, text: headingText });
    } else {
      currentText.push(line);
    }
  }

  flushSection();

  // If no sections were created (no headings in text), treat entire text as one section
  if (sections.length === 0 && markdown.trim()) {
    sections.push({
      text: markdown.trim(),
      heading: null,
      headingHierarchy: [],
    });
  }

  return sections;
}

// ── Semantic Chunking Utilities ───────────────────

/** Common abbreviations that shouldn't trigger sentence splits */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd',
  'inc', 'ltd', 'co', 'corp', 'dept', 'est', 'govt', 'approx',
  'vs', 'etc', 'fig', 'vol', 'no', 'op', 'ed', 'rev', 'gen',
  'e.g', 'i.e', 'a.m', 'p.m',
]);

/**
 * Split text into sentences with abbreviation handling.
 * More robust than naive `.!?` splitting — avoids breaking on
 * "Dr. Smith", "e.g. example", numbered lists, etc.
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  // Match sentence-ending punctuation followed by whitespace and an uppercase letter or end
  const parts = text.split(/(?<=[.!?])\s+/);

  let buffer = '';
  for (const part of parts) {
    buffer += (buffer ? ' ' : '') + part;

    // Check if this ends with an abbreviation (not a real sentence end)
    const lastWord = buffer.match(/(\S+)\s*$/)?.[1]?.replace(/[.!?]+$/, '').toLowerCase();
    if (lastWord && ABBREVIATIONS.has(lastWord)) {
      continue; // Keep accumulating — this is an abbreviation, not end of sentence
    }

    // Check if it ends with a single capital letter followed by period (initial, like "J.")
    if (/\b[A-Z]\.\s*$/.test(buffer)) {
      continue;
    }

    // Check if it ends with a number followed by period (could be a list: "1. 2. 3.")
    if (/\b\d+\.\s*$/.test(buffer)) {
      continue;
    }

    if (buffer.trim()) {
      sentences.push(buffer.trim());
      buffer = '';
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    sentences.push(buffer.trim());
  }

  return sentences;
}

/** Cosine similarity between two vectors (OpenAI embeddings are unit-norm, so dot product suffices) */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Create buffered sentence windows for more stable embeddings.
 * Each sentence N becomes the concatenation of sentences [N-buffer, ..., N, ..., N+buffer].
 */
function bufferSentences(sentences: string[], bufferSize: number): string[] {
  return sentences.map((_, i) => {
    const start = Math.max(0, i - bufferSize);
    const end = Math.min(sentences.length - 1, i + bufferSize);
    return sentences.slice(start, end + 1).join(' ');
  });
}

/** Calculate the value at a given percentile from an array of numbers */
function percentile(values: number[], pct: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (pct / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Semantic chunking: split text by detecting topic shifts via embedding similarity.
 *
 * Returns null if the text has too few sentences for reliable semantic splitting
 * (caller should fall back to size-based splitting).
 */
async function semanticSplitSection(text: string, maxChunkSize = 3000, minChunkSize = 100): Promise<string[] | null> {
  const sentences = splitIntoSentences(text);

  // Too few sentences — percentile computation would be noisy
  if (sentences.length < SEMANTIC_MIN_SENTENCES) {
    return null;
  }

  // Create buffered sentence windows for embedding
  const buffered = bufferSentences(sentences, SENTENCE_BUFFER_SIZE);

  // Embed all buffered sentences in one batch
  const embeddings = await generateEmbeddings(buffered);

  // Compute cosine distance between consecutive sentence embeddings
  const distances: number[] = [];
  for (let i = 0; i < embeddings.length - 1; i++) {
    distances.push(1 - cosineSimilarity(embeddings[i], embeddings[i + 1]));
  }

  // Find breakpoint threshold: 95th percentile of distances AND above absolute floor
  const threshold = Math.max(
    percentile(distances, BREAKPOINT_PERCENTILE),
    MIN_DISTANCE_THRESHOLD,
  );

  // Identify breakpoints — positions where distance exceeds threshold
  const breakpoints = new Set<number>();
  for (let i = 0; i < distances.length; i++) {
    if (distances[i] >= threshold) {
      breakpoints.add(i + 1); // break AFTER sentence i (before sentence i+1)
    }
  }

  // Group sentences between breakpoints into chunks
  const rawChunks: string[] = [];
  let currentGroup: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    currentGroup.push(sentences[i]);
    if (breakpoints.has(i + 1) || i === sentences.length - 1) {
      const chunk = currentGroup.join(' ').trim();
      if (chunk) rawChunks.push(chunk);
      currentGroup = [];
    }
  }

  // Post-process: merge tiny chunks with their nearest neighbor
  const merged: string[] = [];
  for (const chunk of rawChunks) {
    if (chunk.length < minChunkSize && merged.length > 0) {
      merged[merged.length - 1] += ' ' + chunk;
    } else {
      merged.push(chunk);
    }
  }

  // Post-process: split oversized chunks using size-based fallback
  const final: string[] = [];
  for (const chunk of merged) {
    if (chunk.length > maxChunkSize) {
      final.push(...sizeSplitSection(chunk));
    } else {
      final.push(chunk);
    }
  }

  return final;
}

// ── Size-Based Chunking (Fallback) ────────────────

/**
 * Merge small splits into chunks that respect maxSize,
 * with overlap between consecutive chunks.
 */
function mergeSplits(
  splits: string[],
  maxSize: number,
  overlap: number,
  minSize: number,
): string[] {
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const split of splits) {
    const splitText = split.trim();
    if (!splitText) continue;

    if (currentLength + splitText.length > maxSize && currentChunk.length > 0) {
      const chunkText = currentChunk.join('\n\n').trim();
      if (chunkText.length >= minSize) {
        chunks.push(chunkText);
      }

      // Keep trailing elements that fit within overlap size
      const overlapChunks: string[] = [];
      let overlapLength = 0;
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        if (overlapLength + currentChunk[i].length > overlap) break;
        overlapChunks.unshift(currentChunk[i]);
        overlapLength += currentChunk[i].length;
      }

      currentChunk = overlapChunks;
      currentLength = overlapLength;
    }

    currentChunk.push(splitText);
    currentLength += splitText.length;
  }

  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join('\n\n').trim();
    if (chunkText.length >= minSize) {
      chunks.push(chunkText);
    }
  }

  return chunks;
}

/** Split a section into chunks respecting paragraph and sentence boundaries (size-based fallback) */
function sizeSplitSection(text: string, maxSize = 2000, overlap = 200, minSize = 100): string[] {
  if (text.length <= maxSize) {
    return text.trim().length >= minSize ? [text.trim()] : [];
  }

  // Try splitting by paragraphs first
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length > 1) {
    return mergeSplits(paragraphs, maxSize, overlap, minSize);
  }

  // If single paragraph is too large, split by sentences
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  if (sentences.length > 1) {
    return mergeSplits(sentences, maxSize, overlap, minSize);
  }

  // Last resort: split by words
  const words = text.split(/\s+/);
  return mergeSplits(words, maxSize, overlap, minSize);
}

/** Build contextual prefix for chunks: "From: Title | Section: Heading > Subheading" */
function buildChunkPrefix(entryTitle: string, headingHierarchy: string[]): string {
  let prefix = `From: ${entryTitle}`;
  if (headingHierarchy.length > 0) {
    prefix += ` | Section: ${headingHierarchy.join(' > ')}`;
  }
  return prefix + '\n\n';
}

/**
 * Section-aware document chunking with semantic splitting.
 *
 * Strategy:
 * 1. Parse document by headings (explicit structural signals)
 * 2. Within each section, use semantic splitting to detect topic shifts
 * 3. Fall back to size-based splitting for short sections or if embedding fails
 * 4. Prepend heading context to each chunk for better retrieval
 */
export async function chunkDocument(
  structuredText: string,
  documentMeta: {
    entryTitle: string;
    fileName: string | null;
    sourceType: string;
    contentType?: string;
    strategy?: string;
  },
): Promise<DocumentChunk[]> {
  const settings = await getRetrievalSettings();
  const strategy = documentMeta.strategy;

  // For structured/tabular data: the processors already produce pre-chunked text
  // separated by "---". Skip semantic splitting, just validate sizes.
  if (strategy === 'structured_data' || strategy === 'tabular_pipeline') {
    return chunkPreStructured(structuredText, documentMeta, settings.maxChunkSize, settings.minChunkSize, settings.chunkTargetSize, settings.chunkOverlap);
  }

  // For code: skip semantic splitting, use size-based only as safety net
  if (strategy === 'code_pipeline') {
    return chunkPreStructured(structuredText, documentMeta, settings.maxChunkSize, settings.minChunkSize, settings.chunkTargetSize, settings.chunkOverlap);
  }

  // For prose, markdown, html, and default: use section-aware semantic chunking
  const sections = parseMarkdownSections(structuredText);
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    let sectionChunks: string[];

    // If section fits in one chunk, keep it whole
    if (section.text.trim().length <= settings.maxChunkSize && section.text.trim().length >= settings.minChunkSize) {
      sectionChunks = [section.text.trim()];
    } else if (section.text.trim().length < settings.minChunkSize) {
      sectionChunks = [];
    } else {
      // Try semantic splitting first (returns null if too few sentences)
      try {
        const semanticResult = openai ? await semanticSplitSection(section.text, settings.maxChunkSize, settings.minChunkSize) : null;
        sectionChunks = semanticResult ?? sizeSplitSection(section.text, settings.chunkTargetSize, settings.chunkOverlap, settings.minChunkSize);
      } catch {
        // Embedding API failure — fall back to size-based
        sectionChunks = sizeSplitSection(section.text, settings.chunkTargetSize, settings.chunkOverlap, settings.minChunkSize);
      }
    }

    // Safety net: split any oversized chunks that slipped through
    const safeSectionChunks: string[] = [];
    for (const c of sectionChunks) {
      if (c.length > settings.maxChunkSize) {
        safeSectionChunks.push(...sizeSplitSection(c, settings.chunkTargetSize, settings.chunkOverlap, settings.minChunkSize));
      } else {
        safeSectionChunks.push(c);
      }
    }

    for (const chunkText of safeSectionChunks) {
      const prefix = buildChunkPrefix(documentMeta.entryTitle, section.headingHierarchy);

      chunks.push({
        content: prefix + chunkText,
        metadata: {
          sourceEntryTitle: documentMeta.entryTitle,
          sourceFileName: documentMeta.fileName,
          sourceType: documentMeta.sourceType,
          contentType: documentMeta.contentType,
          sectionHeading: section.heading,
          sectionHierarchy: section.headingHierarchy,
          pageNumbers: [],
          chunkIndex,
          totalChunks: 0, // filled in after all chunks created
        },
      });
      chunkIndex++;
    }
  }

  // Fill in totalChunks
  for (const chunk of chunks) {
    chunk.metadata.totalChunks = chunks.length;
  }

  return chunks;
}

/** Chunk pre-structured text (structured data, tabular, code).
 *  These processors output text with "---" separators between logical chunks. */
function chunkPreStructured(
  structuredText: string,
  documentMeta: { entryTitle: string; fileName: string | null; sourceType: string; contentType?: string },
  maxChunkSize = 3000,
  minChunkSize = 100,
  chunkTargetSize = 2000,
  chunkOverlap = 200,
): DocumentChunk[] {
  // Split by "---" separators (used by CSV/JSON/XLSX processors)
  let rawChunks = structuredText.split(/\n---\n/).map((c) => c.trim()).filter((c) => c.length >= minChunkSize);

  // If no separators found, fall back to section-based or size-based splitting
  if (rawChunks.length === 0 && structuredText.trim().length >= minChunkSize) {
    rawChunks = [structuredText.trim()];
  }

  // Safety net: split oversized chunks
  const safeChunks: string[] = [];
  for (const c of rawChunks) {
    if (c.length > maxChunkSize) {
      safeChunks.push(...sizeSplitSection(c, chunkTargetSize, chunkOverlap, minChunkSize));
    } else {
      safeChunks.push(c);
    }
  }

  const prefix = buildChunkPrefix(documentMeta.entryTitle, []);

  return safeChunks.map((content, i) => ({
    content: prefix + content,
    metadata: {
      sourceEntryTitle: documentMeta.entryTitle,
      sourceFileName: documentMeta.fileName,
      sourceType: documentMeta.sourceType,
      contentType: documentMeta.contentType,
      sectionHeading: null,
      sectionHierarchy: [],
      pageNumbers: [],
      chunkIndex: i,
      totalChunks: safeChunks.length,
    },
  }));
}

// ── Embedding Generation ───────────────────────────

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!openai) throw new Error('OpenAI client not initialized (missing OPENAI_API_KEY)');

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!openai) throw new Error('OpenAI client not initialized (missing OPENAI_API_KEY)');
  if (texts.length === 0) return [];

  const allEmbeddings: number[][] = [];

  // Truncate any text exceeding ~30K chars (~8K tokens) to stay within model limits
  const safeTexts = texts.map((t) => t.length > 30000 ? t.slice(0, 30000) : t);

  // Batch by estimated token count (~4 chars per token, stay under 8K tokens per request)
  const MAX_BATCH_TOKENS = 7500;
  let batch: string[] = [];
  let batchTokens = 0;

  for (let i = 0; i < safeTexts.length; i++) {
    const estimatedTokens = Math.ceil(safeTexts[i].length / 4);

    // If single text exceeds limit, send it alone (will be truncated by API or succeed)
    if (batch.length > 0 && batchTokens + estimatedTokens > MAX_BATCH_TOKENS) {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
      });
      const sorted = response.data.sort((a, b) => a.index - b.index);
      allEmbeddings.push(...sorted.map((d) => d.embedding));
      batch = [];
      batchTokens = 0;
    }

    batch.push(safeTexts[i]);
    batchTokens += estimatedTokens;
  }

  // Flush remaining batch
  if (batch.length > 0) {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    const sorted = response.data.sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sorted.map((d) => d.embedding));
  }

  return allEmbeddings;
}

// ── Main Processing Pipeline ───────────────────────

/**
 * Full pipeline: chunk → embed → store in kb_chunks → update entry status.
 *
 * IMPORTANT: This function catches all errors and does NOT rethrow.
 * Entry creation should never fail because embedding failed.
 * The entry is saved with content for fallback; embedding can be retried via backfill.
 */
export async function processAndEmbedEntry(
  entryId: string,
  structuredText: string,
  knowledgeBaseId: string,
  companyId: string,
  entryTitle: string,
  fileName?: string | null,
  sourceType?: string,
  contentType?: string,
  strategy?: string,
): Promise<void> {
  if (!openai) {
    console.warn('Embeddings skipped: OPENAI_API_KEY not configured');
    return;
  }

  try {
    // Mark entry as processing
    await supabaseAdmin
      .from('knowledge_base_entries')
      .update({ embedding_status: 'processing' })
      .eq('id', entryId);

    // 1. Delete old chunks (for re-processing)
    await supabaseAdmin
      .from('kb_chunks')
      .delete()
      .eq('entry_id', entryId);

    // 2. Chunk the text (content-aware: semantic for prose, pre-structured for tabular/code)
    const chunks = await chunkDocument(structuredText, {
      entryTitle,
      fileName: fileName ?? null,
      sourceType: sourceType ?? 'text',
      contentType,
      strategy,
    });

    if (chunks.length === 0) {
      await supabaseAdmin
        .from('knowledge_base_entries')
        .update({ embedding_status: 'completed' })
        .eq('id', entryId);
      return;
    }

    // 3. Generate embeddings for all chunks
    const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

    // 4. Insert chunks with embeddings
    const rows = chunks.map((chunk, i) => ({
      entry_id: entryId,
      knowledge_base_id: knowledgeBaseId,
      company_id: companyId,
      chunk_index: chunk.metadata.chunkIndex,
      content: chunk.content,
      embedding: JSON.stringify(embeddings[i]),
      metadata: chunk.metadata,
    }));

    const { error } = await supabaseAdmin
      .from('kb_chunks')
      .insert(rows);

    if (error) throw error;

    // 5. Mark entry as completed
    await supabaseAdmin
      .from('knowledge_base_entries')
      .update({ embedding_status: 'completed' })
      .eq('id', entryId);
  } catch (error) {
    console.error(`Failed to process entry ${entryId}:`, error);

    await supabaseAdmin
      .from('knowledge_base_entries')
      .update({ embedding_status: 'failed' })
      .eq('id', entryId);

    // Do NOT rethrow — caller should not fail if embedding fails
  }
}

// ── Adaptive Search ───────────────────────────────

export async function searchKnowledgeBase(
  companyId: string,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const settings = await getRetrievalSettings();
  const method = options?.retrievalMethod ?? 'hybrid';
  const matchCount = options?.matchCount ?? settings.matchCount;
  const kbIds = options?.knowledgeBaseIds ?? null;

  try {
    // FTS-only when method dictates or embeddings unavailable
    if (method === 'fts' || !openai) {
      return await ftsOnlySearch(companyId, query, kbIds, matchCount, settings.ftsThreshold);
    }

    const queryEmbedding = await generateEmbedding(query);

    // Vector-only
    if (method === 'vector') {
      return await vectorOnlySearch(companyId, queryEmbedding, kbIds, matchCount, settings.similarityThreshold);
    }

    // Hybrid with configurable weights
    const { data, error } = await supabaseAdmin.rpc('hybrid_search', {
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_query_text: query,
      p_company_id: companyId,
      p_knowledge_base_ids: kbIds,
      p_match_count: matchCount,
      p_vector_weight: options?.vectorWeight ?? 1.0,
      p_fts_weight: options?.ftsWeight ?? 1.0,
    });

    if (error) throw error;

    return (data || [])
      .map((row: Record<string, unknown>) => ({
        id: row.id as string,
        entryId: row.entry_id as string,
        knowledgeBaseId: row.knowledge_base_id as string,
        chunkIndex: row.chunk_index as number,
        content: row.content as string,
        metadata: (row.metadata as Record<string, unknown>) || {},
        vectorRank: row.vector_rank as number,
        ftsRank: row.fts_rank as number,
        rrfScore: row.rrf_score as number,
        confidence: scoreToConfidence(row.rrf_score as number, 'hybrid'),
      }))
      .filter((r: SearchResult) => r.rrfScore >= settings.rrfThreshold);
  } catch (error) {
    console.error(`Search failed (method=${method}):`, error);
    return [];
  }
}

async function vectorOnlySearch(
  companyId: string,
  queryEmbedding: number[],
  kbIds: string[] | null,
  matchCount: number,
  similarityThreshold: number,
): Promise<SearchResult[]> {
  const { data, error } = await supabaseAdmin.rpc('vector_search', {
    p_query_embedding: JSON.stringify(queryEmbedding),
    p_company_id: companyId,
    p_knowledge_base_ids: kbIds,
    p_match_count: matchCount,
  });

  if (error) throw error;

  return (data || [])
    .map((row: Record<string, unknown>, i: number) => ({
      id: row.id as string,
      entryId: row.entry_id as string,
      knowledgeBaseId: row.knowledge_base_id as string,
      chunkIndex: row.chunk_index as number,
      content: row.content as string,
      metadata: (row.metadata as Record<string, unknown>) || {},
      vectorRank: i + 1,
      ftsRank: 0,
      rrfScore: row.similarity as number,
      confidence: scoreToConfidence(row.similarity as number, 'vector'),
    }))
    .filter((r: SearchResult) => r.rrfScore >= similarityThreshold);
}

async function ftsOnlySearch(
  companyId: string,
  query: string,
  kbIds: string[] | null,
  matchCount: number,
  ftsThreshold: number,
): Promise<SearchResult[]> {
  const { data, error } = await supabaseAdmin.rpc('fts_search', {
    p_query_text: query,
    p_company_id: companyId,
    p_knowledge_base_ids: kbIds,
    p_match_count: matchCount,
  });

  if (error) throw error;

  return (data || [])
    .map((row: Record<string, unknown>, i: number) => ({
      id: row.id as string,
      entryId: row.entry_id as string,
      knowledgeBaseId: row.knowledge_base_id as string,
      chunkIndex: row.chunk_index as number,
      content: row.content as string,
      metadata: (row.metadata as Record<string, unknown>) || {},
      vectorRank: 0,
      ftsRank: i + 1,
      rrfScore: row.fts_rank as number,
      confidence: scoreToConfidence(row.fts_rank as number, 'fts'),
    }))
    .filter((r: SearchResult) => r.rrfScore >= ftsThreshold);
}

// ── Confidence Scoring ────────────────────────────

function scoreToConfidence(
  score: number,
  method: 'vector' | 'fts' | 'hybrid',
): 'high' | 'medium' | 'low' {
  if (method === 'vector') {
    if (score > 0.5) return 'high';
    if (score > 0.35) return 'medium';
    return 'low';
  }
  if (method === 'fts') {
    if (score > 0.1) return 'high';
    if (score > 0.03) return 'medium';
    return 'low';
  }
  // hybrid (RRF)
  if (score > 0.02) return 'high';
  if (score > 0.01) return 'medium';
  return 'low';
}

// ── Backfill ───────────────────────────────────────

/**
 * Re-process all existing entries that don't have embeddings yet.
 * Call via POST /api/ai/backfill-embeddings after deployment.
 */
export async function backfillExistingEntries(): Promise<{
  processed: number;
  failed: number;
  skipped: number;
}> {
  if (!openai) {
    console.warn('Backfill skipped: OPENAI_API_KEY not configured');
    return { processed: 0, failed: 0, skipped: 0 };
  }

  const { data: entries, error } = await supabaseAdmin
    .from('knowledge_base_entries')
    .select('id, content, knowledge_base_id, company_id, title, file_name, source_type')
    .in('embedding_status', ['pending', 'failed']);

  if (error || !entries) {
    console.error('Failed to fetch entries for backfill:', error);
    return { processed: 0, failed: 0, skipped: 0 };
  }

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.content?.trim()) {
      skipped++;
      continue;
    }

    try {
      // For backfill, we clean the existing content as structured text
      const structuredText = cleanText(entry.content);

      await processAndEmbedEntry(
        entry.id,
        structuredText,
        entry.knowledge_base_id,
        entry.company_id,
        entry.title,
        entry.file_name,
        entry.source_type || 'text',
      );

      // Check if it actually completed (processAndEmbedEntry catches its own errors)
      const { data: updated } = await supabaseAdmin
        .from('knowledge_base_entries')
        .select('embedding_status')
        .eq('id', entry.id)
        .single();

      if (updated?.embedding_status === 'completed') {
        processed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { processed, failed, skipped };
}
