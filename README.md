# fuentes-juridicas-mcp

Conector MCP de fuentes jurídicas oficiales: BOE (legislación estatal y autonómica consolidada, sumario y diario), boletines autonómicos, CENDOJ, Tribunal Constitucional, EUR-Lex, TJUE y TEDH (HUDOC). Cada texto se devuelve literal, con identificador (BOE-A, ROJ/ECLI, CELEX, STC) y URL oficial.

Todos los archivos van en la raíz del repositorio, sin carpetas y sin compilar.

## Desplegar en Render como conector personalizado

1. Sube todos estos archivos a la raíz de un repositorio de GitHub.
2. En Render: **New → Blueprint**, elige el repositorio y pulsa **Apply**. `render.yaml` crea el servicio y una variable secreta `FJ_SECRET`.
3. Comprueba que `https://<tu-servicio>.onrender.com/health` responde «fuentes-juridicas-mcp OK».
4. Copia el valor de `FJ_SECRET` (servicio → Environment). La URL del conector es
   `https://<tu-servicio>.onrender.com/mcp/<FJ_SECRET>`
5. En claude.ai: **Ajustes → Conectores → Añadir conector personalizado**, con esa URL.

Si prefieres crear el servicio a mano (New → Web Service): Build Command `npm install`, Start Command `node remote.js`, y añade la variable `FJ_SECRET` con un valor largo inventado por ti.

En el plan gratuito el servicio se duerme tras 15 minutos sin uso; la primera consulta tarda 30–60 s.

## Uso local (Claude Desktop / Claude Code)

`npm install` y luego apunta a `node /ruta/index.js` (modo stdio).

## Herramientas

`boe_buscar_legislacion`, `boe_metadatos`, `boe_indice`, `boe_articulo`, `boe_texto_consolidado`, `boe_sumario`, `boe_documento`, `autonomico_boletines`, `autonomico_documento`, `cendoj_buscar`, `cendoj_texto`, `tc_resolucion`, `ue_buscar`, `ue_documento`, `tjue_asunto`, `tedh_buscar`, `tedh_documento`.

## Limitaciones

- Probado en vivo el 24/10/2026: BOE, autonómicos, TC, EUR-Lex y TJUE funcionan; del CENDOJ funciona la búsqueda.
- BOE: API oficial, lo más fiable; su buscador ha dado errores 500 intermitentes.
- BOE, si la API de legislación consolidada no responde (5xx, 429, 403 o red caída): `boe_metadatos`, `boe_indice`, `boe_articulo` y `boe_texto_consolidado` leen la página web del texto consolidado (`https://www.boe.es/buscar/act.php?id=…`), que es otro servicio. Esa página solo trae la redacción vigente, con las notas de reforma, así que `historico=true` no está disponible por esa vía. La respuesta lo indica con un `AVISO:` y la fuente «(página web)». Un 404 no activa la alternativa. Tras un fallo, la API no se reintenta durante 5 minutos (`BOE_API_PAUSA_MS`). `npm test` ejecuta las pruebas (sin red).
- CENDOJ: la búsqueda funciona. El texto completo no: desde Render el CGPJ muestra su CAPTCHA «Descargas masivas», que el conector no sortea; devuelve el enlace para abrir la resolución en el navegador.
- TC: lectura por cita, ECLI o id; no busca por palabras.
- UE/TJUE: búsqueda por palabras del título; autos y documentos antiguos a veces sin versión española.
- TEDH: vía HUDOC (servicio JSON que usa la propia web, sin API documentada). Textos oficiales en inglés y francés; la búsqueda por texto debe ir en esos idiomas.
- Autonómicos: lo consolidado sale del BOE; para lo demás hace falta la URL del diario.
- Desde Render las peticiones salen de un centro de datos; CENDOJ o EUR-Lex podrían bloquearlas.

Licencia MIT.
