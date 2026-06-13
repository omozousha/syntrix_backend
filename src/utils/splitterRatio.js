function parseSplitterRatioPorts(value) {
  const ratio = String(value || '').trim();
  if (!ratio) return null;

  const match = ratio.match(/^(\d+)\s*[:/]\s*(\d+)$/);
  if (!match) return null;

  const inputCount = Number(match[1]);
  const outputCount = Number(match[2]);
  if (!Number.isInteger(inputCount) || inputCount < 1) return null;
  if (!Number.isInteger(outputCount) || outputCount < 1) return null;

  return outputCount;
}

module.exports = { parseSplitterRatioPorts };
