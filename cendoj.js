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
export function parseResultados(html) {
    const $ = cheerio.load(html);
    const resultados = [];
    $("div.searchresult").each((_, el) => {
        const card = $(el);
        const links = card.find("div.title a, a[id^='ref-']");
        const a = card.find("a[id^='ref-']").first().length ? card.find("a[id^='ref-']").first() : links.last();
        const href = a.attr("href");
        const url = href ? new URL(href, `${BASE}/search/`).toString() : undefined;
        const referencia = href?.match(/openDocument\/([^/]+)/)?.[1] ?? a.attr("id")?.replace(/^ref-/, "");
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
            ecli: metadatos["ECLI"] ?? normalize(card.text()).match(/ECLI:ES:[A-Z]+:\d{4}:\d+[A-Z]?/)?.[0],
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
export function urlPdf(referencia) {
    return `${BASE}/search/contenidos.action?action=accessToPDF&reference=${encodeURIComponent(referencia)}&encode=true`;
}
export async function textoResolucion(referencia) {
    if (!/^[A-Za-z0-9]+$/.test(referencia)) {
        throw new SourceError(`Referencia CENDOJ no válida: "${referencia}" (es el código alfanumérico que devuelve cendoj_buscar).`);
    }
    const url = urlPdf(referencia);
    const res = await request(url, { headers: { Accept: "application/pdf,*/*", Referer: INDEX } });
    if (res.body.subarray(0, 5).toString() !== "%PDF-") {
        throw new SourceError(`CENDOJ no devolvió un PDF para la referencia ${referencia} (puede que la web haya cambiado o que haya limitado las consultas).`, url);
    }
    const texto = await pdfToText(res.body);
    if (!texto)
        throw new SourceError(`El PDF de ${referencia} no contiene texto extraíble (¿escaneado?).`, url);
    return { url, texto };
}
export const urlDocumento = (referencia) => `${BASE}/search/AN/openDocument/${referencia}`;
