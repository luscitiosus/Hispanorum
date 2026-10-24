// CENDOJ (buscador de jurisprudencia del CGPJ, www.poderjudicial.es/search).
// No hay API pública: se reproduce la misma petición que hace el formulario web
// (POST /search/search.action) y el texto se obtiene del PDF oficial
// (contenidos.action?action=accessToPDF). Formato de campos tomado del proyecto
// abierto PoderJudicialMCPServer (MIT).
//
// Aviso legal del CGPJ: consulta solo para uso particular, sin descarga masiva ni
// creación de bases de datos. Este módulo hace una consulta por petición.
import * as cheerio from "cheerio";
import { CookieJar, request, SourceError } from "./http.js";
import { normalize, pdfToText } from "./text.js";
const BASE = "https://www.poderjudicial.es";
const INDEX = `${BASE}/search/indexAN.jsp`;
export const RESULTADOS_POR_PAGINA = 10;
export const JURISDICCIONES = ["CIVIL", "PENAL", "CONTENCIOSO", "SOCIAL", "MILITAR", "ESPECIAL"];
export const COMUNIDADES = [
    "ANDALUCÍA", "ARAGÓN", "ASTURIAS", "BALEARES", "CANARIAS", "CANTABRIA", "CASTILLA LA MANCHA",
    "CASTILLA Y LEÓN", "CATALUÑA", "CEUTA", "COMUNIDAD VALENCIANA", "EXTREMADURA", "GALICIA",
    "LA RIOJA", "PAÍS VASCO", "NAVARRA", "MURCIA", "MELILLA", "MADRID",
];
export const ORGANOS = {
    TRIBUNAL_SUPREMO: "11|12|13|14|15|16",
    TS_CIVIL: "11",
    TS_PENAL: "12",
    TS_CONTENCIOSO: "13",
    TS_SOCIAL: "14",
    TS_MILITAR: "15",
    AUDIENCIA_NACIONAL: "22|2264|23|24|25|26|27|28|29",
    AN_PENAL: "22",
    AN_APELACION: "2264",
    AN_CONTENCIOSO: "23",
    AN_SOCIAL: "24",
    TSJ: "31|31201202|33|34",
    TSJ_CIVIL_PENAL: "31",
    TSJ_APELACION_PENAL: "31201202",
    TSJ_CONTENCIOSO: "33",
    TSJ_SOCIAL: "34",
    AUDIENCIA_PROVINCIAL: "37",
    AP_JURADO: "38",
    JUZGADO_PRIMERA_INSTANCIA: "42",
    JUZGADO_INSTRUCCION: "43",
    JUZGADO_PRIMERA_INSTANCIA_INSTRUCCION: "41",
    JUZGADO_CONTENCIOSO: "45",
    JUZGADO_MERCANTIL: "47",
    JUZGADO_VIOLENCIA_MUJER: "48",
    JUZGADO_PENAL: "51",
    JUZGADO_SOCIAL: "44",
    JUZGADO_MENORES: "53",
    JUZGADO_VIGILANCIA_PENITENCIARIA: "52",
};
const isoToEs = (d) => {
    if (!d)
        return "";
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};
export function buildPayload(b) {
    const start = (b.pagina - 1) * RESULTADOS_POR_PAGINA + 1;
    const p = {
        action: "query",
        sort: "IN_FECHARESOLUCION:decreasing",
        recordsPerPage: String(RESULTADOS_POR_PAGINA),
        databasematch: b.soloSupremo ? "TS" : "AN",
        start: String(start),
        TEXT: b.texto ?? "",
        FECHARESOLUCIONDESDE: isoToEs(b.desde),
        FECHARESOLUCIONHASTA: isoToEs(b.hasta),
    };
    if (b.roj)
        p.ROJ = b.roj;
    if (b.ecli)
        p.ECLI = b.ecli;
    if (b.comunidades?.length)
        p.VALUESCOMUNIDAD = b.comunidades.map((c) => `${c}(C) | `).join("");
    if (b.jurisdicciones?.length)
        p.JURISDICCION = b.jurisdicciones.map((j) => `|${j}|`).join("");
    if (b.organos?.length) {
        p.TIPOORGANOPUB = "|" + b.organos.map((o) => {
            const code = ORGANOS[o];
            if (!code)
                throw new SourceError(`Órgano desconocido "${o}". Valores: ${Object.keys(ORGANOS).join(", ")}`);
            return code;
        }).join("|") + "|";
    }
    return p;
}
const conPrefijoEcli = (e) => (e ? (e.startsWith("ECLI:") ? e : `ECLI:${e}`) : undefined);
export function parseResultados(html) {
    const $ = cheerio.load(html);
    const resultados = [];
    $("div.searchresult").each((_, el) => {
        const card = $(el);
        const links = card.find("div.title a, a[id^='ref-']");
        const a = card.find("a[id^='ref-']").first().length ? card.find("a[id^='ref-']").first() : links.last();
        const href = a.attr("href");
        const url = href ? new URL(href, `${BASE}/search/`).toString() : undefined;
        // Se conserva la base (TS/AN) y la fecha del enlace: la web las necesita para abrir el documento.
        const m = href?.match(/\/search\/([A-Z]+)\/openDocument\/([A-Za-z0-9]+)(?:\/(\d{8}))?/);
        const referencia = m ? [m[1], m[2], m[3]].filter(Boolean).join("/") : a.attr("id")?.replace(/^ref-/, "");
        const metadatos = {};
        card.find("div.metadatos li").each((_, li) => {
            const t = normalize($(li).text());
            const i = t.indexOf(":");
            if (i > 0)
                metadatos[t.slice(0, i).trim()] = t.slice(i + 1).trim();
        });
        const fechares = a.attr("data-fechares");
        const resumenEl = card.find("div.hddnsummary").first().length ? card.find("div.hddnsummary").first() : card.find("div.summary").first();
        const resumen = normalize(resumenEl.text())
            .replace(/^(RESUMEN|Resumen Automático):\s*/i, "")
            .replace(/\s*Ver más.*$/i, "") || undefined;
        resultados.push({
            titulo: normalize(a.text()),
            referencia,
            url,
            roj: a.attr("data-roj") ?? metadatos["Roj"] ?? metadatos["ROJ"],
            ecli: conPrefijoEcli(metadatos["ECLI"]) ?? normalize(card.text()).match(/ECLI:ES:[A-Z]+:\d{4}:\d+[A-Z]?/)?.[0],
            fecha: fechares && /^\d{8}$/.test(fechares) ? `${fechares.slice(0, 4)}-${fechares.slice(4, 6)}-${fechares.slice(6)}` : metadatos["Fecha"],
            metadatos,
            resumen,
        });
    });
    const totalTxt = normalize($.root().text()).match(/(\d[\d.]*)\s+resultados/i)?.[1];
    return { total: totalTxt ? Number(totalTxt.replace(/\./g, "")) : undefined, resultados };
}
export async function buscar(b) {
    const jar = new CookieJar();
    jar.absorb(await request(INDEX, { noCache: true }));
    const res = await request(`${BASE}/search/search.action`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Referer: INDEX,
            "X-Requested-With": "XMLHttpRequest",
            Cookie: jar.header(),
        },
        body: new URLSearchParams(buildPayload(b)).toString(),
    });
    return parseResultados(res.text());
}
/** Formatos de enlace al PDF que usa la propia web (el primero es el de sus enlaces públicos). */
export function urlsPdf(referencia) {
    const r = encodeURIComponent(referencia);
    return [
        `${BASE}/search/contenidos.action?action=accessToPDF&publicinterface=true&tab=AN&reference=${r}&encode=true&databasematch=AN`,
        `${BASE}/search/contenidos.action?action=accessToPDF&publicinterface=true&tab=TS&reference=${r}&encode=true&databasematch=TS`,
        `${BASE}/search/contenidos.action?action=accessToPDF&reference=${r}&encode=true`,
    ];
}
function diagnostico(res) {
    const tipo = res.headers.get("content-type") ?? "?";
    const html = res.body.toString("utf-8");
    const $ = cheerio.load(html);
    const scripts = $("script")
        .map((_, el) => $(el).attr("src") ?? $(el).html()?.replace(/\s+/g, " ").slice(0, 200))
        .get()
        .join(" ¦ ");
    $("script,style,head").remove();
    const visible = normalize($.root().text()).replace(/\s+/g, " ").slice(0, 300);
    return `HTTP ${res.status}, ${tipo}, ${res.body.length} bytes; texto: «${visible}»; scripts: «${scripts.slice(0, 500)}»`;
}
const isPdf = (b) => b.subarray(0, 5).toString() === "%PDF-";
/**
 * Texto de una resolución. El PDF solo se sirve dentro de la sesión del buscador,
 * así que se abre primero la página del documento (openDocument), se toma de ella
 * el enlace real al PDF y se pide con las mismas cookies.
 */
/** "TS/4801ac…/20261015" o "4801ac…" → partes. */
export function parseReferencia(ref) {
    const m = ref.trim().match(/^(?:([A-Z]+)\/)?([A-Za-z0-9]+)(?:\/(\d{8}))?$/);
    if (!m)
        throw new SourceError(`Referencia CENDOJ no válida: "${ref}" (usa el campo 'referencia' tal como lo devuelve cendoj_buscar).`);
    return { tab: m[1] ?? "AN", hash: m[2], fecha: m[3] };
}
export async function textoResolucion(refCompleta, urlDoc) {
    const { tab, hash: referencia, fecha } = parseReferencia(refCompleta);
    if (urlDoc && !urlDoc.startsWith(`${BASE}/search/`))
        throw new SourceError(`La URL debe ser de ${BASE}/search/.`);
    const docUrl = urlDoc ?? `${BASE}/search/${tab}/openDocument/${referencia}${fecha ? `/${fecha}` : ""}`;
    const intentos = [];
    const jar = new CookieJar();
    jar.absorb(await request(INDEX, { noCache: true }));
    const pedirPdf = async (url, referer) => {
        const res = await request(url, {
            headers: { Accept: "application/pdf,*/*", Referer: referer, Cookie: jar.header() },
            noCache: true,
            okStatus: [302, 403, 404],
        });
        jar.absorb(res);
        if (isPdf(res.body)) {
            const texto = await pdfToText(res.body);
            if (!texto)
                throw new SourceError(`El PDF de ${referencia} no contiene texto extraíble (¿escaneado?).`, url);
            return texto;
        }
        intentos.push(`${url} → ${diagnostico(res)}`);
        return undefined;
    };
    // 1) Página del documento y enlace real al PDF.
    const doc = await request(docUrl, { headers: { Accept: "text/html", Referer: INDEX, Cookie: jar.header() }, noCache: true, okStatus: [403, 404] });
    jar.absorb(doc);
    if (isPdf(doc.body))
        return { url: docUrl, texto: await pdfToText(doc.body) };
    const html = doc.text();
    const $ = cheerio.load(html);
    const enlaces = new Set();
    $("[href*='accessToPDF'],[data*='accessToPDF'],[src*='accessToPDF']").each((_, el) => {
        const v = $(el).attr("href") ?? $(el).attr("data") ?? $(el).attr("src");
        if (v)
            enlaces.add(new URL(v.replace(/&amp;/g, "&"), docUrl).toString());
    });
    for (const m of html.matchAll(/["']([^"'\s]*action=accessToPDF[^"'\s]*)["']/g)) {
        enlaces.add(new URL(m[1].replace(/&amp;/g, "&"), docUrl).toString());
    }
    for (const url of enlaces) {
        const texto = await pedirPdf(url, docUrl);
        if (texto)
            return { url, texto };
    }
    if (!enlaces.size)
        intentos.push(`${docUrl} → sin enlace al PDF; ${diagnostico(doc)}`);
    // 2) Enlaces directos al PDF dentro de la misma sesión.
    const directos = urlsPdf(referencia);
    for (const url of directos) {
        if (enlaces.has(url))
            continue;
        const texto = await pedirPdf(url, docUrl);
        if (texto)
            return { url, texto };
    }
    throw new SourceError(`CENDOJ no devolvió el PDF de la referencia ${referencia}. Abre la resolución en ${docUrl}. Detalle técnico: ${intentos.join(" | ")}`, directos[0]);
}
export const urlDocumento = (ref) => {
    const { tab, hash, fecha } = parseReferencia(ref);
    return `${BASE}/search/${tab}/openDocument/${hash}${fecha ? `/${fecha}` : ""}`;
};
