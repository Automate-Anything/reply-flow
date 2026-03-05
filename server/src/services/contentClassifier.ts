/**
 * Content Classifier for Smart KB Ingestion
 *
 * Detects content type from file extension, MIME type, and content sampling.
 * Routes each file to the appropriate processing pipeline.
 */

import path from 'path';

// ── Types ──────────────────────────────────────────

export type ContentType =
  | 'prose'
  | 'markdown'
  | 'html'
  | 'structured_json'
  | 'csv'
  | 'spreadsheet'
  | 'code'
  | 'config';

export type ProcessingStrategy =
  | 'document_pipeline'
  | 'markdown_pipeline'
  | 'html_pipeline'
  | 'structured_data'
  | 'tabular_pipeline'
  | 'code_pipeline'
  | 'text_fallback';

export interface ClassificationResult {
  contentType: ContentType;
  strategy: ProcessingStrategy;
  confidence: 'high' | 'medium';
}

// ── Extension → ContentType Mapping ────────────────

const EXTENSION_MAP: Record<string, { contentType: ContentType; strategy: ProcessingStrategy }> = {
  // Prose documents (existing pipeline)
  '.pdf':  { contentType: 'prose', strategy: 'document_pipeline' },
  '.docx': { contentType: 'prose', strategy: 'document_pipeline' },

  // Markdown
  '.md':       { contentType: 'markdown', strategy: 'markdown_pipeline' },
  '.markdown': { contentType: 'markdown', strategy: 'markdown_pipeline' },
  '.mdx':      { contentType: 'markdown', strategy: 'markdown_pipeline' },

  // HTML
  '.html': { contentType: 'html', strategy: 'html_pipeline' },
  '.htm':  { contentType: 'html', strategy: 'html_pipeline' },

  // Structured data
  '.json':  { contentType: 'structured_json', strategy: 'structured_data' },
  '.jsonl': { contentType: 'structured_json', strategy: 'structured_data' },

  // Tabular
  '.csv': { contentType: 'csv', strategy: 'tabular_pipeline' },
  '.tsv': { contentType: 'csv', strategy: 'tabular_pipeline' },

  // Spreadsheets
  '.xlsx': { contentType: 'spreadsheet', strategy: 'tabular_pipeline' },
  '.xls':  { contentType: 'spreadsheet', strategy: 'tabular_pipeline' },

  // Code
  '.ts':    { contentType: 'code', strategy: 'code_pipeline' },
  '.tsx':   { contentType: 'code', strategy: 'code_pipeline' },
  '.js':    { contentType: 'code', strategy: 'code_pipeline' },
  '.jsx':   { contentType: 'code', strategy: 'code_pipeline' },
  '.py':    { contentType: 'code', strategy: 'code_pipeline' },
  '.go':    { contentType: 'code', strategy: 'code_pipeline' },
  '.java':  { contentType: 'code', strategy: 'code_pipeline' },
  '.rb':    { contentType: 'code', strategy: 'code_pipeline' },
  '.php':   { contentType: 'code', strategy: 'code_pipeline' },
  '.c':     { contentType: 'code', strategy: 'code_pipeline' },
  '.cpp':   { contentType: 'code', strategy: 'code_pipeline' },
  '.h':     { contentType: 'code', strategy: 'code_pipeline' },
  '.rs':    { contentType: 'code', strategy: 'code_pipeline' },
  '.swift': { contentType: 'code', strategy: 'code_pipeline' },
  '.kt':    { contentType: 'code', strategy: 'code_pipeline' },
  '.cs':    { contentType: 'code', strategy: 'code_pipeline' },
  '.sh':    { contentType: 'code', strategy: 'code_pipeline' },
  '.sql':   { contentType: 'code', strategy: 'code_pipeline' },
  '.r':     { contentType: 'code', strategy: 'code_pipeline' },

  // Config
  '.yaml': { contentType: 'config', strategy: 'code_pipeline' },
  '.yml':  { contentType: 'config', strategy: 'code_pipeline' },
  '.toml': { contentType: 'config', strategy: 'code_pipeline' },
  '.ini':  { contentType: 'config', strategy: 'code_pipeline' },
  '.xml':  { contentType: 'config', strategy: 'code_pipeline' },
  '.env':  { contentType: 'config', strategy: 'code_pipeline' },
};

// ── MIME → ContentType Mapping ─────────────────────

const MIME_MAP: Record<string, { contentType: ContentType; strategy: ProcessingStrategy }> = {
  'application/pdf': { contentType: 'prose', strategy: 'document_pipeline' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { contentType: 'prose', strategy: 'document_pipeline' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { contentType: 'spreadsheet', strategy: 'tabular_pipeline' },
  'application/vnd.ms-excel': { contentType: 'spreadsheet', strategy: 'tabular_pipeline' },
  'text/html': { contentType: 'html', strategy: 'html_pipeline' },
  'text/markdown': { contentType: 'markdown', strategy: 'markdown_pipeline' },
  'text/csv': { contentType: 'csv', strategy: 'tabular_pipeline' },
  'text/tab-separated-values': { contentType: 'csv', strategy: 'tabular_pipeline' },
  'application/json': { contentType: 'structured_json', strategy: 'structured_data' },
  'application/xml': { contentType: 'config', strategy: 'code_pipeline' },
  'text/xml': { contentType: 'config', strategy: 'code_pipeline' },
};

// ── Content Heuristics (for .txt and unknowns) ────

function classifyByContent(sample: string): ClassificationResult {
  const trimmed = sample.trim();

  // JSON detection: starts with { or [
  if (/^\s*[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed.length > 5000 ? trimmed.slice(0, 5000) : trimmed);
      return { contentType: 'structured_json', strategy: 'structured_data', confidence: 'medium' };
    } catch {
      // Might be partial JSON, still treat as JSON if it has the structure
      if (/^\s*\{[\s\S]*"[\w]+"[\s\S]*:/.test(trimmed)) {
        return { contentType: 'structured_json', strategy: 'structured_data', confidence: 'medium' };
      }
    }
  }

  // CSV detection: consistent comma/tab-delimited lines
  const lines = trimmed.split('\n').slice(0, 10);
  if (lines.length >= 2) {
    const firstLineCommas = (lines[0].match(/,/g) || []).length;
    const firstLineTabs = (lines[0].match(/\t/g) || []).length;

    if (firstLineCommas >= 2) {
      const consistent = lines.slice(1, 5).every((line) => {
        const commas = (line.match(/,/g) || []).length;
        return Math.abs(commas - firstLineCommas) <= 1;
      });
      if (consistent) {
        return { contentType: 'csv', strategy: 'tabular_pipeline', confidence: 'medium' };
      }
    }

    if (firstLineTabs >= 2) {
      const consistent = lines.slice(1, 5).every((line) => {
        const tabs = (line.match(/\t/g) || []).length;
        return Math.abs(tabs - firstLineTabs) <= 1;
      });
      if (consistent) {
        return { contentType: 'csv', strategy: 'tabular_pipeline', confidence: 'medium' };
      }
    }
  }

  // HTML detection
  if (/<html|<head|<body|<div|<p\s|<table/i.test(trimmed)) {
    return { contentType: 'html', strategy: 'html_pipeline', confidence: 'medium' };
  }

  // Markdown detection: headings, links, code blocks
  if (/^#{1,6}\s/m.test(trimmed) || /\[.*?\]\(.*?\)/.test(trimmed) || /^```/m.test(trimmed)) {
    return { contentType: 'markdown', strategy: 'markdown_pipeline', confidence: 'medium' };
  }

  // Code detection: common patterns
  if (
    /^(import |from |export |const |let |var |function |class |def |package |#include )/m.test(trimmed) ||
    /^\s*(public |private |protected |static |async |fn |func )/m.test(trimmed)
  ) {
    return { contentType: 'code', strategy: 'code_pipeline', confidence: 'medium' };
  }

  // Config detection: key=value or YAML-like
  if (/^[\w.-]+=.+$/m.test(trimmed) || /^[\w-]+:\s+\S/m.test(trimmed)) {
    const keyValueLines = lines.filter((l) => /^[\w.-]+=/.test(l.trim()) || /^[\w-]+:\s/.test(l.trim()));
    if (keyValueLines.length > lines.length * 0.5) {
      return { contentType: 'config', strategy: 'code_pipeline', confidence: 'medium' };
    }
  }

  // Default: prose
  return { contentType: 'prose', strategy: 'text_fallback', confidence: 'medium' };
}

// ── Main Classifier ────────────────────────────────

export function classifyContent(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): ClassificationResult {
  const ext = path.extname(fileName).toLowerCase();

  // 1. Try extension mapping (highest confidence)
  const extMatch = EXTENSION_MAP[ext];
  if (extMatch) {
    return { ...extMatch, confidence: 'high' };
  }

  // 2. Try MIME type mapping
  const mimeMatch = MIME_MAP[mimeType];
  if (mimeMatch) {
    return { ...mimeMatch, confidence: 'high' };
  }

  // 3. For .txt or unknown: inspect content
  if (ext === '.txt' || mimeType === 'text/plain' || !ext) {
    const sample = buffer.slice(0, 4000).toString('utf-8');
    return classifyByContent(sample);
  }

  // 4. Try to read as text for any unrecognized extension
  try {
    const sample = buffer.slice(0, 4000).toString('utf-8');
    // Check if it's valid text (not binary)
    if (/[\x00-\x08\x0E-\x1F]/.test(sample.slice(0, 500))) {
      // Binary content — not supported
      return { contentType: 'prose', strategy: 'text_fallback', confidence: 'medium' };
    }
    return classifyByContent(sample);
  } catch {
    return { contentType: 'prose', strategy: 'text_fallback', confidence: 'medium' };
  }
}

// ── Language Detection for Code ────────────────────

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.go': 'go', '.java': 'java', '.rb': 'ruby', '.php': 'php',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.rs': 'rust', '.swift': 'swift',
  '.kt': 'kotlin', '.cs': 'csharp', '.sh': 'bash', '.sql': 'sql', '.r': 'r',
};

export function detectLanguage(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  return LANGUAGE_MAP[ext] ?? null;
}
