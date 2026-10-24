// Tribunal Constitucional: buscador oficial de jurisprudencia (hj.tribunalconstitucional.es).
// No tiene API: es HTML servido por ASP.NET MVC. Se usan dos flujos:
//  - GET /es/Resolucion/Show/{id}  (id interno secuencial)
//  - Búsqueda por número/año: token del formulario → POST /es/Busqueda/Buscar → GET /es/Resolucion/List
// (flujo documentado y verificado por el proyecto es-eli-mcp, Apache-2.0).
import * as cheerio from "cheerio";
import { CookieJar, request, SourceError } from "./http.js";
import { htmlToText, normalize } from "./text.js";
const BASE = "https://hj.tribunalconstitucional.es";
export function parseResolucionTC(html, id) {
    const $ = cheerio.load(html);
    const pageTitle = $("title").text();
    if (/Buscador de jurisprudencia constitucional/i.test(pageTitle) || !/Resoluci/i.test(pageTitle)) {
        throw new SourceError(`No existe ninguna resolución del TC con id interno ${id}.`);
    }
    const h2 = $("#resolucion-identifier h2").first();
    const boe = normalize(h2.find("span").text()).replace(/^\(|\)$/g, "") || undefined;
    h2.find("span").remove();
    const titulo = normalize(h2.text()) || undefined;
    const ecli = normalize($("label.ecli").first().text()) || undefined;
    const cabecera = normalize($("#resolucion-cabecera").text());
    const sala = cabecera.match(/(Pleno|Sala Primera|Sala Segunda|Sección (?:Primera|Segunda|Tercera|Cuarta))/)?.[1];
    const texto = htmlToText($.html("#complete_resolucion") ?? "");
    if (!texto)
        throw new SourceError(`La página de la resolución ${id} no contiene texto.`);
    return { id, titulo, ecli, boe, sala, url: `${BASE}/es/Resolucion/Show/${id}`, texto };
}
export async function resolucionPorId(id) {
    if (!/^\d+$/.test(id))
        throw new SourceError(`El id interno del TC es numérico (p. ej. 25015); recibido "${id}".`);
    const url = `${BASE}/es/Resolucion/Show/${id}`;
    const res = await request(url, { headers: { Accept: "text/html" } });
    return parseResolucionTC(res.text(), id);
}
/** ECLI:ES:TC:2016:117 → sentencia 117/2016; sufijo A = auto, D = declaración. */
export function parseEcliTC(ecli) {
    const m = ecli.trim().toUpperCase().match(/^ECLI:ES:TC:(\d{4}):(\d+)([AD]?)$/);
    if (!m)
        return undefined;
    const tipo = m[3] === "A" ? "AUTO" : m[3] === "D" ? "DECLARACION" : "SENTENCIA";
    return { tipo, numero: m[2], anno: m[1] };
}
/** "STC 31/2010", "ATC 40/2020", "DTC 1/2004" → partes. */
export function parseCitaTC(cita) {
    const m = cita.trim().toUpperCase().match(/^(STC|ATC|DTC|SENTENCIA|AUTO|DECLARACI[OÓ]N)\s*(\d+)\s*\/\s*(\d{4})/);
    if (!m)
        return undefined;
    const t = m[1];
    const tipo = t.startsWith("A") ? "AUTO" : t.startsWith("D") ? "DECLARACION" : "SENTENCIA";
    return { tipo, numero: m[2], anno: m[3] };
}
export async function idPorNumero(tipo, numero, anno) {
    const jar = new CookieJar();
    const index = await request(`${BASE}/es/Busqueda/Index`, { headers: { Accept: "text/html" }, noCache: true });
    jar.absorb(index);
    const token = index.text().match(/name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]*)"/)?.[1];
    if (!token)
        throw new SourceError("No se encontró el token del formulario de búsqueda del TC (¿ha cambiado la web?).");
    const body = new URLSearchParams({
        __RequestVerificationToken: token,
        TIPO_RESOLUCION: tipo,
        NUMERO_RESOLUCION: numero,
        ANNO_RESOLUCION: anno,
    }).toString();
    const post = await request(`${BASE}/es/Busqueda/Buscar`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
        body,
        redirect: "manual",
        noCache: true,
        okStatus: [302],
    });
    jar.absorb(post);
    const list = await request(`${BASE}/es/Resolucion/List`, {
        headers: { Accept: "text/html", Cookie: jar.header() },
        noCache: true,
    });
    const html = list.text();
    const re = /href="[^"]*Resolucion\/Show\/(\d+)"[^>]*>\s*([^<]*)/g;
    for (const m of html.matchAll(re)) {
        const label = m[2].toUpperCase();
        if (label.includes(`${numero}/${anno}`))
            return m[1];
    }
    throw new SourceError(`El buscador del TC no encontró ${tipo} ${numero}/${anno}.`);
}
