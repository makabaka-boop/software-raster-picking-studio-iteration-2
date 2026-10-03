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
const v = (x: number, y: number, z: number) => ({ position: [x, y, z] as const, color: [1, 1, 1] as const });

const mask = (frame: RenderFrame, x: number, y: number): number => {
  const layer = frame.edges;
  if (layer === null) throw new Error('edge layer was not generated');
  return layer[y * frame.width + x];
};
const countMask = (frame: RenderFrame): number => {
  const layer = frame.edges;
  if (layer === null) throw new Error('edge layer was not generated');
  let count = 0;
  for (const value of layer) if (value === 1) count++;
  return count;
};

// A z=2 square, f=3 on an 8x8 target projects to screen (2.25,2.25)-
// (5.75,5.75): every side and the x=y diagonal runs exactly through
// pixel-center rows, columns and diagonals, so coverage is hand-countable.
const centerSquare = (): { vertices: Mesh['vertices']; forward: number[]; swapped: number[] } => ({
  vertices: [
    v(-7 / 6, -7 / 6, 2),
    v(7 / 6, -7 / 6, 2),
    v(7 / 6, 7 / 6, 2),
    v(-7 / 6, 7 / 6, 2),
  ],
  forward: [0, 2, 1, 0, 3, 2],
  swapped: [0, 3, 2, 0, 2, 1],
});

describe('visible-edge overlay: shared edge de-duplication', () => {
  it('marks each shared edge once, independently of triangle submission order', () => {
    const square = centerSquare();
    const frame = renderFrame(8, 8, camera, mesh(square.vertices, square.forward), true);
    const swapped = renderFrame(8, 8, camera, mesh(square.vertices, square.swapped), true);

    // Four sides cover 4 centers each (2..5); the diagonal covers
    // (2,2),(3,3),(4,4),(5,5); all six shared corners are unioned once.
    expect(countMask(frame)).toBe(14);
    expect(Array.from(frame.edges!)).toEqual(Array.from(swapped.edges!));

    for (const p of [2, 3, 4, 5]) {
      expect(mask(frame, p, p)).toBe(1); // shared diagonal
      expect(mask(frame, 2, p)).toBe(1); // shared left side
      expect(mask(frame, 5, p)).toBe(1); // shared right side
      expect(mask(frame, p, 2)).toBe(1); // shared top side
      expect(mask(frame, p, 5)).toBe(1); // shared bottom side
    }
  });

  it('does not light a shared edge twice when the same triangle is resubmitted', () => {
    const square = centerSquare();
    const once = renderFrame(8, 8, camera, mesh(square.vertices, square.forward), true);
    const duplicated = renderFrame(
      8,
      8,
      camera,
      // Same surface submitted twice: every index pair is still one mesh edge.
      mesh(square.vertices, [...square.forward, ...square.forward]),
      true,
    );
    expect(Array.from(duplicated.edges!)).toEqual(Array.from(once.edges!));
    expect(countMask(duplicated)).toBe(14);
  });
});

describe('visible-edge overlay: depth occlusion', () => {
  // 12x12 target. Near triangle screen (2.25,2.25),(9.75,2.25),(2.25,9.75)
  // at z=2; far square screen (3.25,3.25)-(8.75,8.75) at z=8, split on the
  // x=y diagonal. All numbers below are pixel-center coordinates.
  const occlusionMesh = (): Mesh =>
    mesh(
      [
        v(-8 / 3, -8 / 3, 2),
        v(8 / 3, -8 / 3, 2),
        v(-8 / 3, 8 / 3, 2),
        v(-22 / 3, -22 / 3, 8),
        v(22 / 3, -22 / 3, 8),
        v(22 / 3, 22 / 3, 8),
        v(-22 / 3, 22 / 3, 8),
      ],
      // Near triangle 0,1,2 then far square 3,5,4 / 3,6,5.
      [0, 1, 2, 3, 5, 4, 3, 6, 5],
    );

  it('hides far edges behind the near surface and keeps near and visible far edges', () => {
    const frame = renderFrame(12, 12, camera, occlusionMesh(), true);

    // Far z=8 edge points covered by the near z=2 triangle are hidden:
    // (4,4) on the far diagonal, (5,3) on the far top edge, (3,5) on the
    // far left edge. None is within half a pixel of a near edge, so this
    // is occlusion rather than overlay coverage.
    expect(mask(frame, 4, 4)).toBe(0);
    expect(mask(frame, 5, 3)).toBe(0);
    expect(mask(frame, 3, 5)).toBe(0);

    // (8,8): far diagonal over the far square itself stays visible.
    expect(mask(frame, 8, 8)).toBe(1);
    // (8,4): far right silhouette edge over the far square.
    expect(mask(frame, 8, 4)).toBe(1);
    // Far diagonal below the near triangle remains visible.
    expect(mask(frame, 8, 7)).toBe(1);

    // The near hypotenuse edge (x+y=10) wins wherever it overlaps the
    // collinear far diagonal: z=2 is nearer than z=8.
    expect(mask(frame, 8, 3)).toBe(1);
    expect(mask(frame, 3, 8)).toBe(1);

    // Nothing is visible over the background.
    expect(mask(frame, 10, 10)).toBe(0);
    expect(mask(frame, 1, 1)).toBe(0);
  });

  it('produces byte-identical color, depth and id buffers whether edges are on or off', () => {
    const plain = renderFrame(12, 12, camera, occlusionMesh(), false);
    const withEdges = renderFrame(12, 12, camera, occlusionMesh(), true);

    expect(plain.edges).toBe(null);
    expect(withEdges.edges).not.toBe(null);
    expect(Array.from(withEdges.colors)).toEqual(Array.from(plain.colors));
    expect(Array.from(withEdges.depth)).toEqual(Array.from(plain.depth));
    expect(Array.from(withEdges.primitiveId)).toEqual(Array.from(plain.primitiveId));
  });
});

describe('visible-edge overlay: near-plane crossing', () => {
  it('keeps edges lying on the near plane and clips edges crossing it', () => {
    // Camera-x-aligned fronto-parallel quad, front at z=1 and back at z=4.
    // With f=3 the front projects to (1.75,1.75)-(6.25,1.75); the back to
    // (2.3125,4.1875)-(5.6875,4.1875). The clipped front edge lies on the
    // near plane and its centers land on the filled surface.
    const clipped = mesh(
      [
        v(-0.75, -0.75, 1),
        v(0.75, -0.75, 1),
        v(2.25, 0.25, 4),
        v(-2.25, 0.25, 4),
      ],
      [0, 1, 3, 3, 1, 2],
    );
    const frame = renderFrame(8, 8, camera, clipped, true);

    // Front cap edge at z=1 runs through row-1 centers columns 2..5.
    for (const x of [2, 3, 4, 5]) expect(mask(frame, x, 1)).toBe(1);
    // Back edge at z=4 runs through row-4 centers columns 2..5.
    for (const x of [2, 3, 4, 5]) expect(mask(frame, x, 4)).toBe(1);
    // The sloping sides cover further rows.
    expect(mask(frame, 1, 2)).toBe(1);
    expect(mask(frame, 6, 2)).toBe(1);
    // Interior pixels strictly away from every edge are not edges.
    expect(mask(frame, 3, 2)).toBe(0);
    expect(mask(frame, 4, 2)).toBe(0);
    // Below the clipped surface there is nothing.
    expect(mask(frame, 3, 6)).toBe(0);
  });

  it('clips an edge crossing the near plane instead of dropping it, and adds no extra cap segment', () => {
    // Apex (0, 20/9, 0) is in front of the near plane; the base at z=4
    // projects to (2.25,2.25)/(5.75,2.25). Each side crosses z=1 at a
    // third of its length and ends at (2.25,7.25)/(5.75,7.25). There is
    // no mesh edge along the near intersection.
    const crossingTriangle = mesh(
      [v(0, 20 / 9, 0), v(-7 / 3, -7 / 3, 4), v(7 / 3, -7 / 3, 4)],
      [0, 1, 2],
    );
    const frame = renderFrame(8, 8, camera, crossingTriangle, true);

    // Both clipped sides land on column centers from the front row down
    // to the row containing the near intersection.
    for (const y of [2, 3, 4, 5, 6]) {
      expect(mask(frame, 2, y)).toBe(1);
      expect(mask(frame, 5, y)).toBe(1);
    }
    // No synthetic cap segment joins the two near intersections.
    expect(mask(frame, 3, 7)).toBe(0);
    expect(mask(frame, 4, 7)).toBe(0);
    expect(mask(frame, 3, 6)).toBe(0);
    // Nothing above the apex clip or to the sides.
    expect(mask(frame, 0, 0)).toBe(0);
  });
});

describe('visible-edge overlay: pixel boundaries', () => {
  it('covers an edge exactly through a pixel center and excludes the exact half-pixel tie', () => {
    // z=2 square projects to screen (2.5,3.5)-(5.5,6.5): its top side runs
    // exactly through row-3 centers and its right side through column-5.
    const exact = mesh(
      [
        v(-1, -1 / 3, 2),
        v(1, -1 / 3, 2),
        v(1, 5 / 3, 2),
        v(-1, 5 / 3, 2),
      ],
      [0, 2, 1, 0, 3, 2],
    );
    const frame = renderFrame(8, 8, camera, exact, true);
    expect(mask(frame, 4, 3)).toBe(1); // center exactly on the top side
    expect(mask(frame, 4, 2)).toBe(0); // one full pixel row away
    expect(mask(frame, 4, 4)).toBe(0);
    expect(mask(frame, 5, 5)).toBe(1); // center exactly on the right side
    expect(mask(frame, 6, 5)).toBe(0); // one full column away
    // (4,5) sits exactly on the x=y diagonal, so it is an edge; (3,5) is
    // strictly interior and away from every edge.
    expect(mask(frame, 4, 5)).toBe(1);
    expect(mask(frame, 3, 5)).toBe(0);

    // Top side endpoints: segment ends at (2.5,y) and (5.5,y); the endpoint
    // center (5.5,3.5) is included, (6.5,3.5) excluded.
    expect(mask(frame, 5, 3)).toBe(1);
    expect(mask(frame, 2, 3)).toBe(1);
    expect(mask(frame, 6, 3)).toBe(0);

    // z=2 square whose top side projects to the integer line y=3: every
    // adjacent center is exactly 0.5px away, which the radius excludes.
    const tie = mesh(
      [
        v(-4 / 3, -2 / 3, 2),
        v(4 / 3, -2 / 3, 2),
        v(4 / 3, 4 / 3, 2),
        v(-4 / 3, 4 / 3, 2),
      ],
      [0, 2, 1, 0, 3, 2],
    );
    const tieFrame = renderFrame(8, 8, camera, tie, true);
    expect(mask(tieFrame, 3, 2)).toBe(0); // 0.5px above the line
    expect(mask(tieFrame, 3, 3)).toBe(0); // 0.5px below: exact tie excluded
    // The bottom side at y=6 has the same rule.
    expect(mask(tieFrame, 3, 5)).toBe(0);
    expect(mask(tieFrame, 3, 6)).toBe(0);
  });
});
