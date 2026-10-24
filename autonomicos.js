// Boletines oficiales autonómicos.
// No existe una API común: cada comunidad publica su diario con un sistema propio.
// Estrategia:
//  1. Las leyes y decretos autonómicos consolidados están en la API del BOE
//     (ámbito "Autonómico"): se buscan con boe_buscar_legislacion.
//  2. Las leyes autonómicas también se publican en el BOE (sección I): boe_documento.
//  3. Para cualquier otra disposición, se lee una URL concreta del diario autonómico,
//     restringida a los dominios oficiales de esta lista.
import { request, SourceError } from "./http.js";
import { htmlToText, pdfToText } from "./text.js";
export const BOLETINES = [
    { comunidad: "Andalucía", siglas: "BOJA", nombre: "Boletín Oficial de la Junta de Andalucía", web: "https://www.juntadeandalucia.es/boja", dominios: ["juntadeandalucia.es"] },
    { comunidad: "Aragón", siglas: "BOA", nombre: "Boletín Oficial de Aragón", web: "https://www.boa.aragon.es", dominios: ["boa.aragon.es", "aragon.es"] },
    { comunidad: "Asturias", siglas: "BOPA", nombre: "Boletín Oficial del Principado de Asturias", web: "https://sede.asturias.es/bopa", dominios: ["asturias.es"] },
    { comunidad: "Illes Balears", siglas: "BOIB", nombre: "Butlletí Oficial de les Illes Balears", web: "https://www.caib.es/eboibfront", dominios: ["caib.es"] },
    { comunidad: "Canarias", siglas: "BOC", nombre: "Boletín Oficial de Canarias", web: "https://www.gobiernodecanarias.org/boc", dominios: ["gobiernodecanarias.org"] },
    { comunidad: "Cantabria", siglas: "BOC", nombre: "Boletín Oficial de Cantabria", web: "https://boc.cantabria.es", dominios: ["cantabria.es"] },
    { comunidad: "Castilla-La Mancha", siglas: "DOCM", nombre: "Diario Oficial de Castilla-La Mancha", web: "https://docm.jccm.es", dominios: ["jccm.es", "castillalamancha.es"] },
    { comunidad: "Castilla y León", siglas: "BOCYL", nombre: "Boletín Oficial de Castilla y León", web: "https://bocyl.jcyl.es", dominios: ["jcyl.es"] },
    { comunidad: "Cataluña", siglas: "DOGC", nombre: "Diari Oficial de la Generalitat de Catalunya", web: "https://dogc.gencat.cat", dominios: ["gencat.cat"] },
    { comunidad: "Comunitat Valenciana", siglas: "DOGV", nombre: "Diari Oficial de la Generalitat Valenciana", web: "https://dogv.gva.es", dominios: ["gva.es"] },
    { comunidad: "Extremadura", siglas: "DOE", nombre: "Diario Oficial de Extremadura", web: "https://doe.juntaex.es", dominios: ["juntaex.es"] },
    { comunidad: "Galicia", siglas: "DOG", nombre: "Diario Oficial de Galicia", web: "https://www.xunta.gal/diario-oficial-galicia", dominios: ["xunta.gal", "xunta.es"] },
    { comunidad: "La Rioja", siglas: "BOR", nombre: "Boletín Oficial de La Rioja", web: "https://web.larioja.org/bor-portada", dominios: ["larioja.org"] },
    { comunidad: "Comunidad de Madrid", siglas: "BOCM", nombre: "Boletín Oficial de la Comunidad de Madrid", web: "https://www.bocm.es", dominios: ["bocm.es", "comunidad.madrid"] },
    { comunidad: "Región de Murcia", siglas: "BORM", nombre: "Boletín Oficial de la Región de Murcia", web: "https://www.borm.es", dominios: ["borm.es", "carm.es"] },
    { comunidad: "Navarra", siglas: "BON", nombre: "Boletín Oficial de Navarra", web: "https://bon.navarra.es", dominios: ["navarra.es"] },
    { comunidad: "País Vasco", siglas: "BOPV", nombre: "Boletín Oficial del País Vasco / Euskal Herriko Agintaritzaren Aldizkaria", web: "https://www.euskadi.eus/bopv", dominios: ["euskadi.eus", "legegunea.euskadi.eus"] },
    { comunidad: "Ceuta", siglas: "BOCCE", nombre: "Boletín Oficial de la Ciudad de Ceuta", web: "https://www.ceuta.es", dominios: ["ceuta.es"] },
    { comunidad: "Melilla", siglas: "BOME", nombre: "Boletín Oficial de la Ciudad de Melilla", web: "https://bomemelilla.es", dominios: ["bomemelilla.es", "melilla.es"] },
];
export function boletinDeUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new SourceError(`URL no válida: "${raw}".`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new SourceError("Solo se admiten URLs http(s).");
    const host = url.hostname.toLowerCase();
    const boletin = BOLETINES.find((b) => b.dominios.some((d) => host === d || host.endsWith(`.${d}`)));
    if (!boletin) {
        throw new SourceError(`El dominio ${host} no es un diario oficial autonómico reconocido. Dominios admitidos: ` +
            BOLETINES.flatMap((b) => b.dominios).join(", "));
    }
    return { url, boletin };
}
export async function leerDocumento(raw) {
    const { url, boletin } = boletinDeUrl(raw);
    const res = await request(url.toString(), { headers: { Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" } });
    // Una redirección fuera de los dominios oficiales invalidaría la cita.
    boletinDeUrl(res.url);
    const isPdf = res.headers.get("content-type")?.includes("pdf") || res.body.subarray(0, 5).toString() === "%PDF-";
    const texto = isPdf ? await pdfToText(res.body) : htmlToText(res.text());
    if (!texto)
        throw new SourceError(`La página ${res.url} no contiene texto extraíble.`, res.url);
    return { url: res.url, boletin, texto };
}
