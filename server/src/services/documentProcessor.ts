/**
 * Document Processing Pipeline for RAG
 *
 * Handles format-specific text extraction, cleaning, metadata extraction,
 * and structure preservation for PDF, DOCX, and TXT files.
 *
 * Returns both cleaned text (for storage) and structured markdown text
 * (for section-aware chunking in the embeddings service).
 */

// ── Types ──────────────────────────────────────────

export interface ProcessedDocument {
  /** Cleaned, normalized text — stored in entry `content` */
  cleanedText: string;
  /** Markdown-formatted text preserving headings/structure — used for chunking */
  structuredText: string;
  /** Document-level metadata */
  metadata: DocumentMetadata;
  /** Warnings from extraction (e.g., low text in scanned PDF) */
  warnings: string[];
}

export interface DocumentMetadata {
  title: string | null;
  author: string | null;
  createdDate: string | null;
  pageCount: number | null;
  sourceType: 'pdf' | 'docx' | 'txt';
}

interface PageText {
  pageNumber: number;
  text: string;
}

// ── Text Cleaning Functions ────────────────────────

/** Normalize common special characters and encoding artifacts */
function normalizeSpecialCharacters(text: string): string {
  return text
    // Smart quotes → straight quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // En dash / em dash
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, ' -- ')
    // Ellipsis
    .replace(/\u2026/g, '...')
    // Bullet characters → dash
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '-')
    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Common ligatures
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl');
}

/** Fix hyphenation artifacts and mid-sentence line breaks */
function fixLineBreaks(text: string): string {
  // Fix hyphenation: "word-\n" followed by lowercase letter
  let result = text.replace(/(\w)-\n(\w)/g, '$1$2');
  // Fix mid-sentence line breaks (line doesn't end with sentence-ending punctuation
  // and next line starts with lowercase)
  result = result.replace(/([^\n.!?:;])\n([a-z])/g, '$1 $2');
  return result;
}

/** Remove standalone page number lines */
function removePageNumbers(text: string): string {
  return text.replace(
    /^\s*(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?\s*$/gim,
    '',
  );
}

/** Normalize whitespace without destroying intentional formatting */
function normalizeWhitespace(text: string): string {
  return text
    // Unicode spaces → regular space
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    // Collapse multiple spaces within lines
    .replace(/[^\S\n]+/g, ' ')
    // Remove trailing whitespace per line
    .replace(/ +\n/g, '\n')
    // Collapse 3+ consecutive newlines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Detect and remove repeated headers/footers from per-page text.
 * Lines appearing in the top/bottom 3 lines of >50% of pages are considered headers/footers.
 */
function removeRepeatedHeadersFooters(pages: PageText[]): PageText[] {
  if (pages.length < 3) return pages;

  const TOP_LINES = 3;
  const BOTTOM_LINES = 3;
  const THRESHOLD = 0.5;

  const topCandidates = new Map<string, number>();
  const bottomCandidates = new Map<string, number>();

  for (const page of pages) {
    const lines = page.text.split('\n').filter((l) => l.trim());

    for (const line of lines.slice(0, TOP_LINES)) {
      const normalized = line.trim().replace(/\d+/g, '#');
      topCandidates.set(normalized, (topCandidates.get(normalized) || 0) + 1);
    }

    for (const line of lines.slice(-BOTTOM_LINES)) {
      const normalized = line.trim().replace(/\d+/g, '#');
      bottomCandidates.set(normalized, (bottomCandidates.get(normalized) || 0) + 1);
    }
  }

  const minCount = Math.floor(pages.length * THRESHOLD);
  const headerPatterns = new Set<string>();
  const footerPatterns = new Set<string>();

  for (const [pattern, count] of topCandidates) {
    if (count >= minCount) headerPatterns.add(pattern);
  }
  for (const [pattern, count] of bottomCandidates) {
    if (count >= minCount) footerPatterns.add(pattern);
  }

  if (headerPatterns.size === 0 && footerPatterns.size === 0) return pages;

  return pages.map((page) => {
    const lines = page.text.split('\n');
    const cleaned = lines.filter((line) => {
      const normalized = line.trim().replace(/\d+/g, '#');
      return !headerPatterns.has(normalized) && !footerPatterns.has(normalized);
    });
    return { ...page, text: cleaned.join('\n') };
  });
}

/** Full cleaning pipeline for a single text string */
export function cleanText(text: string): string {
  let cleaned = text;
  cleaned = normalizeSpecialCharacters(cleaned);
  cleaned = fixLineBreaks(cleaned);
  cleaned = removePageNumbers(cleaned);
  cleaned = normalizeWhitespace(cleaned);
  return cleaned;
}

/** Full cleaning pipeline for per-page PDF text */
function cleanPages(pages: PageText[]): PageText[] {
  const deduped = removeRepeatedHeadersFooters(pages);
  return deduped.map((page) => ({
    ...page,
    text: cleanText(page.text),
  }));
}

// ── Format-Specific Extractors ─────────────────────

/** Extract text from PDF with per-page tracking and metadata */
async function extractPdf(buffer: Buffer): Promise<ProcessedDocument> {
  const pdfParse = (await import('pdf-parse')).default;

  const pages: PageText[] = [];
  let pageNum = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options = {
    pagerender: async (pageData: any) => {
      pageNum++;
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });

      let pageText = '';
      let lastY: number | null = null;

      for (const item of textContent.items) {
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
          pageText += '\n';
        }
        pageText += item.str;
        lastY = item.transform[5];
      }

      pages.push({ pageNumber: pageNum, text: pageText });
      return pageText;
    },
  };

  const result = await pdfParse(buffer, options);

  const warnings: string[] = [];
  const avgCharsPerPage = result.text.trim().length / Math.max(result.numpages, 1);

  if (avgCharsPerPage < 50) {
    warnings.push('This PDF appears to be scanned/image-based. Very little text could be extracted.');
  } else if (avgCharsPerPage < 200) {
    warnings.push('This PDF may contain scanned pages. Some content may be missing.');
  }

  // Clean per-page text (removes repeated headers/footers)
  const cleanedPages = cleanPages(pages);
  const cleanedText = cleanedPages.map((p) => p.text).join('\n\n');

  // For PDFs we don't have heading structure, so structured text = cleaned text
  const structuredText = cleanedText;

  return {
    cleanedText,
    structuredText,
    metadata: {
      title: (result.info?.Title as string) || null,
      author: (result.info?.Author as string) || null,
      createdDate: (result.info?.CreationDate as string) || null,
      pageCount: result.numpages,
      sourceType: 'pdf',
    },
    warnings,
  };
}

/** Extract text from DOCX using mammoth with markdown structure preservation */
async function extractDocx(buffer: Buffer): Promise<ProcessedDocument> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mammoth = await import('mammoth') as any;

  // Get markdown with structure preserved (headings, lists, emphasis)
  const markdownResult = await mammoth.convertToMarkdown({
    buffer,
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Subtitle'] => h2:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
    ],
  });

  // Also get raw text for the cleaned version
  const rawResult = await mammoth.extractRawText({ buffer });

  const warnings = markdownResult.messages
    .filter((m: { type: string }) => m.type === 'warning')
    .map((m: { message: string }) => m.message);

  const cleanedText = cleanText(rawResult.value);
  const structuredText = cleanText(markdownResult.value);

  return {
    cleanedText,
    structuredText,
    metadata: {
      title: null,
      author: null,
      createdDate: null,
      pageCount: null,
      sourceType: 'docx',
    },
    warnings,
  };
}

/** Extract and structure text from TXT files with auto-detected headings */
function extractTxt(buffer: Buffer): ProcessedDocument {
  let text = buffer.toString('utf-8');

  // Remove UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const cleanedText = cleanText(text);

  // Try to detect and convert structure to markdown
  let structuredText = cleanedText;
  const hasMarkdownHeadings = /^#{1,6}\s+.+$/m.test(structuredText);

  if (!hasMarkdownHeadings) {
    const hasAllCapsHeadings = /^[A-Z][A-Z\s]{3,}$/m.test(structuredText);
    const hasNumberedSections = /^\d+\.\s+[A-Z]/m.test(structuredText);

    if (hasAllCapsHeadings) {
      // Convert ALL-CAPS lines to markdown headings
      structuredText = structuredText.replace(
        /^([A-Z][A-Z\s]{3,})$/gm,
        (match) => `## ${match.trim().charAt(0)}${match.trim().slice(1).toLowerCase()}`,
      );
    } else if (hasNumberedSections) {
      // Convert numbered sections to markdown headings
      structuredText = structuredText.replace(/^(\d+\.)\s+([A-Z].+)$/gm, '## $1 $2');
      structuredText = structuredText.replace(/^(\d+\.\d+\.?)\s+(.+)$/gm, '### $1 $2');
    }
  }

  return {
    cleanedText,
    structuredText,
    metadata: {
      title: null,
      author: null,
      createdDate: null,
      pageCount: null,
      sourceType: 'txt',
    },
    warnings: [],
  };
}

// ── Main Export ─────────────────────────────────────

/**
 * Process a document buffer into cleaned and structured text with metadata.
 * Replaces the inline extraction in ai.ts routes.
 */
export async function processDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<ProcessedDocument> {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return extractPdf(buffer);
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return extractDocx(buffer);
  }

  if (mimeType === 'text/plain' || ext === 'txt') {
    return extractTxt(buffer);
  }

  throw new Error(`Unsupported file type: ${mimeType} (${ext})`);
}
