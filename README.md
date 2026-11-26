# Trigal Sur: demo de mundo abierto

Demo 3D en tercera persona para recorrer El Trigal Sur (Valencia, Carabobo, Venezuela) en el navegador.
Three.js + TypeScript + Vite, sin motores pesados ni llamadas externas durante el juego.

## Uso

```bash
npm install
npm run dev        # servidor de desarrollo
npm run build      # compila a dist/ (sitio estático)
npm test           # pruebas
npm run map:fetch  # descarga datos de OpenStreetMap a data/trigal-sur.json
```

## Controles

WASD/flechas para moverse, ratón para la cámara, Shift para correr, Alt para caminar, Espacio para saltar,
E para saludar o sentarse, F para subir o bajar de un vehículo, clic izquierdo o Q para golpear, V o la rueda para la distancia de la cámara,
M para el mapa, Esc para pausar, F3 para la depuración.

## Estado

Ver [docs/PLAN.md](docs/PLAN.md). Fase 1 terminada (bucle, pantallas, cámara, HUD básico, escenario de prueba).

## Créditos

Datos del mapa © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licencia ODbL.
Proyecto original; no usa nombres, personajes ni recursos de otros juegos.
La foto de referencia del protagonista se procesa solo en local y no se incluye en el repositorio.
