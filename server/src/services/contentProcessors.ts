/**
 * Content Processors for Smart KB Ingestion
 *
 * Format-specific extractors that convert various file types into
 * clean text suitable for chunking and embedding. Each processor
 * returns a ProcessedDocument compatible with the existing pipeline.
 */

import type { ProcessedDocument, DocumentMetadata } from './documentProcessor.js';
import { detectLanguage } from './contentClassifier.js';

// ── Markdown ──────────────────────────────────────

export function extractMarkdown(buffer: Buffer, fileName: string): ProcessedDocument {
  const text = buffer.toString('utf-8').trim();

  // Minimal cleaning: normalize whitespace, fix encoding
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Strip headings for cleanedText (readable content)
  const cleanedText = cleaned.replace(/^#{1,6}\s+/gm, '');

  return {
    cleanedText,
    structuredText: cleaned, // Already markdown — use as-is
    metadata: {
      title: extractFirstHeading(cleaned),
      author: null,
      createdDate: null,
      pageCount: null,
      sourceType: 'markdown',
      contentType: 'markdown',
      strategy: 'markdown_pipeline',
    } as DocumentMetadata,
    warnings: [],
  };
}

function extractFirstHeading(markdown: string): string | null {
  const match = markdown.match(/^#{1,6}\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

// ── HTML ──────────────────────────────────────────

export function extractHtml(buffer: Buffer, fileName: string): ProcessedDocument {
  let text = buffer.toString('utf-8');

  // Remove script, style, nav, footer, header tags and their content
  text = text.replace(/<(script|style|nav|footer|header|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert headings to markdown
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, content) => {
    return '\n' + '#'.repeat(parseInt(level)) + ' ' + stripTags(content).trim() + '\n';
  });

  // Convert paragraphs
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, content) => {
    return '\n' + stripTags(content).trim() + '\n';
  });

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, content) => {
    return '- ' + stripTags(content).trim() + '\n';
  });

  // Convert links
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, content) => {
    const linkText = stripTags(content).trim();
    return linkText ? `[${linkText}](${href})` : href;
  });

  // Convert bold/strong
  text = text.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, content) => `**${stripTags(content).trim()}**`);

  // Convert italic/em
  text = text.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, content) => `*${stripTags(content).trim()}*`);

  // Convert code blocks
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_m, content) => {
    return '\n```\n' + decodeHtmlEntities(content).trim() + '\n```\n';
  });
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, content) => `\`${decodeHtmlEntities(content).trim()}\``);

  // Convert <br> and <hr>
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Convert table rows to readable format
  text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, content) => {
    const cells = content.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
    const values = cells.map((cell: string) => stripTags(cell).trim());
    return values.join(' | ') + '\n';
  });

  // Strip all remaining tags
  text = stripTags(text);

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Normalize whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  // Extract title from <title> tag
  const titleMatch = buffer.toString('utf-8').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).trim() : null;

  return {
    cleanedText: text,
    structuredText: text,
    metadata: {
      title,
      author: null,
      createdDate: null,
      pageCount: null,
      sourceType: 'html',
      contentType: 'html',
      strategy: 'html_pipeline',
    } as DocumentMetadata,
    warnings: [],
  };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)));
}

// ── CSV / TSV ────────────────────────────────────

export function extractCsv(buffer: Buffer, fileName: string): ProcessedDocument {
  const text = buffer.toString('utf-8').trim();
  const isTsv = fileName.endsWith('.tsv') || text.split('\n')[0].split('\t').length > text.split('\n')[0].split(',').length;
  const delimiter = isTsv ? '\t' : ',';

  const rows = parseCsvRows(text, delimiter);
  if (rows.length === 0) {
    return {
      cleanedText: text,
      structuredText: text,
      metadata: {
        title: null, author: null, createdDate: null, pageCount: null,
        sourceType: 'csv', contentType: 'csv', strategy: 'tabular_pipeline',
      } as DocumentMetadata,
      warnings: ['Empty or unparseable CSV'],
    };
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const schema = headers.join(', ');

  // Convert to natural-language chunks: groups of rows
  const ROWS_PER_CHUNK = 15;
  const chunks: string[] = [];

  for (let i = 0; i < dataRows.length; i += ROWS_PER_CHUNK) {
    const batch = dataRows.slice(i, i + ROWS_PER_CHUNK);
    const lines = batch.map((row, idx) => {
      const pairs = headers.map((h, j) => `${h}=${row[j] ?? ''}`);
      return `Row ${i + idx + 1}: ${pairs.join(', ')}`;
    });
    chunks.push(`Schema: ${schema}\n\n${lines.join('\n')}`);
  }

  const structuredText = chunks.join('\n\n---\n\n');
  const cleanedText = `Table with ${dataRows.length} rows and ${headers.length} columns (${schema})\n\n${structuredText}`;

  return {
    cleanedText,
    structuredText,
    metadata: {
      title: null,
      author: null,
      createdDate: null,
      pageCount: null,
      sourceType: 'csv',
      contentType: 'csv',
      strategy: 'tabular_pipeline',
      schema: Object.fromEntries(headers.map((h) => [h, 'string'])),
      rowCount: dataRows.length,
    } as DocumentMetadata,
    warnings: [],
  };
}

/** Simple CSV parser that handles quoted fields */
function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (char === '"') {
        if (inQuotes && trimmed[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    rows.push(fields);
  }

  return rows;
}

// ── JSON ──────────────────────────────────────────

export function extractJson(buffer: Buffer, fileName: string): ProcessedDocument {
  const text = buffer.toString('utf-8').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Try JSONL (one JSON object per line)
    const lines = text.split('\n').filter((l) => l.trim());
    const objects: unknown[] = [];
    for (const line of lines) {
      try {
        objects.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
    if (objects.length > 0) {
      parsed = objects;
    } else {
      return {
        cleanedText: text,
        structuredText: text,
        metadata: {
          title: null, author: null, createdDate: null, pageCount: null,
          sourceType: 'json', contentType: 'structured_json', strategy: 'structured_data',
        } as DocumentMetadata,
        warnings: ['Could not parse JSON'],
      };
    }
  }

  // Array of objects: treat like CSV (rows of key-value pairs)
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
    const allKeys = new Set<string>();
    for (const obj of parsed.slice(0, 100)) {
      if (typeof obj === 'object' && obj !== null) {
        for (const key of Object.keys(obj)) allKeys.add(key);
      }
    }
    const headers = Array.from(allKeys);
    const schema = headers.join(', ');

    const ROWS_PER_CHUNK = 10;
    const chunks: string[] = [];

    for (let i = 0; i < parsed.length; i += ROWS_PER_CHUNK) {
      const batch = parsed.slice(i, i + ROWS_PER_CHUNK);
      const lines = batch.map((obj, idx) => {
        const record = obj as Record<string, unknown>;
        const pairs = headers.map((h) => `${h}=${formatJsonValue(record[h])}`);
        return `Item ${i + idx + 1}: ${pairs.join(', ')}`;
      });
      chunks.push(`Schema: ${schema}\n\n${lines.join('\n')}`);
    }

    const structuredText = chunks.join('\n\n---\n\n');

    return {
      cleanedText: `JSON array with ${parsed.length} items (${schema})\n\n${structuredText}`,
      structuredText,
      metadata: {
        title: null, author: null, createdDate: null, pageCount: null,
        sourceType: 'json', contentType: 'structured_json', strategy: 'structured_data',
        schema: Object.fromEntries(headers.map((h) => [h, 'string'])),
        rowCount: parsed.length,
      } as DocumentMetadata,
      warnings: [],
    };
  }

  // Single object: flatten with dot-notation
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const flattened = flattenObject(parsed as Record<string, unknown>);
    const lines = Object.entries(flattened).map(([key, value]) => `${key}: ${formatJsonValue(value)}`);
    const structuredText = lines.join('\n');

    return {
      cleanedText: structuredText,
      structuredText,
      metadata: {
        title: null, author: null, createdDate: null, pageCount: null,
        sourceType: 'json', contentType: 'structured_json', strategy: 'structured_data',
      } as DocumentMetadata,
      warnings: [],
    };
  }

  // Fallback: stringify
  const fallbackText = JSON.stringify(parsed, null, 2);
  return {
    cleanedText: fallbackText,
    structuredText: fallbackText,
    metadata: {
      title: null, author: null, createdDate: null, pageCount: null,
      sourceType: 'json', contentType: 'structured_json', strategy: 'structured_data',
    } as DocumentMetadata,
    warnings: [],
  };
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else if (Array.isArray(value)) {
      if (value.length <= 5 && value.every((v) => typeof v !== 'object')) {
        result[fullKey] = value.join(', ');
      } else {
        result[fullKey] = `[array of ${value.length} items]`;
      }
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    return value.length > 200 ? value.slice(0, 200) + '...' : value;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ── Spreadsheet (XLSX) ───────────────────────────

export async function extractSpreadsheet(buffer: Buffer, fileName: string): Promise<ProcessedDocument> {
  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch {
    return {
      cleanedText: '',
      structuredText: '',
      metadata: {
        title: null, author: null, createdDate: null, pageCount: null,
        sourceType: 'spreadsheet', contentType: 'spreadsheet', strategy: 'tabular_pipeline',
      } as DocumentMetadata,
      warnings: ['XLSX support not available (xlsx package not installed)'],
    };
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const allChunks: string[] = [];
  let totalRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
    if (rows.length < 2) continue;

    const headers = rows[0].map(String);
    const dataRows = rows.slice(1);
    totalRows += dataRows.length;
    const schema = headers.join(', ');
    const sheetPrefix = workbook.SheetNames.length > 1 ? `## Sheet: ${sheetName}\n\n` : '';

    const ROWS_PER_CHUNK = 15;
    for (let i = 0; i < dataRows.length; i += ROWS_PER_CHUNK) {
      const batch = dataRows.slice(i, i + ROWS_PER_CHUNK);
      const lines = batch.map((row, idx) => {
        const pairs = headers.map((h, j) => `${h}=${row[j] ?? ''}`);
        return `Row ${i + idx + 1}: ${pairs.join(', ')}`;
      });
      allChunks.push(`${sheetPrefix}Schema: ${schema}\n\n${lines.join('\n')}`);
    }
  }

  const structuredText = allChunks.join('\n\n---\n\n');

  return {
    cleanedText: `Spreadsheet with ${totalRows} rows across ${workbook.SheetNames.length} sheet(s)\n\n${structuredText}`,
    structuredText,
    metadata: {
      title: null, author: null, createdDate: null, pageCount: null,
      sourceType: 'spreadsheet', contentType: 'spreadsheet', strategy: 'tabular_pipeline',
      rowCount: totalRows,
    } as DocumentMetadata,
    warnings: [],
  };
}

// ── Code ──────────────────────────────────────────

export function extractCode(buffer: Buffer, fileName: string): ProcessedDocument {
  const text = buffer.toString('utf-8').trim();
  const language = detectLanguage(fileName);

  // Split by function/class boundaries
  const chunks = splitCodeByFunctions(text, language);
  const structuredText = chunks.length > 1
    ? chunks.map((c, i) => `## Code Block ${i + 1}\n\n\`\`\`${language || ''}\n${c}\n\`\`\``).join('\n\n')
    : `\`\`\`${language || ''}\n${text}\n\`\`\``;

  return {
    cleanedText: text,
    structuredText,
    metadata: {
      title: null,
      author: null,
      createdDate: null,
      pageCount: null,
      sourceType: 'code',
      contentType: 'code',
      strategy: 'code_pipeline',
      language,
    } as DocumentMetadata,
    warnings: [],
  };
}

function splitCodeByFunctions(text: string, language: string | null): string[] {
  // Patterns for function/class boundaries per language family
  let pattern: RegExp;

  switch (language) {
    case 'python':
      pattern = /^(?=(?:def |class |async def ))/gm;
      break;
    case 'javascript':
    case 'typescript':
      pattern = /^(?=(?:export (?:default )?)?(?:function |class |const \w+ = (?:async )?\(|(?:async )?function))/gm;
      break;
    case 'go':
      pattern = /^(?=func )/gm;
      break;
    case 'java':
    case 'kotlin':
    case 'csharp':
      pattern = /^(?=\s*(?:public |private |protected |static |override |abstract )*(?:class |interface |fun |func |void |int |string |boolean |Task))/gm;
      break;
    case 'rust':
      pattern = /^(?=(?:pub )?(?:fn |struct |impl |enum |trait |mod ))/gm;
      break;
    case 'ruby':
      pattern = /^(?=(?:def |class |module ))/gm;
      break;
    case 'php':
      pattern = /^(?=(?:public |private |protected |static )*function )/gm;
      break;
    default:
      // Generic: split by blank lines between blocks
      pattern = /\n{2,}(?=\S)/g;
  }

  const chunks = text.split(pattern).filter((c) => c.trim().length > 0);

  // If splitting produced too many tiny chunks, merge back
  if (chunks.length > 50) {
    const merged: string[] = [];
    let current = '';
    for (const chunk of chunks) {
      if (current.length + chunk.length > 3000 && current.length > 0) {
        merged.push(current.trim());
        current = chunk;
      } else {
        current += (current ? '\n\n' : '') + chunk;
      }
    }
    if (current.trim()) merged.push(current.trim());
    return merged;
  }

  return chunks;
}

// ── Config ────────────────────────────────────────

export function extractConfig(buffer: Buffer, fileName: string): ProcessedDocument {
  const text = buffer.toString('utf-8').trim();
  const language = detectLanguage(fileName) || fileName.split('.').pop() || 'config';

  return {
    cleanedText: text,
    structuredText: `\`\`\`${language}\n${text}\n\`\`\``,
    metadata: {
      title: null,
      author: null,
      createdDate: null,
      pageCount: null,
      sourceType: 'config',
      contentType: 'config',
      strategy: 'code_pipeline',
      language,
    } as DocumentMetadata,
    warnings: [],
  };
}
