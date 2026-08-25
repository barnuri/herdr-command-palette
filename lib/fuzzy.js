'use strict';

const BASE_MATCH_SCORE = 1;
const CONSECUTIVE_MATCH_BONUS = 5;
const WORD_START_BONUS = 10;
const GAP_PENALTY_PER_CHAR = 1;
const WORD_SEPARATORS = new Set(['/', '-', '_', ' ', '.', ':']);

function isWordStart(text, index) {
  if (index === 0) {
    return true;
  }
  return WORD_SEPARATORS.has(text[index - 1]);
}

// Greedy left-to-right subsequence scan: each query char matches the earliest
// occurrence after the previous match. Deterministic by construction.
function fuzzyScore(text, query) {
  if (typeof text !== 'string' || typeof query !== 'string') {
    return null;
  }
  if (query.length === 0) {
    return 0;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let score = 0;
  let previousMatchIndex = -1;

  for (const queryChar of lowerQuery) {
    if (queryChar === ' ') {
      continue;
    }

    const matchIndex = lowerText.indexOf(queryChar, previousMatchIndex + 1);
    if (matchIndex === -1) {
      return null;
    }

    score += BASE_MATCH_SCORE;
    if (matchIndex === previousMatchIndex + 1 && previousMatchIndex !== -1) {
      score += CONSECUTIVE_MATCH_BONUS;
    }
    if (isWordStart(lowerText, matchIndex)) {
      score += WORD_START_BONUS;
    }
    // Leading gap counts too (previousMatchIndex starts at -1), so an
    // exact-prefix match outscores the same match found deeper in the text.
    score -= (matchIndex - previousMatchIndex - 1) * GAP_PENALTY_PER_CHAR;

    previousMatchIndex = matchIndex;
  }

  return score;
}

function fuzzyFilter(items, query, keyFn = (item) => String(item)) {
  if (!Array.isArray(items)) {
    return [];
  }
  if (typeof query !== 'string' || query.trim().length === 0) {
    return items;
  }

  const scored = [];
  for (let index = 0; index < items.length; index += 1) {
    const score = fuzzyScore(keyFn(items[index]), query);
    if (score === null) {
      continue;
    }
    scored.push({ item: items[index], score, index });
  }

  // Ties fall back to the incoming order, which already carries recency and
  // alphabetical ranking — so filtering never reshuffles equally-good matches.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.map((entry) => entry.item);
}

module.exports = { fuzzyScore, fuzzyFilter };
