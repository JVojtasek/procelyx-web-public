/** Public ingestion token only. Management/personal API keys must never be supplied here. */
export function analyticsConfig(env) {
  const token = String(env.POSTHOG_PROJECT_TOKEN || '');
  const enabled = /^phc_[A-Za-z0-9]{10,160}$/.test(token);
  return Response.json({enabled, ...(enabled ? {token, host: 'https://eu.i.posthog.com', projectId: 295120} : {})}, {
    headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
  });
}
