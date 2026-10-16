# Fuentes

Subconjunto latino (incluye acentos y ñ) descargado de Google Fonts. Ambas familias usan la SIL Open Font License 1.1, que permite incluirlas en el plugin.

| Archivo | Familia | Uso en la galaxia |
| --- | --- | --- |
| `jost-latin.woff2` | Jost, variable 300–600 ([indestructible-type/Jost](https://github.com/indestructible-type/Jost)) | Interfaz, etiquetas y datos |
| `cormorant-garamond-latin.woff2` | Cormorant Garamond, variable 500–700 ([CatharsisFonts/Cormorant](https://github.com/CatharsisFonts/Cormorant)) | Títulos y cifras |
| `cormorant-garamond-italic-latin.woff2` | Cormorant Garamond Italic, variable 500–700 | Acentos en cursiva |

esbuild las incrusta en `main.js` como data URL (`src/fonts.ts`) y se registran con nombres propios (`Astra Jost`, `Astra Cormorant`) para no chocar con fuentes instaladas en el sistema.
