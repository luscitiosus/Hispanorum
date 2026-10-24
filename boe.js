// BOE: API oficial de datos abiertos (https://www.boe.es/datosabiertos/api/api.php)
// - Legislación consolidada (estatal y autonómica): búsqueda, metadatos, índice y texto por bloques.
// - Sumario diario del BOE.
// - Documento del diario por identificador (BOE-A-AAAA-NNNNN), vía su XML oficial.
import * as cheerio from "cheerio";
import { request, SourceError } from "./http.js";
import { normalize } from "./text.js";
const API = "https://www.boe.es/datosabiertos/api";
const JSON_H = { Accept: "application/json" };
const XML_H = { Accept: "application/xml" };
export const BOE_ID_RE = /^BOE-[A-Z]-\d{4}-\d+$/;
export function assertBoeId(id) {
    const clean = id.trim().toUpperCase();
    if (!BOE_ID_RE.test(clean)) {
        throw new SourceError(`Identificador BOE no válido: "${id}". Formato esperado: BOE-A-2018-16673.`);
    }
    return clean;
}
function unwrap(json) {
    if (json?.status && String(json.status.code) !== "200") {
        throw new SourceError(`La API del BOE respondió: ${json.status.text ?? json.status.code}`);
    }
    return json?.data;
}
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
function toResumen(d) {
    return {
        identificador: d.identificador,
        titulo: d.titulo,
        rango: d.rango?.texto,
        ambito: d.ambito?.texto,
        departamento: d.departamento?.texto,
        fecha_disposicion: d.fecha_disposicion,
        fecha_publicacion: d.fecha_publicacion,
        fecha_actualizacion: d.fecha_actualizacion,
        vigencia_agotada: d.vigencia_agotada,
        estado_consolidacion: d.estado_consolidacion?.texto,
        url_eli: d.url_eli,
        url_html_consolidada: d.url_html_consolidada,
    };
}
export function buildBoeQuery(b) {
    const q = { query: { query_string: { query: b.consulta } }, sort: [{ fecha_publicacion: "desc" }] };
    if (b.desde || b.hasta) {
        q.query.range = { fecha_publicacion: { ...(b.desde && { gte: b.desde }), ...(b.hasta && { lte: b.hasta }) } };
    }
    return JSON.stringify(q);
}
export async function buscarLegislacion(b) {
    // Ámbito y rango se filtran en cliente: pedimos más resultados para compensar.
    const filtering = Boolean(b.ambito || b.rango);
    const limit = filtering ? Math.min(b.limite * 5, 200) : b.limite;
    const params = new URLSearchParams({ query: buildBoeQuery(b), limit: String(limit), offset: String(b.offset) });
    const url = `${API}/legislacion-consolidada?${params}`;
    let res;
    try {
        res = await request(url, { headers: JSON_H });
    }
    catch (e) {
        if (e instanceof SourceError && e.status && e.status >= 500) {
            throw new SourceError(`El buscador de la API de legislación consolidada del BOE ha devuelto HTTP ${e.status}. ` +
                `Es un fallo conocido e intermitente del servidor del BOE. Alternativas: usa boe_sumario por fecha, ` +
                `boe_documento / boe_texto_consolidado si conoces el identificador, o busca a mano en ` +
                `https://www.boe.es/buscar/legislacion.php y pásame el identificador BOE-A-…`, url, e.status);
        }
        throw e;
    }
    let resultados = asArray(unwrap(JSON.parse(res.text()))).map(toResumen);
    if (b.ambito) {
        const want = b.ambito.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        resultados = resultados.filter((r) => (r.ambito ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() === want);
    }
    if (b.rango) {
        const want = b.rango.toLowerCase();
        resultados = resultados.filter((r) => (r.rango ?? "").toLowerCase().includes(want));
    }
    return { url, resultados: resultados.slice(0, b.limite) };
}
export async function metadatos(id) {
    const url = `${API}/legislacion-consolidada/id/${assertBoeId(id)}/metadatos`;
    const data = asArray(unwrap(JSON.parse((await request(url, { headers: JSON_H })).text())));
    if (!data.length)
        throw new SourceError(`El BOE no tiene metadatos consolidados para ${id}.`, url);
    return { ...toResumen(data[0]), url };
}
export function parseIndice(json) {
    const data = unwrap(json);
    const holder = Array.isArray(data) ? data[0] : data;
    return asArray(holder?.bloque).map((b) => ({
        id: b.id,
        titulo: b.titulo,
        fecha_actualizacion: b.fecha_actualizacion,
    }));
}
export async function indice(id) {
    const url = `${API}/legislacion-consolidada/id/${assertBoeId(id)}/texto/indice`;
    return { url, bloques: parseIndice(JSON.parse((await request(url, { headers: JSON_H })).text())) };
}
/** Interpreta el XML de /texto o /texto/bloque/{id}. */
export function parseBloquesXml(xml) {
    const $ = cheerio.load(xml, { xml: true });
    const out = [];
    $("bloque").each((_, el) => {
        const b = $(el);
        const versiones = [];
        b.children("version").each((_, v) => {
            const ver = $(v);
            const parrafos = [];
            ver.children().each((_, child) => {
                const c = $(child);
                if (c.is("blockquote")) {
                    c.find("p").each((_, p) => {
                        parrafos.push("    " + normalize($(p).text()));
                    });
                }
                else if (c.is("table")) {
                    c.find("tr").each((_, tr) => {
                        parrafos.push($(tr)
                            .find("td,th")
                            .map((_, td) => normalize($(td).text()))
                            .get()
                            .join(" | "));
                    });
                }
                else {
                    parrafos.push(normalize(c.text()));
                }
            });
            versiones.push({
                id_norma: ver.attr("id_norma"),
                fecha_publicacion: ver.attr("fecha_publicacion"),
                fecha_vigencia: ver.attr("fecha_vigencia"),
                texto: parrafos.filter(Boolean).join("\n"),
            });
        });
        out.push({ id: b.attr("id") ?? "", tipo: b.attr("tipo"), titulo: b.attr("titulo"), versiones });
    });
    return out;
}
export function fechaBonita(f) {
    if (!f || !/^\d{8}/.test(f))
        return f;
    return `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(0, 4)}`;
}
export function renderBloque(b, historico) {
    const versiones = historico ? b.versiones : b.versiones.slice(-1);
    const parts = versiones.map((v) => {
        const head = [
            v.fecha_vigencia && `vigente desde ${fechaBonita(v.fecha_vigencia)}`,
            v.id_norma && `redacción dada por ${v.id_norma}`,
        ]
            .filter(Boolean)
            .join(", ");
        return (head ? `[Versión ${head}]\n` : "") + v.texto;
    });
    let txt = parts.join("\n\n");
    if (!historico && b.versiones.length > 1) {
        txt += `\n\n[Este precepto tiene ${b.versiones.length} versiones; se muestra la última. Usa historico=true para ver todas.]`;
    }
    return txt;
}
export async function textoConsolidado(id, bloqueId) {
    const base = `${API}/legislacion-consolidada/id/${assertBoeId(id)}/texto`;
    const url = bloqueId ? `${base}/bloque/${encodeURIComponent(bloqueId)}` : base;
    const xml = (await request(url, { headers: XML_H })).text();
    const bloques = parseBloquesXml(xml);
    if (!bloques.length)
        throw new SourceError(`El BOE no devolvió texto consolidado para ${id}${bloqueId ? ` (bloque ${bloqueId})` : ""}.`, url);
    return { url, bloques };
}
/** Normaliza "14", "14 bis", "art. 14", "Artículo 14" → "14 bis". */
export function normalizaArticulo(n) {
    return n
        .toLowerCase()
        .replace(/^(art[íi]culo|art\.?)\s*/i, "")
        .replace(/\.$/, "")
        .replace(/\s+/g, " ")
        .trim();
}
export function encontrarArticulo(bloques, numero) {
    const n = normalizaArticulo(numero);
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^(art[íi]culo|art\\.)\\s+${esc}(\\.|\\s*$|\\s*[-–—:]|\\s+\\()`, "i");
    return bloques.find((b) => re.test(b.titulo.trim()));
}
export function parseSumario(json) {
    const data = unwrap(json);
    const items = [];
    for (const diario of asArray(data?.sumario?.diario)) {
        for (const sec of asArray(diario.seccion)) {
            for (const dep of asArray(sec.departamento)) {
                const push = (it, epigrafe) => items.push({
                    identificador: it.identificador,
                    titulo: it.titulo,
                    seccion: sec.nombre,
                    seccion_codigo: sec.codigo,
                    departamento: dep.nombre,
                    epigrafe,
                    url_html: it.url_html,
                    url_pdf: typeof it.url_pdf === "object" ? it.url_pdf?.texto : it.url_pdf,
                });
                for (const it of asArray(dep.item))
                    push(it);
                for (const ep of asArray(dep.epigrafe))
                    for (const it of asArray(ep.item))
                        push(it, ep.nombre);
            }
        }
    }
    return items;
}
export async function sumario(fecha) {
    const f = fecha.replace(/-/g, "");
    if (!/^\d{8}$/.test(f))
        throw new SourceError(`Fecha no válida "${fecha}". Usa AAAAMMDD o AAAA-MM-DD.`);
    const url = `${API}/boe/sumario/${f}`;
    try {
        return { url, items: parseSumario(JSON.parse((await request(url, { headers: JSON_H })).text())) };
    }
    catch (e) {
        if (e instanceof SourceError && e.status === 404) {
            throw new SourceError(`No hay BOE publicado el ${f} (domingo o festivo, o fecha futura).`, url, 404);
        }
        throw e;
    }
}
export function parseDocumentoXml(xml, id) {
    const $ = cheerio.load(xml, { xml: true });
    const m = $("metadatos");
    const get = (tag) => normalize(m.children(tag).first().text()) || undefined;
    const textoEl = $("documento > texto").first().length ? $("documento > texto").first() : $("texto").first();
    const lines = [];
    textoEl.children().each((_, el) => {
        const c = $(el);
        if (c.is("table")) {
            c.find("tr").each((_, tr) => {
                lines.push($(tr).find("td,th").map((_, td) => normalize($(td).text())).get().join(" | "));
            });
        }
        else
            lines.push(normalize(c.text()));
    });
    const pdf = get("url_pdf");
    return {
        identificador: get("identificador") ?? id,
        titulo: get("titulo"),
        rango: get("rango"),
        departamento: get("departamento"),
        fecha_disposicion: get("fecha_disposicion"),
        fecha_publicacion: get("fecha_publicacion"),
        diario_numero: get("diario_numero"),
        url_eli: get("url_eli"),
        url_pdf: pdf ? (pdf.startsWith("http") ? pdf : `https://www.boe.es${pdf}`) : undefined,
        url_html: `https://www.boe.es/diario_boe/txt.php?id=${id}`,
        texto: lines.filter(Boolean).join("\n"),
    };
}
export async function documentoDiario(id) {
    const clean = assertBoeId(id);
    const url = `https://www.boe.es/diario_boe/xml.php?id=${clean}`;
    const xml = (await request(url, { headers: XML_H })).text();
    if (!/<documento/i.test(xml))
        throw new SourceError(`El BOE no devolvió el documento ${clean}.`, url);
    return parseDocumentoXml(xml, clean);
}
