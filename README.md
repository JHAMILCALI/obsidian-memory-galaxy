# Astra Memory Galaxy para Obsidian

Una galaxia espiral animada inspirada en la [Memory Galaxy del video](https://www.youtube.com/watch?v=UFU5yALU5ao): un núcleo cálido que brilla, tres brazos de polvo estelar que pasan del rosa y violeta al cian, nebulosas suaves y un resplandor (bloom) que hace que cada estrella irradie luz. La escena tiene profundidad 3D y cámara orbital.

Cada grupo de notas enlazadas forma una **constelación** sobre un brazo de la galaxia, unida por líneas tenues del color de su carpeta. Las notas aisladas aparecen como estrellas libres en los brazos exteriores. Las **ideas recientes** (hasta 12 notas editadas en los últimos 30 días) brillan en blanco cálido, tienen destellos en cruz, laten y emiten un anillo de luz; sus títulos aparecen primero, marcados con un punto dorado. Al elegir una idea, la galaxia se oscurece y su rama flota sobre el disco con las vecinas a su alrededor.

## Controles

- Arrastra para girar la cámara alrededor de la galaxia; clic derecho y arrastre para desplazarla.
- Usa la rueda o los botones `+` y `−` para acercar o alejar.
- Pulsa un punto o su título para desplegar e iluminar únicamente sus relaciones directas. Pulsa otra idea relacionada para explorar su propia rama.
- Haz doble clic en una estrella con nota para abrirla.
- Busca una nota por nombre o ruta para enfocar su estrella.
- Usa **Volver al mapa** para cerrar la rama o **Ver galaxia** para alejar la cámara.
- Usa el botón de pausa para detener y reanudar el giro automático.
- Abre **Ajustes** para cambiar la separación, el brillo (también controla el resplandor), las constelaciones, los enlaces de la rama y la cantidad de títulos visibles.

El contador **recientes** de la cabecera y la ficha de cada nota (fecha de edición) indican qué ideas se están moviendo. Cada estrella que puedes pulsar es una nota; el polvo de los brazos es solo decoración.

Las conexiones usan los enlaces que Obsidian resuelve entre archivos Markdown. Una nota sin enlaces sigue apareciendo como estrella independiente, pero no recibe hilos inventados.

La tipografía combina **Jost** (una versión libre de Futura, la letra de la placa del Apolo 11) para la interfaz y las etiquetas con **Cormorant Garamond**, inspirada en los atlas estelares grabados, para títulos y cifras. Ambas van incrustadas en `main.js` (ver `fonts/`), así que funcionan sin conexión.

La escena se dibuja localmente con WebGL. No envía datos ni necesita servicios externos.

## Instalar o actualizar en una bóveda

1. Ejecuta `npm install` y `npm run build` en este proyecto.
2. Copia `manifest.json`, `main.js` y `styles.css` a `<tu bóveda>/.obsidian/plugins/astra-galaxy/`, reemplazando la versión anterior si la hay.
3. En Obsidian, abre **Preferencias → Complementos comunitarios**. Si aparece **Salir del modo restringido**, debes hacerlo tú para permitir plugins de la comunidad. Habilita **Astra Galaxy** o reinicia Obsidian si ya estaba activo.
4. Abre la vista con el icono de órbita o con el comando **Abrir galaxia 3D**.

Para desarrollar dentro de una bóveda, coloca este proyecto en su carpeta de plugins y usa `npm run dev`.

## Vista previa sin abrir Obsidian

Ejecuta `npm run demo` y abre `http://127.0.0.1:4173` en el navegador. La vista previa usa 75 notas de muestra en tres grupos, 69 enlaces, y 12 ideas recientes. Añade `?still` a la URL para detener el movimiento o `?focus` para abrir una rama. Detén el servidor con `Ctrl+C` cuando termines.
