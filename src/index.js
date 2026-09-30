import { handleContact } from './contact.js';
import { nexusConfigured, drainNexusQueue } from './nexus.js';
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === 'www.procelyx.cz') {
      url.hostname = 'procelyx.cz';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname === '/api/contact') return handleContact(request, env, fetch, ctx);
    return env.ASSETS.fetch(request);
  },
  // Cron trigger (wrangler.jsonc): retries inquiries queued while Nexus One was unavailable.
  async scheduled(controller, env, ctx) {
    if (nexusConfigured(env)) ctx.waitUntil(drainNexusQueue(env));
  }
};
