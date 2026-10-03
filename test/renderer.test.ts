import { describe, expect, it } from 'vitest';
import { renderFrame } from '../src/renderer';
import type { Camera, Mesh, RenderFrame } from '../src/types';

const camera: Camera = {
  position: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  focalLength: 3,
};

const mesh = (vertices: Mesh['vertices'], indices: number[]): Mesh => ({ vertices, indices });
const v = (x: number, y: number, z: number, color: [number, number, number]) => ({
  position: [x, y, z] as const,
  color,
});
const pixel = (frame: RenderFrame, x: number, y: number) => {
  const i = y * frame.width + x;
  return {
    id: frame.primitiveId[i],
    depth: frame.depth[i],
    rgb: [frame.colors[i * 4], frame.colors[i * 4 + 1], frame.colors[i * 4 + 2]],
  };
};
const closeTo = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 6);

describe('near-plane clipping and perspective-correct interpolation', () => {
  it('clips one behind vertex, preserves the source id and interpolates the clipped edge', () => {
    // The front edge is deliberately wound left-to-right after clipping so
    // the two pixel centers exactly on z=1 use the top-left fill rule.
    const geometry = mesh(
      [
        v(0, -4, -2, [0, 0, 0]),
        v(-1, -1, 2, [1, 1, 0]),
        v(1, -1, 2, [0, 1, 1]),
      ],
      [0, 2, 1],
    );

    const frame = renderFrame(8, 8, camera, geometry);

    // Intersections at x=±0.5, y=-2, z=1 project to (2.5,1.5) and
    // (4.5,1.5). Only the top-row pixel centers fall inside this clipped
    // fan; the edge itself is excluded by the fill convention.
    expect(pixel(frame, 2, 0).id).toBe(0);
    expect(pixel(frame, 4, 0).id).toBe(0);
    closeTo(pixel(frame, 2, 0).depth, 30 / 23);
    expect(pixel(frame, 2, 0).rgb).toEqual([188, 211, 22]);
    expect(pixel(frame, 4, 0).rgb).toEqual([78, 211, 133]);

    expect(pixel(frame, 3, 3).id).toBe(-1);

    // This fixture places the z=1 intersection exactly one sampled pixel
    // center above its screen edge; its hand-computed depth is therefore 2.
    const exactClip = mesh(
      [
        v(0, -4, -2, [0, 0, 0]),
        v(-1.5, -1, 2, [1, 1, 0]),
        v(-0.5, -1, 2, [0, 1, 1]),
      ],
      [0, 2, 1],
    );
    const exactFrame = renderFrame(8, 8, camera, exactClip);
    expect(pixel(exactFrame, 2, 2).id).toBe(0);
    closeTo(pixel(exactFrame, 2, 2).depth, 2);
    expect(pixel(exactFrame, 2, 2).rgb).toEqual([128, 255, 128]);
  });

  it('rejects a triangle wholly behind z=1', () => {
    const geometry = mesh(
      [v(-1, -1, 0, [1, 0, 0]), v(1, -1, 0, [0, 1, 0]), v(0, 1, 0, [0, 0, 1])],
      [0, 1, 2],
    );
    const frame = renderFrame(8, 8, camera, geometry);
    expect(frame.primitiveId.every((id) => id === -1)).toBe(true);
    expect(frame.depth.every((z) => z === Infinity)).toBe(true);
  });
});

describe('depth buffering and primitive ids', () => {
  it('uses camera-space z so a later near triangle wins while farther pixels remain', () => {
    // Screen square (2,2)-(6,6). The far z=4 square is split by 0,2,1 and
    // 0,3,2. A near z=2 copy of the lower-left fan is submitted afterwards.
    const geometry = mesh(
      [
        v(-8 / 3, -8 / 3, 4, [0, 0, 1]),
        v(8 / 3, -8 / 3, 4, [0, 0, 1]),
        v(8 / 3, 8 / 3, 4, [0, 0, 1]),
        v(-8 / 3, 8 / 3, 4, [0, 0, 1]),
        v(-4 / 3, -4 / 3, 2, [1, 0, 0]),
        v(4 / 3, -4 / 3, 2, [1, 0, 0]),
        v(-4 / 3, 4 / 3, 2, [1, 0, 0]),
      ],
      [0, 2, 1, 0, 3, 2, 4, 6, 5],
    );

    const frame = renderFrame(8, 8, camera, geometry);

    expect(pixel(frame, 3, 3)).toMatchObject({ id: 2, depth: 2, rgb: [255, 0, 0] });
    expect(pixel(frame, 4, 4)).toMatchObject({ id: 0, depth: 4, rgb: [0, 0, 255] });
    expect(pixel(frame, 5, 5)).toMatchObject({ id: 0, depth: 4, rgb: [0, 0, 255] });
    expect(pixel(frame, 0, 0).id).toBe(-1);
  });
});

describe('top-left pixel ownership', () => {
  it('fills a triangle with the hand-counted edge pixels and no double ownership', () => {
    // z=2, f=3, screen square (2,2)-(6,6), split on x=y.
    const geometry = mesh(
      [
        v(-4 / 3, -4 / 3, 2, [1, 0, 0]),
        v(4 / 3, -4 / 3, 2, [0, 1, 0]),
        v(4 / 3, 4 / 3, 2, [0, 0, 1]),
        v(-4 / 3, 4 / 3, 2, [1, 1, 1]),
      ],
      [0, 2, 1, 0, 3, 2],
    );
    const frame = renderFrame(8, 8, camera, geometry);

    let covered = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) if (frame.primitiveId[y * 8 + x] !== -1) covered++;
    }
    expect(covered).toBe(16);

    expect(pixel(frame, 2, 2).id).toBe(0);
    expect(pixel(frame, 5, 2).id).toBe(0);
    expect(pixel(frame, 2, 5).id).toBe(1);
    expect(pixel(frame, 6, 2).id).toBe(-1);
    expect(pixel(frame, 2, 6).id).toBe(-1);
    expect(pixel(frame, 5, 5).id).toBe(0);
    expect(pixel(frame, 4, 4).id).toBe(0);
  });

  it('owns diagonal shared-edge pixels independently of submission order', () => {
    // Same square as above; the diagonal x = y passes exactly through
    // pixel centers. The (0, 2, 1) triangle owns it in both orders:
    // submitted as id 0 in `forward` and as id 1 in `swapped`.
    const vertices = [
      v(-4 / 3, -4 / 3, 2, [1, 0, 0]),
      v(4 / 3, -4 / 3, 2, [0, 1, 0]),
      v(4 / 3, 4 / 3, 2, [0, 0, 1]),
      v(-4 / 3, 4 / 3, 2, [1, 1, 1]),
    ];
    const forward = renderFrame(8, 8, camera, mesh(vertices, [0, 2, 1, 0, 3, 2]));
    const swapped = renderFrame(8, 8, camera, mesh(vertices, [0, 3, 2, 0, 2, 1]));

    for (const p of [2, 3, 4, 5]) {
      expect(pixel(forward, p, p).id).toBe(0);
      expect(pixel(swapped, p, p).id).toBe(1);
    }
  });

  it('owns horizontal shared-edge pixels independently of submission order', () => {
    // Two quads stacked at screen y = 4.5, so the shared edge passes
    // exactly through pixel centers. The upper triangle (0, 2, 3) owns
    // the boundary row: id 1 in `forward`, id 3 in `swapped`.
    const vertices = [
      v(-4 / 3, -4 / 3, 2, [1, 0, 0]),
      v(4 / 3, -4 / 3, 2, [1, 0, 0]),
      v(4 / 3, 1 / 3, 2, [0, 1, 0]),
      v(-4 / 3, 1 / 3, 2, [0, 1, 0]),
      v(4 / 3, 4 / 3, 2, [0, 0, 1]),
      v(-4 / 3, 4 / 3, 2, [0, 0, 1]),
    ];
    const forward = renderFrame(8, 8, camera, mesh(vertices, [0, 1, 2, 0, 2, 3, 3, 2, 4, 3, 4, 5]));
    const swapped = renderFrame(8, 8, camera, mesh(vertices, [3, 2, 4, 3, 4, 5, 0, 1, 2, 0, 2, 3]));

    for (const x of [2, 3, 4, 5]) {
      expect(pixel(forward, x, 4).id).toBe(1);
      expect(pixel(swapped, x, 4).id).toBe(3);
    }
  });
});

describe('perspective-correct color interpolation', () => {
  it('does not linearly interpolate colors across screen x', () => {
    // At pixel (3,3), screen barycentric weights are equal; perspective
    // weights are (1/4,1/2,1/4), proving perspective-correct interpolation.
    const geometry = mesh(
      [
        v(-1, -1, 2, [0, 1, 0]),
        v(1, -1, 4, [1, 0, 0]),
        v(-1, 1, 4, [0, 0, 1]),
      ],
      [0, 1, 2],
    );
    const frame = renderFrame(8, 8, camera, geometry);
    expect(pixel(frame, 3, 3).rgb).toEqual([64, 128, 64]);
    closeTo(pixel(frame, 3, 3).depth, 3);
  });
});

describe('camera rotation and limits', () => {
  it('moves a +X triangle into view after a 90-degree yaw', () => {
    const geometry = mesh(
      [v(2.5, -0.5, -0.5, [1, 1, 1]), v(3.5, -0.5, 0.5, [1, 1, 1]), v(3, 0.5, 0, [1, 1, 1])],
      [0, 1, 2],
    );
    const front = renderFrame(8, 8, camera, geometry);
    expect(front.primitiveId.every((id) => id === -1)).toBe(true);

    const rotated = renderFrame(8, 8, { ...camera, yaw: -Math.PI / 2 }, geometry);
    expect(rotated.primitiveId.some((id) => id === 0)).toBe(true);
  });

  it('matches the composed yaw-then-pitch transform under combined rotation', () => {
    // yaw = pitch = 90° maps world (x, y, z) to camera (z, x, y), so the
    // y = 2 plane becomes fronto-parallel at camera depth 2 and projects
    // to screen (10, 8), (10, 10), (12, 9) with focal length 2.
    const geometry = mesh(
      [v(0, 2, 2, [1, 0, 0]), v(2, 2, 2, [0, 1, 0]), v(1, 2, 4, [0, 0, 1])],
      [0, 1, 2],
    );
    const combined: Camera = {
      position: [0, 0, 0],
      yaw: Math.PI / 2,
      pitch: Math.PI / 2,
      focalLength: 2,
    };
    const frame = renderFrame(16, 16, combined, geometry);

    expect(pixel(frame, 10, 8).id).toBe(0);
    expect(pixel(frame, 10, 9).id).toBe(0);
    closeTo(pixel(frame, 10, 8).depth, 2);
    closeTo(pixel(frame, 10, 9).depth, 2);
  });

  it('enforces maximum frame and triangle counts', () => {
    expect(() => renderFrame(641, 480, camera, { vertices: [], indices: [] })).toThrow(/640/);
    expect(() => renderFrame(640, 481, camera, { vertices: [], indices: [] })).toThrow(/480/);

    const vertices = [v(0, 0, 2, [1, 1, 1]), v(1, 0, 2, [1, 1, 1]), v(0, 1, 2, [1, 1, 1])];
    expect(() =>
      renderFrame(
        1,
        1,
        camera,
        { vertices, indices: new Array(501 * 3).fill(0).map((_, i) => i % 3) },
      ),
    ).toThrow(/500/);
  });
});
