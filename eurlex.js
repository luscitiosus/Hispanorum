// Derecho de la UE y jurisprudencia del TJUE a través de la Oficina de Publicaciones:
//  - Metadatos y búsqueda: endpoint SPARQL oficial de CELLAR
//    (https://publications.europa.eu/webapi/rdf/sparql).
//  - Texto: negociación de contenido de CELLAR (/resource/celex/{CELEX}) y, si falla,
//    la página HTML de EUR-Lex (/legal-content/ES/TXT/HTML/?uri=CELEX:...).
// La jurisprudencia del TJUE (Tribunal de Justicia y Tribunal General) se publica en
// CELLAR/EUR-Lex con CELEX del sector 6, que es la vía legible por máquina; CURIA no
// ofrece API y solo se enlaza como referencia.
import * as cheerio from "cheerio";
import { request, SourceError } from "./http.js";
import { htmlToText, pdfToText } from "./text.js";
const SPARQL = "https://publications.europa.eu/webapi/rdf/sparql";
const SPA = "http://publications.europa.eu/resource/authority/language/SPA";
export const CELEX_RE = /^[0-9CE]\d{4}[A-Z]{1,2}\d{4}(\(\d+\))?(R\(\d+\))?$/;
export function assertCelex(celex) {
    const c = celex.trim().toUpperCase().replace(/^CELEX:/, "");
    if (!CELEX_RE.test(c)) {
        throw new SourceError(`Número CELEX no válido: "${celex}". Ejemplos: 32016R0679 (RGPD), 62014CJ0362 (Schrems).`);
    }
    return c;
}
export const urlEurLex = (celex) => `https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:${celex}`;
const urlEurLexHtml = (celex) => `https://eur-lex.europa.eu/legal-content/ES/TXT/HTML/?uri=CELEX:${celex}`;
export async function sparql(query) {
    const res = await request(SPARQL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/sparql-results+json",
        },
        body: new URLSearchParams({ query, format: "application/sparql-results+json", timeout: "30000" }).toString(),
    });
    const json = JSON.parse(res.text());
    return (json.results?.bindings ?? []).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
/** Convierte texto libre en expresión bif:contains de Virtuoso: palabras unidas con AND. */
export function bifContains(texto) {
    const words = texto
        .replace(/["'()*]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !/^(del|las|los|por|para|con|una|que|the|and)$/i.test(w));
    if (!words.length)
        throw new SourceError("La búsqueda necesita al menos una palabra de 3 o más letras.");
    return words.map((w) => `"${w.replace(/'/g, "")}"`).join(" AND ");
}
export function buildSearchQuery(texto, tipo, desde, hasta, limite = 10) {
    const sector = tipo === "jurisprudencia"
        ? `FILTER(STRSTARTS(STR(?celex), "6"))`
        : tipo === "legislacion"
            ? `FILTER(STRSTARTS(STR(?celex), "3") || STRSTARTS(STR(?celex), "1") || STRSTARTS(STR(?celex), "2"))`
            : "";
    const fechas = [
        desde && `FILTER(?fecha >= "${esc(desde)}"^^xsd:date)`,
        hasta && `FILTER(?fecha <= "${esc(hasta)}"^^xsd:date)`,
    ]
        .filter(Boolean)
        .join("\n  ");
    return `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?celex ?titulo ?fecha ?ecli WHERE {
  ?exp cdm:expression_title ?titulo .
  ?titulo bif:contains '${bifContains(texto)}' .
  ?exp cdm:expression_uses_language <${SPA}> ;
       cdm:expression_belongs_to_work ?work .
  ?work cdm:resource_legal_id_celex ?celex .
  ${sector}
  FILTER NOT EXISTS { ?work cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/CORRIGENDUM> }
  OPTIONAL { ?work cdm:work_date_document ?fecha }
  OPTIONAL { ?work cdm:case-law_ecli ?ecli }
  ${fechas}
}
ORDER BY DESC(?fecha)
LIMIT ${Math.min(Math.max(limite, 1), 50)}`;
}
const toDoc = (r) => ({
    celex: r.celex,
    titulo: r.titulo,
    fecha: r.fecha,
    ecli: r.ecli,
    url: urlEurLex(r.celex),
});
export async function buscar(texto, tipo, desde, hasta, limite = 10) {
    return (await sparql(buildSearchQuery(texto, tipo, desde, hasta, limite))).map(toDoc);
}
export async function metadatos(celex) {
    const c = assertCelex(celex);
    const rows = await sparql(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?celex ?titulo ?fecha ?ecli ?en_vigor ?eli WHERE {
  VALUES ?celex { "${c}"^^xsd:string "${c}" }
  ?work cdm:resource_legal_id_celex ?celex .
  OPTIONAL { ?exp cdm:expression_belongs_to_work ?work ;
                  cdm:expression_uses_language <${SPA}> ;
                  cdm:expression_title ?titulo . }
  OPTIONAL { ?work cdm:work_date_document ?fecha }
  OPTIONAL { ?work cdm:case-law_ecli ?ecli }
  OPTIONAL { ?work cdm:resource_legal_in-force ?en_vigor }
  OPTIONAL { ?work cdm:resource_legal_eli ?eli }
} LIMIT 1`);
    if (!rows.length)
        throw new SourceError(`CELLAR no tiene ningún documento con CELEX ${c}.`);
    return { ...toDoc({ ...rows[0], celex: c }), en_vigor: rows[0].en_vigor, eli: rows[0].eli };
}
export async function celexPorEcli(ecli) {
    const e = ecli.trim().toUpperCase();
    if (!/^ECLI:EU:[CTF]:\d{4}:\d+$/.test(e))
        throw new SourceError(`ECLI del TJUE no válido: "${ecli}" (ej.: ECLI:EU:C:2015:650).`);
    const rows = await sparql(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?celex WHERE {
  VALUES ?e { "${e}"^^xsd:string "${e}" }
  ?work cdm:case-law_ecli ?e ; cdm:resource_legal_id_celex ?celex .
}`);
    return rows.map((r) => r.celex);
}
/**
 * Asunto "C-362/14" → CELEX candidatos (sentencia, conclusiones AG, auto).
 * Regla documentada de EUR-Lex: 6 + año + código de documento + número a 4 cifras.
 */
export function celexPorAsunto(asunto) {
    const m = asunto.trim().toUpperCase().replace(/\s+/g, "").match(/^([CTF])-(\d{1,4})\/(\d{2}|\d{4})(P)?$/);
    if (!m)
        throw new SourceError(`Número de asunto no válido: "${asunto}". Formato: C-362/14 o T-201/04.`);
    const [, letra, num, y] = m;
    const anno = y.length === 4 ? y : Number(y) >= 54 ? `19${y}` : `20${y}`;
    const n = num.padStart(4, "0");
    const base = `6${anno}`;
    if (letra === "C") {
        return {
            tribunal: "Tribunal de Justicia",
            candidatos: { sentencia: `${base}CJ${n}`, conclusiones_abogado_general: `${base}CC${n}`, auto: `${base}CO${n}` },
        };
    }
    if (letra === "T") {
        return { tribunal: "Tribunal General", candidatos: { sentencia: `${base}TJ${n}`, auto: `${base}TO${n}` } };
    }
    return { tribunal: "Tribunal de la Función Pública", candidatos: { sentencia: `${base}FJ${n}`, auto: `${base}FO${n}` } };
}
export const urlCuria = (asunto) => `https://curia.europa.eu/juris/liste.jsf?num=${encodeURIComponent(asunto.trim().toUpperCase())}&language=es`;
const HTML_ACCEPT = "application/xhtml+xml, text/html;q=0.9, application/pdf;q=0.5";
async function fromResponse(body, contentType) {
    if (contentType?.includes("pdf") || body.subarray(0, 5).toString() === "%PDF-")
        return pdfToText(body);
    return htmlToText(body.toString("utf-8"));
}
/** Texto en español de un documento por CELEX. */
export async function texto(celex) {
    const c = assertCelex(celex);
    const cellar = `https://publications.europa.eu/resource/celex/${c}`;
    const errores = [];
    try {
        const res = await request(cellar, {
            headers: { Accept: HTML_ACCEPT, "Accept-Language": "spa, es" },
            okStatus: [300],
        });
        if (res.status === 300) {
            // Varias manifestaciones (p. ej. un acto con anexos): se concatenan.
            const $ = cheerio.load(res.text());
            const links = $("a[href]").map((_, a) => $(a).attr("href")).get().filter((h) => h.startsWith("http"));
            const partes = [];
            for (const href of links.slice(0, 10)) {
                const r = await request(href, { headers: { Accept: HTML_ACCEPT, "Accept-Language": "spa, es" } });
                partes.push(await fromResponse(r.body, r.headers.get("content-type")));
            }
            if (partes.join("").trim())
                return { url: urlEurLex(c), texto: partes.join("\n\n──── documento siguiente ────\n\n"), via: "CELLAR" };
        }
        else {
            const t = await fromResponse(res.body, res.headers.get("content-type"));
            if (t.length > 200)
                return { url: urlEurLex(c), texto: t, via: "CELLAR" };
        }
    }
    catch (e) {
        errores.push(`CELLAR: ${e.message}`);
    }
    try {
        const res = await request(urlEurLexHtml(c), { headers: { Accept: "text/html" } });
        const t = htmlToText(res.text());
        if (res.status === 202 || t.length < 200) {
            throw new SourceError("EUR-Lex respondió con una página de verificación antibots o vacía");
        }
        return { url: urlEurLex(c), texto: t, via: "EUR-Lex" };
    }
    catch (e) {
        errores.push(`EUR-Lex: ${e.message}`);
    }
    throw new SourceError(`No se pudo obtener el texto en español de ${c}. ${errores.join(" | ")}. ` +
        `Puede que no exista versión española (frecuente en autos y documentos antiguos del TJUE). Consulta: ${urlEurLex(c)}`);
}
