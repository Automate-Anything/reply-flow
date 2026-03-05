/**
 * Query Classifier for Smart KB Retrieval
 *
 * Analyzes search queries using heuristics to determine the optimal
 * retrieval method: vector (semantic), FTS (keyword), or hybrid.
 * Pure TypeScript — no API calls, zero latency cost.
 */

export type RetrievalMethod = 'vector' | 'fts' | 'hybrid';

export interface QueryClassification {
  method: RetrievalMethod;
  reasoning: string;
  vectorWeight: number;  // 0-1, used for weighted hybrid
  ftsWeight: number;     // 0-1, used for weighted hybrid
}

// ── Pattern Detectors ────────────────────────────

/** Identifiers: snake_case, camelCase, ALL_CAPS, dot.notation */
const IDENTIFIER_RE = /[a-z]+_[a-z]+|[a-z]+[A-Z][a-zA-Z]*|[A-Z_]{3,}|[a-z]+\.[a-z]+\.[a-z]+/;

/** Quoted exact phrase */
const QUOTED_RE = /^["'].+["']$/;

/** Version numbers, long numeric IDs */
const VERSION_ID_RE = /v\d+\.\d+|\b\d{5,}\b/;

/** Email or URL pattern */
const EMAIL_URL_RE = /\S+@\S+\.\S+|https?:\/\/\S+/;

/** File paths or extensions */
const FILE_PATH_RE = /\.\w{1,5}$|\/\w+\/|\\[\w]+\\/;

/** Code-like patterns: function calls, brackets, operators */
const CODE_RE = /\w+\(.*\)|[{}[\]<>]|=>|::|->|\$\w+/;

/** Question words at start */
const QUESTION_RE = /^(what|how|why|when|where|who|which|can|does|is|are|should|would|could|tell|explain|describe|summarize)\b/i;

/** Conceptual/abstract terms */
const CONCEPTUAL_TERMS = /\b(policy|guideline|practice|approach|strategy|overview|summary|explanation|definition|purpose|goal|benefit|difference|comparison|recommendation|process|workflow|procedure|rule|requirement)\b/i;

// ── Scoring ──────────────────────────────────────

export function classifyQuery(query: string): QueryClassification {
  const trimmed = query.trim();
  const words = trimmed.split(/\s+/);
  const wordCount = words.length;

  let ftsScore = 0;
  let vectorScore = 0;
  const reasons: string[] = [];

  // ── FTS Signals ──

  // Short queries (1-3 words) are likely keyword lookups
  if (wordCount <= 2) {
    ftsScore += 3;
    reasons.push('very short query');
  } else if (wordCount === 3) {
    ftsScore += 1;
    reasons.push('short query');
  }

  // Contains identifiers (snake_case, camelCase, ALL_CAPS)
  if (IDENTIFIER_RE.test(trimmed)) {
    ftsScore += 3;
    reasons.push('contains identifier pattern');
  }

  // Wrapped in quotes (exact phrase)
  if (QUOTED_RE.test(trimmed)) {
    ftsScore += 4;
    reasons.push('quoted exact phrase');
  }

  // Contains version numbers or long numeric IDs
  if (VERSION_ID_RE.test(trimmed)) {
    ftsScore += 2;
    reasons.push('contains version/ID');
  }

  // Contains email or URL
  if (EMAIL_URL_RE.test(trimmed)) {
    ftsScore += 3;
    reasons.push('contains email/URL');
  }

  // Contains file paths or extensions
  if (FILE_PATH_RE.test(trimmed)) {
    ftsScore += 2;
    reasons.push('contains file path');
  }

  // Contains code-like patterns
  if (CODE_RE.test(trimmed)) {
    ftsScore += 2;
    reasons.push('contains code pattern');
  }

  // ── Vector Signals ──

  // Starts with question word
  if (QUESTION_RE.test(trimmed)) {
    vectorScore += 3;
    reasons.push('question format');
  }

  // Contains conceptual/abstract terms
  if (CONCEPTUAL_TERMS.test(trimmed)) {
    vectorScore += 2;
    reasons.push('conceptual language');
  }

  // Longer natural language queries (>5 words, no special patterns)
  if (wordCount > 5 && !IDENTIFIER_RE.test(trimmed) && !CODE_RE.test(trimmed)) {
    vectorScore += 2;
    reasons.push('long natural language');
  }

  // Entirely lowercase with spaces (natural language)
  if (trimmed === trimmed.toLowerCase() && wordCount > 3 && !IDENTIFIER_RE.test(trimmed)) {
    vectorScore += 1;
    reasons.push('lowercase prose');
  }

  // ── Decision ──

  const diff = ftsScore - vectorScore;

  if (diff >= 3) {
    return {
      method: 'fts',
      reasoning: `FTS preferred (${reasons.join(', ')})`,
      vectorWeight: 0,
      ftsWeight: 1,
    };
  }

  if (diff <= -3) {
    return {
      method: 'vector',
      reasoning: `Vector preferred (${reasons.join(', ')})`,
      vectorWeight: 1,
      ftsWeight: 0,
    };
  }

  // Close scores → hybrid with weights
  const total = Math.max(ftsScore + vectorScore, 1);
  const ftsWeight = 0.3 + 0.7 * (ftsScore / total);
  const vectorWeight = 0.3 + 0.7 * (vectorScore / total);

  return {
    method: 'hybrid',
    reasoning: `Hybrid (${reasons.join(', ') || 'balanced query'})`,
    vectorWeight: Math.round(vectorWeight * 100) / 100,
    ftsWeight: Math.round(ftsWeight * 100) / 100,
  };
}
