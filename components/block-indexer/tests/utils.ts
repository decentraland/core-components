export const range = (start, end) =>
  Array(end - start + 1)
    .fill(0)
    .map((_, idx) => start + idx)
