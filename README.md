# Astra Memory Galaxy para Obsidian

Una galaxia animada inspirada en la atmósfera visual de la [Memory Galaxy del video](https://www.youtube.com/watch?v=UFU5yALU5ao): un núcleo violeta de ideas, estrellas azuladas en la periferia, fondo oscuro y mucho espacio para explorar. La escena tiene profundidad 3D, cámara orbital y 240 estrellas vacías permanentes. Las notas enlazadas forman grupos dentro del núcleo; las notas aisladas aparecen como estrellas libres. Al entrar se destacan solo algunos títulos para conservar la apariencia del video; en **Ajustes** puedes activar **Mostrar todos los títulos**. Los enlaces no se dibujan hasta que eliges una idea. Entonces sus vecinas se ordenan alrededor y solo esa rama se ilumina.

## Controles

- Arrastra para girar la cámara alrededor de la galaxia; clic derecho y arrastre para desplazarla.
- Usa la rueda o los botones `+` y `−` para acercar o alejar.
- Pulsa un punto o su título para desplegar e iluminar únicamente sus relaciones directas. Pulsa otra idea relacionada para explorar su propia rama.
- Selecciona una estrella vacía para distinguirla de las notas.
- Haz doble clic en una estrella con nota para abrirla.
- Busca una nota por nombre o ruta para enfocar su estrella.
- Usa **Volver al mapa** para cerrar la rama o **Ver galaxia** para alejar la cámara.
- Usa el botón de pausa para detener y reanudar el giro automático.
- Abre **Ajustes** para cambiar la separación, el brillo, los enlaces de la rama y la cantidad de títulos visibles.

Las notas modificadas recientemente brillan un poco más, mientras que los puntos sin nota mantienen la periferia viva.

Las conexiones usan los enlaces que Obsidian resuelve entre archivos Markdown. Una nota sin enlaces sigue apareciendo como estrella independiente, pero no recibe hilos inventados.

La escena se dibuja localmente con WebGL. No envía datos ni necesita servicios externos.

## Instalar o actualizar en una bóveda

1. Ejecuta `npm install` y `npm run build` en este proyecto.
2. Copia `manifest.json`, `main.js` y `styles.css` a `<tu bóveda>/.obsidian/plugins/astra-galaxy/`, reemplazando la versión anterior si la hay.
3. En Obsidian, abre **Preferencias → Complementos comunitarios**. Si aparece **Salir del modo restringido**, debes hacerlo tú para permitir plugins de la comunidad. Habilita **Astra Galaxy** o reinicia Obsidian si ya estaba activo.
4. Abre la vista con el icono de órbita o con el comando **Abrir galaxia 3D**.

Para desarrollar dentro de una bóveda, coloca este proyecto en su carpeta de plugins y usa `npm run dev`.

## Vista previa sin abrir Obsidian

Ejecuta `npm run demo` y abre `http://127.0.0.1:4173` en el navegador. La vista previa usa 75 notas de muestra en tres grupos, 69 enlaces y los mismos 240 nodos vacíos. Detén el servidor con `Ctrl+C` cuando termines.
