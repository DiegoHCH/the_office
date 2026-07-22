# Modelos 3D (assets)

Suelta aquí los archivos `.glb` de los muebles y el `.fbx` del personaje.
Todo lo que vaya en `public/` se sirve en la raíz: `public/models/desk.glb` → `/models/desk.glb`.

## Muebles — packs CC0 (elige uno)

### Opción A — Kenney "Furniture Kit" (recomendado, CC0, sin atribución)
1. Ve a https://kenney.nl/assets/furniture-kit
2. Descarga el ZIP y descomprímelo.
3. Copia aquí los `.glb` que quieras (la carpeta `Models/GLB` del kit). Útiles para la oficina:
   - `desk.glb` / `deskCorner.glb`  (escritorio)
   - `chairDesk.glb`                (silla de oficina)
   - `computerScreen.glb`, `computerKeyboard.glb`, `laptop.glb`
   - `pottedPlant.glb`              (planta)
   - `books.glb`, `bookcaseOpen.glb`
   - `rugRounded.glb` / `rugRectangle.glb`

### Opción B — Poly Pizza (piezas sueltas)
- https://poly.pizza  → busca "desk", "office chair", "monitor", "plant" → descarga GLB.
- Revisa la licencia de cada modelo (CC0 o CC-BY con atribución).

## Personaje — Quaternius (CC0, low-poly, combina con el diorama)
1. Ve a https://quaternius.com  → busca el **"Ultimate Animated Character Pack"**
   (o "Animated Humans" / "Modular Characters"). Es CC0, sin atribución.
2. Descarga el pack en formato **glTF / GLB** (NO necesitas FBX).
3. Copia aquí un personaje y renómbralo `character.glb`.
   - Los GLB de Quaternius ya traen las animaciones embebidas (idle, walk, run, ...).
   - Al cargarlo, la consola imprimirá los nombres de las animaciones disponibles
     (`[Character3D] animaciones disponibles: [...]`) para mapearlas a estados en la Fase 2.

> Todo GLB → se carga con `useGLTF` + `useAnimations` de drei. Sin conversiones.

## Después de copiar los archivos
Corre `ls public/models` y pásame la lista de nombres exactos:
yo cableo la escena (`Office.jsx`) para cargarlos y ajusto escala / posición / rotación de cada uno.
