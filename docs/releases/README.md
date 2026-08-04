# Notas de cada versión

Un archivo por tag: `v1.16.7.md`. Al empujar el tag, CI crea el release con
**este** contenido (`gh release create --notes-file`).

Si el archivo no existe, CI cae a `--generate-notes` —la lista de commits— y
deja un **warning** en el resumen del run. No falla el build: una versión sin
notas se publica igual, pero se nota.

## Por qué viven aquí

Antes las notas solo se respetaban si el release ya existía, creado a mano. Al
publicar por tag el release **nunca** existe todavía, así que se generaban solas:
seis versiones seguidas salieron con la lista de commits por toda nota.

Escribirlas en el repo tiene dos ventajas sobre editarlas después en GitHub: van
en el mismo commit que sube la versión —cuando tienes fresco lo que cambiaste— y
quedan en la historia del proyecto, no solo en una página web.

## Qué escribir

Lo que le sirve a quien la va a instalar, no el registro de cambios:

- **Qué cambia para quien la usa.** Si una versión no cambia nada para el
  usuario, decirlo en la primera línea y explicar para qué existe.
- **Por qué**, cuando el porqué no es obvio. Un arreglo se entiende mejor con el
  síntoma que lo delató que con el nombre de la función que se tocó.
- **Qué descargar**, y si hace falta instalar a mano o la app se actualiza sola.

Y lo que no: los números de commit, los nombres de archivo tocados y el detalle
interno. Eso ya está en el diff, y ahí no estorba.
