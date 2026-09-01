'use strict';

function searchText(entry) {
  return `${entry.sourceLabel} ${entry.title} ${entry.description} ${entry.id}`;
}

// Lower rank sorts first, so recently run entries float to the top; everything
// else falls back to a stable alphabetical order the user can predict.
function compareForDisplay(rankOf) {
  return (left, right) => {
    const rankDifference = rankOf(left.id) - rankOf(right.id);
    if (rankDifference !== 0) {
      return rankDifference;
    }
    return left.sourceLabel.localeCompare(right.sourceLabel) || left.title.localeCompare(right.title);
  };
}

function mergeEntries(sources, { chords = new Map(), rankOf = () => 0 } = {}) {
  const merged = [];
  for (const source of sources) {
    if (!Array.isArray(source)) {
      continue;
    }
    for (const entry of source) {
      entry.chord = chords.get(entry.id) || '';
      merged.push(entry);
    }
  }

  return merged.sort(compareForDisplay(rankOf));
}

module.exports = { searchText, mergeEntries };
