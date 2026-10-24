import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SourceError } from "./http.js";
import { DEFAULT_MAX_CHARS, page, withCitation } from "./text.js";
import * as boe from "./boe.js";
import * as cendoj from "./cendoj.js";
import * as tc from "./tc.js";
import * as ue from "./eurlex.js";
import * as auto from "./autonomicos.js";
export const INSTRUCTIONS = `Servidor de fuentes jurídicas oficiales españolas y europeas (BOE, boletines autonómicos, CENDOJ, Tribunal Constitucional, EUR-Lex y TJUE).

Reglas para evitar errores de cita:
1. Cita solo preceptos y resoluciones cuyo texto hayas obtenido con estas herramientas en esta conversación. Si no lo has leído, dilo y ofrece buscarlo.
2. Al citar, reproduce el texto literal entre comillas y acompáñalo del identificador (BOE-A-…, ROJ/ECLI, CELEX, STC n/aaaa) y de la URL oficial que devuelve la herramienta.
3. Comprueba la vigencia: boe_articulo muestra la versión vigente y su fecha; si la norma tiene "vigencia_agotada" o estado distinto de "Finalizado", adviértelo.
4. Si una herramienta devuelve un error o ningún resultado, no lo suplas con memoria: informa del fallo y propone otra vía (otra herramienta, o la URL para consulta manual).
5. Los textos largos se devuelven por fragmentos; pide el siguiente con offset antes de afirmar algo sobre partes no leídas.`;
const ok = (text) => ({ content: [{ type: "text", text }] });
function fail(err) {
    const msg = err instanceof Error ? err.message : String(err);
    const url = err instanceof SourceError && err.url ? `\nURL consultada: ${err.url}` : "";
    return {
        isError: true,
        content: [{ type: "text", text: `ERROR (no se ha obtenido texto oficial; no completes con memoria): ${msg}${url}` }],
    };
}
const safe = (fn) => async (a) => {
    try {
        return ok(await fn(a));
    }
    catch (e) {
        return fail(e);
    }
};
const offset = z.number().int().min(0).default(0).describe("Posición desde la que leer (para textos largos)");
const maxChars = z
    .number()
    .int()
    .min(1000)
    .max(200000)
    .default(DEFAULT_MAX_CHARS)
    .describe("Máximo de caracteres a devolver en esta llamada");
const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato AAAA-MM-DD");
const listado = (lines, vacio) => (lines.length ? lines.join("\n\n") : vacio);
export function createServer() {
    const server = new McpServer({ name: "fuentes-juridicas", version: "0.1.0" }, { instructions: INSTRUCTIONS });
    // ───────────────────────────── BOE ─────────────────────────────
    server.registerTool("boe_buscar_legislacion", {
        title: "Buscar legislación consolidada (BOE)",
        description: "Busca normas en la base de legislación consolidada del BOE (estatal y autonómica). Devuelve identificadores BOE-A-… para leer el texto con boe_articulo o boe_texto_consolidado.",
        inputSchema: {
            titulo: z.string().optional().describe('Palabras del título, p. ej. "protección de datos personales"'),
            consulta: z
                .string()
                .optional()
                .describe('Consulta avanzada en la sintaxis del BOE, p. ej. titulo:arrendamientos and titulo:urbanos'),
            ambito: z.enum(["Estatal", "Autonómico"]).optional(),
            rango: z.string().optional().describe('Filtra por rango: "Ley", "Ley Orgánica", "Real Decreto", "Decreto"…'),
            desde: fechaIso.optional().describe("Fecha de publicación mínima"),
            hasta: fechaIso.optional().describe("Fecha de publicación máxima"),
            limite: z.number().int().min(1).max(50).default(10),
            offset: z.number().int().min(0).default(0),
        },
    }, safe(async (a) => {
        const partes = [];
        if (a.titulo) {
            const palabras = a.titulo.replace(/["()]/g, " ").split(/\s+/).filter((p) => p.length > 2);
            partes.push(palabras.map((p) => `titulo:${p}`).join(" and "));
        }
        if (a.consulta)
            partes.push(`(${a.consulta})`);
        if (!partes.length)
            throw new SourceError("Indica 'titulo' o 'consulta'.");
        const { url, resultados } = await boe.buscarLegislacion({
            consulta: partes.join(" and "),
            ambito: a.ambito,
            rango: a.rango,
            desde: a.desde?.replace(/-/g, ""),
            hasta: a.hasta?.replace(/-/g, ""),
            limite: a.limite,
            offset: a.offset,
        });
        const lines = resultados.map((r) => `• ${r.titulo}\n  ID: ${r.identificador} | ${r.rango ?? ""} | ${r.ambito ?? ""} | ${r.departamento ?? ""}\n` +
            `  Publicación: ${boe.fechaBonita(r.fecha_publicacion)} | Consolidación: ${r.estado_consolidacion ?? "?"}` +
            `${r.vigencia_agotada === "S" ? " | ⚠ VIGENCIA AGOTADA (derogada)" : ""}\n` +
            `  URL: ${r.url_html_consolidada ?? r.url_eli ?? ""}`);
        return `Resultados de la API de legislación consolidada del BOE (${url}):\n\n` + listado(lines, "Sin resultados.");
    }));
    server.registerTool("boe_metadatos", {
        title: "Metadatos de una norma (BOE)",
        description: "Rango, fechas, departamento, estado de consolidación, vigencia y ELI de una norma consolidada.",
        inputSchema: { id: z.string().describe("Identificador BOE, p. ej. BOE-A-2018-16673") },
    }, safe(async ({ id }) => {
        const m = await boe.metadatos(id);
        return [
            `FUENTE: BOE · API de legislación consolidada (${m.url})`,
            `TÍTULO: ${m.titulo}`,
            `IDENTIFICADOR: ${m.identificador}`,
            `RANGO: ${m.rango ?? ""}  ÁMBITO: ${m.ambito ?? ""}  DEPARTAMENTO: ${m.departamento ?? ""}`,
            `FECHA DISPOSICIÓN: ${boe.fechaBonita(m.fecha_disposicion) ?? ""}  PUBLICACIÓN: ${boe.fechaBonita(m.fecha_publicacion) ?? ""}`,
            `ÚLTIMA ACTUALIZACIÓN: ${m.fecha_actualizacion ?? ""}`,
            `ESTADO DE CONSOLIDACIÓN: ${m.estado_consolidacion ?? ""}`,
            `VIGENCIA AGOTADA: ${m.vigencia_agotada === "S" ? "SÍ (norma derogada o sin efectos)" : "No"}`,
            `ELI: ${m.url_eli ?? "-"}`,
            `URL TEXTO CONSOLIDADO: ${m.url_html_consolidada ?? "-"}`,
        ].join("\n");
    }));
    server.registerTool("boe_indice", {
        title: "Índice de una norma (BOE)",
        description: "Lista los bloques (títulos, capítulos, artículos, disposiciones) de una norma consolidada con su id de bloque.",
        inputSchema: { id: z.string().describe("Identificador BOE-A-…") },
    }, safe(async ({ id }) => {
        const { url, bloques } = await boe.indice(id);
        return (`FUENTE: BOE · índice de ${id} (${url})\n` +
            `Usa boe_texto_consolidado con 'bloque' = id, o boe_articulo con el número.\n\n` +
            bloques.map((b) => `${b.id}\t${b.titulo}${b.fecha_actualizacion ? `\t(act. ${boe.fechaBonita(b.fecha_actualizacion)})` : ""}`).join("\n"));
    }));
    server.registerTool("boe_articulo", {
        title: "Leer un artículo vigente (BOE)",
        description: "Devuelve el texto literal y vigente de un artículo o disposición de una norma consolidada, con la fecha de su última redacción. Acepta '14', '14 bis', 'artículo 3'; para disposiciones usa boe_indice y boe_texto_consolidado.",
        inputSchema: {
            id: z.string().describe("Identificador BOE-A-…"),
            articulo: z.string().describe('Número del artículo, p. ej. "6" o "17 bis"'),
            historico: z.boolean().default(false).describe("Incluir todas las redacciones anteriores"),
        },
    }, safe(async ({ id, articulo, historico }) => {
        const meta = await boe.metadatos(id);
        const { bloques } = await boe.indice(id);
        const b = boe.encontrarArticulo(bloques, articulo);
        if (!b) {
            const arts = bloques.filter((x) => /^art/i.test(x.titulo)).slice(0, 15).map((x) => x.titulo).join(", ");
            throw new SourceError(`No hay ningún "Artículo ${articulo}" en el índice de ${id}. Algunos existentes: ${arts}…`);
        }
        const { url, bloques: texto } = await boe.textoConsolidado(id, b.id);
        return withCitation({
            fuente: "BOE · Legislación consolidada",
            titulo: meta.titulo,
            identificador: `${meta.identificador}, ${b.titulo}`,
            url: `${meta.url_html_consolidada ?? url}#${b.id}`,
            extra: {
                "vigencia agotada": meta.vigencia_agotada === "S" ? "SÍ — norma derogada" : undefined,
                "api": url,
            },
        }, texto.map((t) => boe.renderBloque(t, historico)).join("\n\n"));
    }));
    server.registerTool("boe_texto_consolidado", {
        title: "Texto consolidado completo o por bloque (BOE)",
        description: "Texto consolidado vigente de una norma completa, o de un bloque concreto (id de boe_indice). Paginado.",
        inputSchema: {
            id: z.string(),
            bloque: z.string().optional().describe("Id de bloque de boe_indice (p. ej. a6, da1, dt2)"),
            historico: z.boolean().default(false),
            offset,
            max_caracteres: maxChars,
        },
    }, safe(async ({ id, bloque, historico, offset, max_caracteres }) => {
        const meta = await boe.metadatos(id);
        const { url, bloques } = await boe.textoConsolidado(id, bloque);
        const body = bloques.map((b) => boe.renderBloque(b, historico)).join("\n\n");
        return withCitation({
            fuente: "BOE · Legislación consolidada",
            titulo: meta.titulo,
            identificador: meta.identificador,
            url: `${meta.url_html_consolidada ?? url}${bloque ? `#${bloque}` : ""}`,
            extra: { "vigencia agotada": meta.vigencia_agotada === "S" ? "SÍ — norma derogada" : undefined, api: url },
        }, page(body, offset, max_caracteres));
    }));
    server.registerTool("boe_sumario", {
        title: "Sumario del BOE de un día",
        description: "Lista las disposiciones publicadas en el BOE en una fecha (incluye leyes autonómicas publicadas en el BOE y sentencias del TC).",
        inputSchema: {
            fecha: fechaIso,
            filtro: z.string().optional().describe("Texto para filtrar por título, sección o departamento"),
            seccion: z.string().optional().describe('Código de sección del sumario, p. ej. "1" o "I" (Disposiciones generales), "3" o "III"'),
        },
    }, safe(async ({ fecha, filtro, seccion }) => {
        const { url, items } = await boe.sumario(fecha);
        let sel = items;
        if (seccion) {
            const s = seccion.toUpperCase();
            sel = sel.filter((i) => i.seccion_codigo?.toUpperCase() === s || (i.seccion ?? "").toUpperCase().startsWith(s + "."));
        }
        if (filtro) {
            const f = filtro.toLowerCase();
            sel = sel.filter((i) => `${i.titulo} ${i.seccion} ${i.departamento} ${i.epigrafe}`.toLowerCase().includes(f));
        }
        return (`FUENTE: Sumario oficial del BOE de ${fecha} (${url}) — ${sel.length} de ${items.length} disposiciones\n\n` +
            listado(sel.slice(0, 150).map((i) => `• [${i.identificador}] ${i.titulo}\n  ${i.seccion} · ${i.departamento}\n  ${i.url_html ?? ""}`), "Ninguna disposición coincide.") +
            (sel.length > 150 ? `\n\n[Se muestran 150 de ${sel.length}; afina con 'filtro' o 'seccion'.]` : ""));
    }));
    server.registerTool("boe_documento", {
        title: "Documento del BOE tal como se publicó",
        description: "Texto original publicado en el diario BOE (no consolidado) de cualquier disposición o anuncio BOE-A-… / BOE-B-…, incluidas sentencias del TC publicadas en el BOE.",
        inputSchema: { id: z.string(), offset, max_caracteres: maxChars },
    }, safe(async ({ id, offset, max_caracteres }) => {
        const d = await boe.documentoDiario(id);
        return withCitation({
            fuente: `BOE núm. ${d.diario_numero ?? "?"}, de ${boe.fechaBonita(d.fecha_publicacion) ?? "?"} (texto original publicado, no consolidado)`,
            titulo: d.titulo,
            identificador: d.identificador,
            url: d.url_html,
            extra: { pdf: d.url_pdf, eli: d.url_eli },
        }, page(d.texto, offset, max_caracteres));
    }));
    // ──────────────────────── Boletines autonómicos ────────────────────────
    server.registerTool("autonomico_boletines", {
        title: "Diarios oficiales autonómicos",
        description: "Lista los 19 diarios oficiales autonómicos con su web oficial. Para buscar normas autonómicas consolidadas usa boe_buscar_legislacion con ambito=Autonómico.",
        inputSchema: {},
    }, safe(async () => auto.BOLETINES.map((b) => `• ${b.comunidad} — ${b.siglas}: ${b.nombre}\n  ${b.web}`).join("\n") +
        "\n\nCómo localizar una norma autonómica:\n" +
        "1) boe_buscar_legislacion con ambito=Autonómico (texto consolidado oficial por el BOE).\n" +
        "2) Las leyes autonómicas se republican en el BOE (sección I): boe_sumario / boe_documento.\n" +
        "3) Cualquier otra disposición: autonomico_documento con la URL del diario autonómico."));
    server.registerTool("autonomico_documento", {
        title: "Leer documento de un diario autonómico",
        description: "Descarga y devuelve el texto (HTML o PDF) de una URL de un diario oficial autonómico. Solo admite dominios oficiales.",
        inputSchema: { url: z.string().url(), offset, max_caracteres: maxChars },
    }, safe(async ({ url, offset, max_caracteres }) => {
        const d = await auto.leerDocumento(url);
        return withCitation({ fuente: `${d.boletin.siglas} · ${d.boletin.nombre}`, url: d.url }, page(d.texto, offset, max_caracteres));
    }));
    // ───────────────────────────── CENDOJ ─────────────────────────────
    server.registerTool("cendoj_buscar", {
        title: "Buscar jurisprudencia (CENDOJ)",
        description: "Busca sentencias y autos del Tribunal Supremo, Audiencia Nacional, TSJ, Audiencias Provinciales y juzgados en el buscador oficial del CGPJ. Devuelve 10 resultados por página con ROJ, ECLI, resumen y 'referencia' para leer el texto con cendoj_texto. Uso particular; no hagas búsquedas masivas.",
        inputSchema: {
            texto: z.string().optional().describe("Texto libre. Admite operadores del CENDOJ (Y, O, NO, comillas)"),
            roj: z.string().optional().describe('ROJ, p. ej. "STS 1234/2024"'),
            ecli: z.string().optional().describe("ECLI:ES:TS:2024:1234"),
            desde: fechaIso.optional(),
            hasta: fechaIso.optional(),
            jurisdicciones: z.array(z.enum(cendoj.JURISDICCIONES)).optional(),
            comunidades: z.array(z.enum(cendoj.COMUNIDADES)).optional(),
            organos: z
                .array(z.enum(Object.keys(cendoj.ORGANOS)))
                .optional()
                .describe("Tipo de órgano, p. ej. TS_CIVIL, TSJ_SOCIAL, AUDIENCIA_PROVINCIAL"),
            solo_supremo: z.boolean().default(false),
            pagina: z.number().int().min(1).max(50).default(1),
        },
    }, safe(async (a) => {
        if (!a.texto && !a.roj && !a.ecli)
            throw new SourceError("Indica 'texto', 'roj' o 'ecli'.");
        let r = await cendoj.buscar({
            texto: a.texto,
            roj: a.roj,
            ecli: a.ecli,
            desde: a.desde,
            hasta: a.hasta,
            jurisdicciones: a.jurisdicciones,
            comunidades: a.comunidades,
            organos: a.organos,
            soloSupremo: a.solo_supremo,
            pagina: a.pagina,
        });
        // Si el campo ROJ/ECLI no da resultados, se reintenta como texto literal.
        if (!r.resultados.length && !a.texto && (a.roj || a.ecli)) {
            r = await cendoj.buscar({ texto: `"${a.roj ?? a.ecli}"`, pagina: 1 });
        }
        const lines = r.resultados.map((x) => `• ${x.titulo}\n  ROJ: ${x.roj ?? "-"} | ECLI: ${x.ecli ?? "-"} | Fecha: ${x.fecha ?? "-"}\n` +
            Object.entries(x.metadatos)
                .filter(([k]) => !/^(roj|ecli|fecha)$/i.test(k))
                .map(([k, v]) => `  ${k}: ${v}`)
                .join("\n") +
            `\n  referencia: ${x.referencia ?? "-"}\n  URL: ${x.url ?? "-"}` +
            (x.resumen ? `\n  Resumen (del CENDOJ): ${x.resumen}` : ""));
        return (`FUENTE: CENDOJ · Buscador de jurisprudencia del CGPJ (www.poderjudicial.es/search)\n` +
            `${r.total !== undefined ? `Total: ${r.total} resultados. ` : ""}Página ${a.pagina}.\n\n` +
            listado(lines, "Sin resultados. (Si esperabas resultados, la web del CENDOJ puede haber cambiado o limitado las consultas.)"));
    }));
    server.registerTool("cendoj_texto", {
        title: "Texto completo de una resolución (CENDOJ)",
        description: "Descarga el PDF oficial de la resolución y devuelve su texto literal. Pasa 'referencia' y 'url' tal como los devuelve cendoj_buscar. Paginado.",
        inputSchema: {
            referencia: z.string().describe("Campo 'referencia' de cendoj_buscar"),
            url: z.string().optional().describe("Campo 'URL' de cendoj_buscar (recomendado)"),
            offset,
            max_caracteres: maxChars,
        },
    }, safe(async ({ referencia, url: urlDoc, offset, max_caracteres }) => {
        const { url, texto } = await cendoj.textoResolucion(referencia, urlDoc);
        return withCitation({ fuente: "CENDOJ · Consejo General del Poder Judicial", identificador: `referencia ${referencia}`, url: urlDoc ?? cendoj.urlDocumento(referencia), extra: { pdf: url } }, page(texto, offset, max_caracteres));
    }));
    // ──────────────────────── Tribunal Constitucional ────────────────────────
    server.registerTool("tc_resolucion", {
        title: "Resolución del Tribunal Constitucional",
        description: "Texto completo (antecedentes, fundamentos jurídicos, fallo y votos) de una sentencia, auto o declaración del TC desde su buscador oficial. Indica cita (\"STC 31/2010\", \"ATC 40/2020\"), ECLI o id interno.",
        inputSchema: {
            cita: z.string().optional().describe('"STC 31/2010", "ATC 40/2020", "DTC 1/2004"'),
            ecli: z.string().optional().describe("ECLI:ES:TC:2010:31"),
            id: z.string().optional().describe("Id interno de hj.tribunalconstitucional.es"),
            offset,
            max_caracteres: maxChars,
        },
    }, safe(async ({ cita, ecli, id, offset, max_caracteres }) => {
        let internalId = id;
        if (!internalId) {
            const parsed = (cita && tc.parseCitaTC(cita)) || (ecli && tc.parseEcliTC(ecli));
            if (!parsed)
                throw new SourceError('Indica una cita válida ("STC 31/2010"), un ECLI del TC o un id interno.');
            internalId = await tc.idPorNumero(parsed.tipo, parsed.numero, parsed.anno);
        }
        const r = await tc.resolucionPorId(internalId);
        return withCitation({ fuente: "Tribunal Constitucional · Buscador de jurisprudencia constitucional", titulo: r.titulo, identificador: r.ecli, url: r.url, extra: { sala: r.sala, publicación: r.boe } }, page(r.texto, offset, max_caracteres));
    }));
    // ──────────────────────── Unión Europea ────────────────────────
    server.registerTool("ue_buscar", {
        title: "Buscar derecho y jurisprudencia de la UE (EUR-Lex/CELLAR)",
        description: "Busca por palabras del título (en español) en la base oficial de la Oficina de Publicaciones de la UE. tipo=legislacion (tratados, reglamentos, directivas, decisiones), jurisprudencia (TJUE y Tribunal General) o todo. Devuelve CELEX para ue_documento.",
        inputSchema: {
            texto: z.string().describe('Palabras del título, p. ej. "protección datos personales"'),
            tipo: z.enum(["legislacion", "jurisprudencia", "todo"]).default("legislacion"),
            desde: fechaIso.optional(),
            hasta: fechaIso.optional(),
            limite: z.number().int().min(1).max(50).default(10),
        },
    }, safe(async ({ texto, tipo, desde, hasta, limite }) => {
        const docs = await ue.buscar(texto, tipo, desde, hasta, limite);
        return (`FUENTE: CELLAR · Oficina de Publicaciones de la UE (SPARQL)\n\n` +
            listado(docs.map((d) => `• ${d.titulo}\n  CELEX: ${d.celex}${d.ecli ? ` | ${d.ecli}` : ""} | Fecha: ${d.fecha ?? "-"}\n  URL: ${d.url}`), "Sin resultados (la búsqueda es por palabras exactas del título en español; prueba con menos palabras o sin acentos dudosos)."));
    }));
    server.registerTool("ue_documento", {
        title: "Texto de un documento de la UE por CELEX",
        description: "Texto oficial en español de un acto de la UE o resolución del TJUE por su número CELEX (p. ej. 32016R0679 = RGPD; 62014CJ0362 = sentencia Schrems). Paginado.",
        inputSchema: { celex: z.string(), offset, max_caracteres: maxChars },
    }, safe(async ({ celex, offset, max_caracteres }) => {
        const c = ue.assertCelex(celex);
        const meta = await ue.metadatos(c).catch(() => undefined);
        const t = await ue.texto(c);
        return withCitation({
            fuente: `Unión Europea · ${t.via === "CELLAR" ? "CELLAR (Oficina de Publicaciones)" : "EUR-Lex"}`,
            titulo: meta?.titulo,
            identificador: `CELEX ${c}${meta?.ecli ? ` · ${meta.ecli}` : ""}`,
            url: t.url,
            extra: {
                fecha: meta?.fecha,
                "en vigor": meta?.en_vigor === "true" ? "sí" : meta?.en_vigor === "false" ? "NO" : undefined,
                eli: meta?.eli,
            },
        }, page(t.texto, offset, max_caracteres));
    }));
    server.registerTool("tjue_asunto", {
        title: "Localizar un asunto del TJUE",
        description: "Dado un número de asunto (C-362/14, T-201/04) o un ECLI (ECLI:EU:C:2015:650), devuelve los documentos existentes (sentencia, conclusiones del Abogado General, auto) con su CELEX y título oficial, para leerlos con ue_documento.",
        inputSchema: {
            asunto: z.string().optional().describe("C-362/14"),
            ecli: z.string().optional().describe("ECLI:EU:C:2015:650"),
        },
    }, safe(async ({ asunto, ecli }) => {
        const found = [];
        if (ecli) {
            const celexes = await ue.celexPorEcli(ecli);
            if (!celexes.length)
                throw new SourceError(`CELLAR no tiene ningún documento con ${ecli}.`);
            for (const c of celexes) {
                const m = await ue.metadatos(c).catch(() => undefined);
                found.push(`• ${m?.titulo ?? "(sin título en español)"}\n  CELEX: ${c} | ${ecli} | Fecha: ${m?.fecha ?? "-"}\n  URL: ${ue.urlEurLex(c)}`);
            }
        }
        if (asunto) {
            const { tribunal, candidatos } = ue.celexPorAsunto(asunto);
            const errores = [];
            let hallados = 0;
            for (const [tipo, c] of Object.entries(candidatos)) {
                const m = await ue.metadatos(c).catch((e) => {
                    if (!/no tiene ningún documento/.test(String(e?.message)))
                        errores.push(e);
                    return undefined;
                });
                if (m)
                    hallados++;
                if (m)
                    found.push(`• [${tipo}] ${m.titulo ?? "(sin título en español)"}\n  CELEX: ${c}${m.ecli ? ` | ${m.ecli}` : ""} | Fecha: ${m.fecha ?? "-"}\n  URL: ${m.url}`);
            }
            if (!hallados && errores.length)
                throw errores[0];
            if (!hallados)
                found.push(`CELLAR no tiene sentencia, conclusiones ni auto con los CELEX esperados (${Object.values(candidatos).join(", ")}).`);
            found.push(`${tribunal}. Ficha del asunto en CURIA: ${ue.urlCuria(asunto)}`);
        }
        if (!asunto && !ecli)
            throw new SourceError("Indica 'asunto' o 'ecli'.");
        return `FUENTE: CELLAR / EUR-Lex (jurisprudencia del TJUE)\n\n${found.join("\n\n")}`;
    }));
    return server;
}
