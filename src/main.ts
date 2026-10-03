import { TriangleViewer } from './viewer';
import type { Mesh } from './types';

function createCube(): Mesh {
  const h = 1.4;
  // Positions are centered at z=3. Color follows the normal axis.
  const vertices = [
    { position: [-h, -h, 3 - h] as const, color: [0.05, 0.05, 0.05] as const },
    { position: [h, -h, 3 - h] as const, color: [0.8, 0.1, 0.1] as const },
    { position: [h, h, 3 - h] as const, color: [0.8, 0.8, 0.1] as const },
    { position: [-h, h, 3 - h] as const, color: [0.1, 0.8, 0.1] as const },
    { position: [-h, -h, 3 + h] as const, color: [0.1, 0.1, 0.8] as const },
    { position: [h, -h, 3 + h] as const, color: [0.8, 0.1, 0.8] as const },
    { position: [h, h, 3 + h] as const, color: [0.9, 0.9, 0.9] as const },
    { position: [-h, h, 3 + h] as const, color: [0.1, 0.8, 0.8] as const },
  ];
  return {
    vertices,
    indices: [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3,
      3, 7, 4, 3, 4, 0,
    ],
  };
}

const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
if (!canvas) throw new Error('missing #viewport canvas');

const viewer = new TriangleViewer(canvas, { width: 640, height: 480, mesh: createCube() });
let dragging = false;
let lastX = 0;
let lastY = 0;
const readout = document.querySelector('#pick-readout');
const wireframeToggle = document.querySelector<HTMLInputElement>('#wireframe-toggle');
wireframeToggle?.addEventListener('change', () => {
  viewer.setWireframe(wireframeToggle.checked);
});

canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const rotation = viewer.getRotation();
  viewer.setRotation(
    rotation.yaw + (event.clientX - lastX) * 0.01,
    rotation.pitch + (event.clientY - lastY) * 0.01,
  );
  lastX = event.clientX;
  lastY = event.clientY;
});
canvas.addEventListener('pointerup', () => {
  dragging = false;
});
canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * canvas.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * canvas.height / rect.height);
  const id = viewer.pick(x, y);
  if (readout) readout.textContent = `triangle: ${id}`;
});

globalThis.addEventListener('beforeunload', () => viewer.dispose());
