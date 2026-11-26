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
| 2 | Mapa real (OSM) y calles | ✅ datos vía API de OSM |
| 3 | Controles, máquina de estados, resistencia, cámara y colisiones | colisiones listas |
| 4 | Protagonista, esqueleto, animaciones y visor (requiere tu aprobación del parecido) | pendiente |
| 5 | Edificios, ambientación y texturas estilo PS2 | en curso (adelantada) |
| 6 | Minimapa, peatones, tráfico, conducción, combate, daño, muertes, ladrones, sonido | pendiente |
| 7 | Optimización, medición de rendimiento y documentación | pendiente |

## Cambios de alcance pedidos (reemplazan el "fuera de alcance" original)

1. **Vehículos manejables** (fase 6): carros, motos y helicópteros. Tecla F para subir y bajar. Física arcade (modelo de bicicleta) con colisiones contra edificios y otros carros.
2. **Salud, escudo y daño real**: barras en el HUD. Daño por golpes, caídas de más de 3 m, atropellos y choques. El escudo absorbe primero. La salud se regenera hasta 60. A 0: pantalla "HAS CAÍDO" y reaparición en la Plaza José Martí con penalización de dinero.
3. **Combate cuerpo a cuerpo**: el protagonista golpea (clic izquierdo o Q, combo de 3, bloqueo con clic derecho). Los NPC se defienden a golpes y los ladrones roban a golpes.
4. **Muertes de NPC**: los peatones y ladrones mueren por golpes o atropellos; el cuerpo cae (ragdoll simple), queda en el suelo y desaparece a los 30 s.
5. **Accidentes**: el tráfico puede chocar y atropellar. Daño por vehículo con humo, abolladuras e incendio por encima del 90 % de daño.
6. **Ladrones**: NPC que arrebatan el dinero, huyen y pelean si los alcanzas. Al derrotarlos recuperas lo robado.
7. **Texturas al estilo de la era PS2**, generadas por código; no se usa ningún asset de GTA/Rockstar.
8. El protagonista (persona real) muere con animaciones normales de juego, nunca humillantes.
9. **Botín sin sangre**: los NPC derrotados sueltan objetos flotantes que brillan (dinero, salud, escudo). ✅ sistema hecho
10. **Tutorial con minicuadros de diálogo**. ✅ hecho
11. **Cerro escalable con carrera de motos cuesta abajo**: premio de $100 si llegas primero (fase 6, con las motos).
12. **Casas en las que se entra, con NPC adentro** (familias en la sala o la cocina) (fase 5/6).
13. **Camiones de comida rápida** (comprar y comer), **tiendas** en las que se entra y **gimnasio** (Gimnasio Olimpus de OSM) con animaciones de levantar pesas, comer y cansarse (fase 6).
14. **Tráfico con semáforos y policía**: los delitos (golpes, robos, atropellos) suben un nivel de búsqueda; la policía persigue y arresta (fase 6).

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
- Los datos de OSM se bajan de la API oficial (`api.openstreetmap.org`), porque Overpass corta las conexiones desde este entorno; el importador también acepta un `.osm` exportado a mano.
- OSM vs. referencias: la Plaza La Marsellesa **no existe** en OSM; el C.C. Trigal Sur aparece como **"C.C. Trigal Centro"**; solo hay 1 huella de edificio en el área, así que las casas se generan sobre lotes reales a lo largo de las calles.
- El césped de las plazas va al ras y debajo del asfalto: si el polígono de OSM invade la calzada, manda la calle.
- Elevaciones (distribuidor, autopista) planas por ahora.
