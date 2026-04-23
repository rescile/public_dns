/**
 * Thin helpers for talking to the REST & GraphQL back-ends.
 */

/**
 * Execute a GraphQL query and return the parsed `data` field.
 */
export async function gql(query) {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  return json.data;
}

/**
 * Convenience wrapper around fetch that returns parsed JSON.
 */
export async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
