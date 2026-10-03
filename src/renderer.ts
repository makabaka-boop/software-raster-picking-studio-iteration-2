import { lerp, sub } from './math';
import {
  MAX_HEIGHT,
  MAX_TRIANGLES,
  MAX_WIDTH,
  NEAR_Z,
  type Camera,
  type Mesh,
  type RenderFrame,
  type RGB,
  type Vec3,
  type Vertex,
} from './types';

interface CameraVertex {
  x: number;
  y: number;
  z: number;
  color: RGB;
}

interface ClipVertex extends CameraVertex {}

interface RasterVertex {
  x: number;
  y: number;
  /** Reciprocal of camera-space z, used for perspective-correct weights. */
  invW: number;
  colorOverW: RGB;
  /** Camera-space z is interpolated by inverse-z weights. */
  depthOverW: number;
}

/**
 * World-to-camera transform. In camera space the camera looks toward +Z,
 * +X points right and +Y points down on the screen.
 */
function rotateWorldVector(v: Vec3, camera: Camera): Vec3 {
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);

  // yaw: camera x = cos yaw * world x + sin yaw * world z
  //      camera z = -sin yaw * world x + cos yaw * world z
  // pitch: camera y = cos pitch * world y - sin pitch * camera z(yaw)
  //        camera z = sin pitch * world y + cos pitch * camera z(yaw)
  return [
    cy * v[0] + sy * v[2],
    cp * v[1] + sp * sy * v[0] - sp * cy * v[2],
    sp * v[1] - cp * sy * v[0] + cp * cy * v[2],
  ];
}

function toCameraVertex(vertex: Vertex, camera: Camera): CameraVertex {
  const relative = sub(vertex.position, camera.position);
  const p = rotateWorldVector(relative, camera);
  return { x: p[0], y: p[1], z: p[2], color: vertex.color };
}

function interpolateClipVertex(a: ClipVertex, b: ClipVertex, t: number): ClipVertex {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    color: [
      lerp(a.color[0], b.color[0], t),
      lerp(a.color[1], b.color[1], t),
      lerp(a.color[2], b.color[2], t),
    ],
  };
}

/** Sutherland-Hodgman clipping against the single near plane z >= NEAR_Z. */
function clipNearTriangle(input: readonly CameraVertex[]): ClipVertex[] {
  const output: ClipVertex[] = [];
  let previous = input[input.length - 1];
  let previousInside = previous.z >= NEAR_Z;

  for (const current of input) {
    const currentInside = current.z >= NEAR_Z;

    if (currentInside) {
      if (!previousInside) {
        const denominator = previous.z - current.z;
        const t = (NEAR_Z - current.z) / denominator;
        output.push(interpolateClipVertex(current, previous, t));
      }
      output.push(current);
    } else if (previousInside) {
      const denominator = current.z - previous.z;
      const t = (NEAR_Z - previous.z) / denominator;
      output.push(interpolateClipVertex(previous, current, t));
    }

    previous = current;
    previousInside = currentInside;
  }

  return output;
}

function projectVertex(vertex: ClipVertex, width: number, height: number, focalLength: number): RasterVertex {
  const invW = 1 / vertex.z;
  const sx = width / 2 + focalLength * vertex.x * invW;
  // Camera +Y is screen-down.
  const sy = height / 2 + focalLength * vertex.y * invW;

  return {
    x: sx,
    y: sy,
    invW,
    colorOverW: [
      vertex.color[0] * invW,
      vertex.color[1] * invW,
      vertex.color[2] * invW,
    ],
    depthOverW: vertex.z * invW,
  };
}

function createFrame(width: number, height: number): RenderFrame {
  const pixelCount = width * height;
  return {
    width,
    height,
    colors: new Uint8ClampedArray(pixelCount * 4),
    depth: new Float32Array(pixelCount).fill(Infinity),
    primitiveId: new Int32Array(pixelCount).fill(-1),
  };
}

function validateSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('width and height must be positive integers');
  }
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new Error(`resolution must not exceed ${MAX_WIDTH}×${MAX_HEIGHT}`);
  }
}

function validateMesh(mesh: Mesh): void {
  if (!Array.isArray(mesh.vertices) || !Array.isArray(mesh.indices)) {
    throw new Error('mesh must contain vertices and indices');
  }
  if (mesh.indices.length % 3 !== 0) {
    throw new Error('index count must be divisible by three');
  }
  if (mesh.indices.length / 3 > MAX_TRIANGLES) {
    throw new Error(`a frame cannot contain more than ${MAX_TRIANGLES} triangles`);
  }
  for (const [i, vertex] of mesh.vertices.entries()) {
    const p = vertex.position;
    const c = vertex.color;
    if (!p.every(Number.isFinite) || !c.every(Number.isFinite)) {
      throw new Error(`vertex ${i} contains a non-finite value`);
    }
  }
  for (const index of mesh.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= mesh.vertices.length) {
      throw new Error(`invalid vertex index ${index}`);
    }
  }
}

function validateCamera(camera: Camera): void {
  if (!Number.isFinite(camera.yaw) || !Number.isFinite(camera.pitch)) {
    throw new Error('camera yaw and pitch must be finite');
  }
  if (!Number.isFinite(camera.focalLength) || camera.focalLength <= 0) {
    throw new Error('focalLength must be positive');
  }
  if (!camera.position.every(Number.isFinite)) {
    throw new Error('camera position must be finite');
  }
}

const EDGE_EPSILON = 1e-7;

function rasterize(
  frame: RenderFrame,
  input: readonly [RasterVertex, RasterVertex, RasterVertex],
  primitiveId: number,
): void {
  // A0, A1, A2 are oriented clockwise in y-down screen coordinates.
  let a = input[0];
  let b = input[1];
  let c = input[2];

  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (area <= EDGE_EPSILON) {
    // Reverse a counter-clockwise triangle. Reject a truly degenerate one.
    if (area >= -EDGE_EPSILON) return;
    [b, c] = [c, b];
  }

  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x) + 0.5));
  const maxX = Math.min(frame.width - 1, Math.ceil(Math.max(a.x, b.x, c.x) - 0.5));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y) + 0.5));
  const maxY = Math.min(frame.height - 1, Math.ceil(Math.max(a.y, b.y, c.y) - 0.5));
  if (minX > maxX || minY > maxY) return;

  // For directed edge A->B, E(P) = (B-A) x (P-A). The positive-area
  // interior has E >= 0. An edge owns its E === 0 boundary pixels when it
  // runs toward smaller y, or is horizontal and runs toward smaller x; the
  // same edge traversed the other way then requires E >= EDGE_EPSILON.
  // Every shared edge is therefore owned by exactly one of the two adjacent
  // triangles, independent of submission order.
  const ownsBoundary = (p: RasterVertex, q: RasterVertex): boolean =>
    q.y - p.y < 0 || (q.y === p.y && q.x - p.x < 0);
  const abOwned = ownsBoundary(a, b);
  const bcOwned = ownsBoundary(b, c);
  const caOwned = ownsBoundary(c, a);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const cax = a.x - c.x;
  const cay = a.y - c.y;

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const eab = abx * (py - a.y) - aby * (px - a.x);
      const ebc = bcx * (py - b.y) - bcy * (px - b.x);
      const eca = cax * (py - c.y) - cay * (px - c.x);

      if (
        eab < (abOwned ? 0 : EDGE_EPSILON) ||
        ebc < (bcOwned ? 0 : EDGE_EPSILON) ||
        eca < (caOwned ? 0 : EDGE_EPSILON)
      ) {
        continue;
      }

      const wa = ebc;
      const wb = eca;
      const wc = eab;
      const inverseArea = 1 / area;
      const invW = (wa * a.invW + wb * b.invW + wc * c.invW) * inverseArea;
      const z =
        (wa * a.depthOverW + wb * b.depthOverW + wc * c.depthOverW) /
        (wa * a.invW + wb * b.invW + wc * c.invW);

      const pixelIndex = y * frame.width + x;
      if (z >= frame.depth[pixelIndex]) continue;

      const r = (wa * a.colorOverW[0] + wb * b.colorOverW[0] + wc * c.colorOverW[0]) * inverseArea / invW;
      const g = (wa * a.colorOverW[1] + wb * b.colorOverW[1] + wc * c.colorOverW[1]) * inverseArea / invW;
      const bl = (wa * a.colorOverW[2] + wb * b.colorOverW[2] + wc * c.colorOverW[2]) * inverseArea / invW;
      const colorIndex = pixelIndex * 4;
      frame.colors[colorIndex] = Math.round(r * 255);
      frame.colors[colorIndex + 1] = Math.round(g * 255);
      frame.colors[colorIndex + 2] = Math.round(bl * 255);
      frame.colors[colorIndex + 3] = 255;
      frame.depth[pixelIndex] = z;
      frame.primitiveId[pixelIndex] = primitiveId;
    }
  }
}

export function renderFrame(width: number, height: number, camera: Camera, mesh: Mesh): RenderFrame {
  validateSize(width, height);
  validateCamera(camera);
  validateMesh(mesh);

  const frame = createFrame(width, height);
  const triangleCount = mesh.indices.length / 3;

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const i0 = mesh.indices[triangle * 3];
    const i1 = mesh.indices[triangle * 3 + 1];
    const i2 = mesh.indices[triangle * 3 + 2];
    const cameraVertices = [
      toCameraVertex(mesh.vertices[i0], camera),
      toCameraVertex(mesh.vertices[i1], camera),
      toCameraVertex(mesh.vertices[i2], camera),
    ];

    const polygon = clipNearTriangle(cameraVertices);
    if (polygon.length < 3) continue;

    // Keep every clipped fragment tied to the source triangle.
    const projected = polygon.map((vertex) => projectVertex(vertex, width, height, camera.focalLength));
    for (let i = 1; i < projected.length - 1; i++) {
      rasterize(frame, [projected[0], projected[i], projected[i + 1]], triangle);
    }
  }

  return frame;
}
