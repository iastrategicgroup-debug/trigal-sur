# Plan: Trigal Sur, demo de mundo abierto

## Estructura de carpetas

```
trigal-sur/
├── index.html              Página del juego
├── personaje.html          Visor del personaje (/personaje), fase 4
├── scripts/
│   ├── map-fetch.mjs       npm run map:fetch (Overpass -> data/trigal-sur.json)
│   ├── osm-import.mjs      Importador de .osm exportado (alternativa), fase 2
│   └── rostro.mjs          Recorte y alineación local del rostro, fase 4
├── data/                   Datos de OSM (JSON)
├── assets/referencia/      Fotos del jefe (ignoradas por git)
├── src/
│   ├── config/             Constantes (velocidades, cámara, salud, vehículo…)
│   ├── core/               Bucle de paso fijo, flujo de pantallas, guardado
│   ├── map/                Proyección, parseo de OSM, grafo de calles
│   ├── world/              Calles, edificios, vegetación, chunks, ciclo de día
│   ├── player/             Modelo, esqueleto, animaciones, estados, salud
│   ├── vehicle/            Conducción (fase 6)
│   ├── camera/             Cámara en tercera persona e introducción
│   ├── input/              Teclado, ratón, gamepad, táctil
│   ├── npc/                Peatones y tráfico
│   ├── audio/              Sonido generado (WebAudio)
│   └── ui/                 Pantallas, HUD, minimapa, mapa
├── tests/                  Vitest: proyección, bucle, colisiones, estados
└── docs/                   Plan, decisiones, capturas
```

## Fases

| # | Fase | Estado |
|---|------|--------|
| 1 | Base y bucle de juego | ✅ hecha |
| 2 | Mapa real (OSM) y calles | ⛔ bloqueada: la red del entorno no llega a Overpass |
| 3 | Controles, máquina de estados, resistencia, cámara y colisiones, golpes | pendiente |
| 4 | Protagonista, esqueleto, animaciones y visor (requiere tu aprobación del parecido) | pendiente |
| 5 | Edificios, ambientación y texturas estilo PS2 | pendiente |
| 6 | HUD completo, minimapa, peatones, tráfico, **conducción**, salud/escudo, sonido, ciclo de día | pendiente |
| 7 | Optimización, medición de rendimiento y documentación | pendiente |

## Cambios de alcance pedidos (sobre la especificación original)

1. **Conducción** (fase 6): tecla F para subir/bajar de carros estacionados o detenidos. Física arcade de bicicleta (Ackermann simplificado), sigue colisiones con edificios. El tráfico IA sigue sin atropellar al jugador a pie.
2. **Salud y escudo con barras** (HUD hecho; lógica en fases 3 y 6). Daño solo por caídas de más de 3 m y choques al conducir. El escudo absorbe primero. Salud regenera hasta 60. A 0: fundido a negro y reaparición en la Plaza José Martí. El escudo se recarga con objetos "Escudo" repartidos por el mapa.
3. **Golpes** (fase 3/6): clic izquierdo o Q, combo de 3. Sin sangre ni muertes: el peatón trastabilla o cae, se levanta y huye o protesta. Cambia el "fuera de alcance: violencia" de la especificación original a violencia leve tipo arcade. El protagonista (persona real) nunca recibe animaciones humillantes.
4. **Texturas "tipo GTA"**: estilo de la era PS2 (128–256 px, ruido, suciedad, sombras horneadas, gradación cálida), generadas por código. No se usa ningún asset de GTA/Rockstar.

## Decisiones menores

- Three.js 0.170.0, Vite 5.4, TypeScript 5.6 (`strict` + `noUncheckedIndexedAccess`), Vitest 2.1.
- Origen de la proyección: centro del bbox (10.2125, -67.996).
- Bucle: si se acumulan más de 5 pasos se descarta el sobrante (evita la "espiral de la muerte") y se registra en `droppedTime`.
- Esc: el navegador libera el pointer lock al pulsarlo; ese evento dispara la pausa.
- Pausa automática al perder el foco o al ocultar la pestaña (excepto durante el descenso inicial).
- Guardado automático de posición cada 5 s y al pausar; localStorage envuelto en try/catch.
- Render retro 480p: se ajusta el pixelRatio para que la altura interna sea 480 px, con `image-rendering: pixelated`.
- La foto llegó como `jefe-frente.png` (no `.jpg`): el pipeline aceptará `.png` y `.jpg`.
- Tecla F para vehículos (E ya está para saludar/sentarse); Q o clic izquierdo para golpear.
