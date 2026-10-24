// Cliente HTTP común: User-Agent identificable, timeout, reintentos, pausa mínima
// entre peticiones al mismo dominio (consulta respetuosa) y caché en memoria.
export const USER_AGENT = process.env.FJ_USER_AGENT ??
    "fuentes-juridicas-mcp/0.1 (consulta puntual; +https://github.com/)";
const TIMEOUT_MS = Number(process.env.FJ_TIMEOUT_MS ?? 30000);
const MIN_INTERVAL_MS = Number(process.env.FJ_MIN_INTERVAL_MS ?? 1000);
const CACHE_TTL_MS = Number(process.env.FJ_CACHE_TTL_MS ?? 30 * 60 * 1000);
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const lastRequestByHost = new Map();
const cache = new Map();
export class SourceError extends Error {
    url;
    status;
    constructor(message, url, status) {
        super(message);
        this.url = url;
        this.status = status;
    }
}
async function throttle(host) {
    const last = lastRequestByHost.get(host) ?? 0;
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0)
        await new Promise((r) => setTimeout(r, wait));
    lastRequestByHost.set(host, Date.now());
}
export async function request(url, opts = {}) {
    const method = opts.method ?? "GET";
    const key = `${method} ${url} ${opts.body ?? ""} ${JSON.stringify(opts.headers ?? {})}`;
    if (!opts.noCache) {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS)
            return hit.value;
    }
    const host = new URL(url).host;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        await throttle(host);
        try {
            const res = await fetch(url, {
                method,
                headers: { "User-Agent": USER_AGENT, "Accept-Language": "es-ES,es;q=0.9", ...opts.headers },
                body: opts.body,
                redirect: opts.redirect ?? "follow",
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (RETRY_STATUS.has(res.status) && attempt < 2) {
                await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
                continue;
            }
            const body = Buffer.from(await res.arrayBuffer());
            const result = {
                status: res.status,
                url: res.url || url,
                headers: res.headers,
                body,
                text: () => body.toString("utf-8"),
            };
            const ok = (res.status >= 200 && res.status < 300) || opts.okStatus?.includes(res.status);
            if (!ok) {
                throw new SourceError(`HTTP ${res.status} al consultar ${url}`, url, res.status);
            }
            if (!opts.noCache)
                cache.set(key, { at: Date.now(), value: result });
            return result;
        }
        catch (err) {
            lastErr = err;
            if (err instanceof SourceError)
                throw err;
            if (attempt < 2)
                await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new SourceError(`No se pudo conectar con ${host}: ${msg}`, url);
}
/** Cookie jar mínimo para los flujos con sesión (TC, CENDOJ). */
export class CookieJar {
    cookies = new Map();
    absorb(res) {
        const set = res.headers.getSetCookie?.() ?? [];
        for (const c of set) {
            const [pair] = c.split(";");
            const i = pair.indexOf("=");
            if (i > 0)
                this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
    }
    header() {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }
}
