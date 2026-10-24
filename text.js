import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
const BLOCK_TAGS = "p,div,br,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,table,section,article,header,footer,dd,dt";
/** Convierte HTML en texto plano conservando los saltos de párrafo. */
export function htmlToText(html, selector) {
    const $ = cheerio.load(html);
    $("script,style,noscript,nav,form,button,iframe").remove();
    const root = selector ? $(selector) : $("body").length ? $("body") : $.root();
    root.find(BLOCK_TAGS).each((_, el) => {
        $(el).prepend("\n");
        $(el).append("\n");
    });
    return normalize(root.text());
}
export function normalize(text) {
    return text
        .replace(/ /g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
export async function pdfToText(data) {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: false });
    return normalize(text.join("\n\n"));
}
export const DEFAULT_MAX_CHARS = Number(process.env.FJ_MAX_CHARS ?? 40000);
/**
 * Devuelve un fragmento del texto e indica cómo pedir el siguiente, para que
 * el modelo nunca tenga que "rellenar" lo que no ha leído.
 */
export function page(text, offset = 0, maxChars = DEFAULT_MAX_CHARS) {
    const total = text.length;
    const slice = text.slice(offset, offset + maxChars);
    const end = offset + slice.length;
    let note = "";
    if (offset > 0 || end < total) {
        note = `\n\n[Fragmento: caracteres ${offset}–${end} de ${total}.`;
        note += end < total ? ` Para seguir leyendo, repite la llamada con offset=${end}.]` : " Fin del texto.]";
    }
    return slice + note;
}
/** Cabecera de cita verificable que acompaña a todo texto devuelto. */
export function citationHeader(c) {
    const lines = [`FUENTE: ${c.fuente}`];
    if (c.titulo)
        lines.push(`TÍTULO: ${c.titulo}`);
    if (c.identificador)
        lines.push(`IDENTIFICADOR: ${c.identificador}`);
    for (const [k, v] of Object.entries(c.extra ?? {}))
        if (v)
            lines.push(`${k.toUpperCase()}: ${v}`);
    lines.push(`URL OFICIAL: ${c.url}`);
    lines.push(`CONSULTADO: ${new Date().toISOString()}`);
    lines.push("TEXTO LITERAL (tal como lo sirve la fuente oficial):");
    lines.push("────────────────────────────────────────");
    return lines.join("\n");
}
export function withCitation(c, body) {
    return `${citationHeader(c)}\n${body}`;
}
