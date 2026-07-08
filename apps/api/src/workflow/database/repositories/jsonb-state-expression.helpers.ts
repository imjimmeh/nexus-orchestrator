/**
 * Builds a Postgres SQL expression that sets a nested JSONB value,
 * creating any missing intermediate objects along the path.
 *
 * The returned expression starts from the `state_variables` column and wraps
 * it in successive `jsonb_set` calls so that every parent object exists before
 * the leaf is written. Parent and leaf paths are appended to the supplied
 * `params` object using the same named-parameter names that TypeORM expects
 * (`:parentPath0`, `:parentPath1`, ..., `:leafPath`).
 */
export function buildNestedJsonbSetExpr(options: {
  segments: string[];
  leafValueSql: string;
  params: Record<string, string>;
}): string {
  const { segments, leafValueSql, params } = options;

  params['leafPath'] = `{${segments.join(',')}}`;

  let expr = '"state_variables"';
  for (let i = 0; i < segments.length - 1; i++) {
    const paramName = `parentPath${i}`;
    params[paramName] = `{${segments.slice(0, i + 1).join(',')}}`;
    expr = `jsonb_set(${expr}, :${paramName}, COALESCE(${expr} #> :${paramName}, '{}'), true)`;
  }

  return `jsonb_set(${expr}, :leafPath, ${leafValueSql}, true)`;
}
