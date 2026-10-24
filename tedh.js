// Tribunal Europeo de Derechos Humanos: base oficial HUDOC (hudoc.echr.coe.int).
// HUDOC no publica una API documentada, pero su propia web consulta dos servicios JSON/HTML
// que usan proyectos académicos como echr-extractor (Universidad de Maastricht):
//  - Búsqueda: /app/query/results?query=…&select=…&sort=…&start=…&length=…
//  - Texto:    /app/conversion/docx/html/body?library=ECHR&id={itemid}
// HUDOC está tras Cloudflare, que rechaza clientes sin un User-Agent de tipo navegador.
import { request, SourceError } from "./http.js";
import { htmlToText } from "./text.js";
const BASE = "https://hudoc.echr.coe.int";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; fuentes-juridicas-mcp/0.1)",
    Accept: "application/json, text/html;q=0.9",
};
const SELECT = [
    "itemid", "docname", "appno", "ecli", "kpdate", "judgementdate", "respondent", "article",
    "conclusion", "importance", "languageisocode", "doctypebranch", "documentcollectionid2",
].join(",");
export const COLECCIONES = {
    sentencias: '(documentcollectionid2:"JUDGMENTS")',
    decisiones: '(documentcollectionid2:"DECISIONS")',
    todo: '(documentcollectionid2:"JUDGMENTS" OR documentcollectionid2:"DECISIONS")',
};
const q = (s) => `"${s.replace(/"/g, "")}"`;
const campo = (k, v) => `((${k}=${q(v)}) OR (${k}:${q(v)}))`;
export function buildQuery(b) {
    const parts = [
        "contentsitename:ECHR",
        "(NOT (doctype=PR OR doctype=HFCOMOLD OR doctype=HECOMOLD))",
        COLECCIONES[b.tipo],
    ];
    if (b.texto)
        parts.push(`(${b.texto.replace(/[()]/g, " ")})`);
    if (b.demandado)
        parts.push(campo("respondent", b.demandado.toUpperCase()));
    if (b.numero_demanda)
        parts.push(campo("appno", b.numero_demanda));
    if (b.ecli)
        parts.push(campo("ecli", b.ecli.toUpperCase()));
    if (b.articulo)
        parts.push(campo("article", b.articulo));
    if (b.idioma)
        parts.push(campo("languageisocode", b.idioma));
    if (b.gran_sala)
        parts.push(campo("doctypebranch", "GRANDCHAMBER"));
    if (b.desde || b.hasta) {
        parts.push(`(kpdate>="${b.desde ?? "1959-01-01"}" AND kpdate<="${b.hasta ?? new Date().toISOString().slice(0, 10)}")`);
    }
    return parts.join(" AND ");
}
export const urlHudoc = (itemid) => `${BASE}/eng?i=${itemid}`;
export function parseResultados(json) {
    const resultados = (json?.results ?? []).map((r) => {
        const c = r.columns ?? {};
        return {
            itemid: c.itemid,
            titulo: c.docname,
            demanda: c.appno || undefined,
            ecli: c.ecli || undefined,
            fecha: (c.judgementdate || c.kpdate || "").slice(0, 10) || undefined,
            demandado: c.respondent || undefined,
            articulos: c.article || undefined,
            conclusion: c.conclusion || undefined,
            importancia: c.importance || undefined,
            idioma: c.languageisocode || undefined,
            formacion: c.doctypebranch || undefined,
            url: urlHudoc(c.itemid),
        };
    });
    return { total: Number(json?.resultcount ?? resultados.length), resultados };
}
export async function buscar(b) {
    const params = new URLSearchParams({
        query: buildQuery(b),
        select: SELECT,
        sort: "kpdate Descending",
        start: String(b.inicio),
        length: String(b.limite),
    });
    const url = `${BASE}/app/query/results?${params}`;
    const res = await request(url, { headers: HEADERS });
    let json;
    try {
        json = JSON.parse(res.text());
    }
    catch {
        throw new SourceError("HUDOC no devolvió JSON (posible verificación antibots de Cloudflare).", url);
    }
    return { ...parseResultados(json), url };
}
export async function documento(itemid) {
    const id = itemid.trim();
    if (!/^\d{3}-\d+$/.test(id))
        throw new SourceError(`Identificador HUDOC no válido: "${itemid}" (formato 001-57574).`);
    const url = `${BASE}/app/conversion/docx/html/body?library=ECHR&id=${id}`;
    const res = await request(url, { headers: HEADERS });
    const texto = htmlToText(res.text());
    if (texto.length < 200) {
        throw new SourceError(`HUDOC no tiene texto para ${id} (algunos documentos solo existen como PDF o resumen). Consúltalo en ${urlHudoc(id)}`, url);
    }
    return { url: urlHudoc(id), texto };
}
