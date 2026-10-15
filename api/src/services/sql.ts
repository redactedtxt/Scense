// SQL fragment: the ring position of a fragrance's largest family share.
// Postgres arrays count from 1, ring positions from 0, hence the "- 1".
// A tie goes to the lower position, matching the pipeline and services/scoring.ts.
// `column` is always one of our own column names, never user input.
export function dominantFamilyId(column: string): string {
  return `(SELECT i - 1 FROM generate_subscripts(${column}, 1) AS i ORDER BY ${column}[i] DESC, i ASC LIMIT 1)`;
}
