export const MAX_TRIANGLES = 500;
export const MAX_WIDTH = 640;
export const MAX_HEIGHT = 480;
export const NEAR_Z = 1;

export type Vec3 = readonly [number, number, number];
export type RGB = readonly [number, number, number];

export interface Vertex {
  position: Vec3;
  color: RGB;
}

export interface Mesh {
  vertices: Vertex[];
  /** Each consecutive group of three indices defines one triangle. */
  indices: number[];
}

export interface Camera {
  /** Camera position in world coordinates. */
  position: Vec3;
  /** Yaw around the world Y axis, in radians. */
  yaw: number;
  /** Pitch around the camera's X axis, in radians. */
  pitch: number;
  /**
   * Focal length in pixels. With no zoom UI this is normally
   * `min(width, height) / 2`; one world unit projects to `f/z` pixels.
   */
  focalLength: number;
}

export interface RenderFrame {
  width: number;
  height: number;
  /** Opaque RGBA8 color buffer. */
  colors: Uint8ClampedArray;
  /** Camera-space z. Infinity means a background pixel. */
  depth: Float32Array;
  /** Original input triangle number; -1 means a background pixel. */
  primitiveId: Int32Array;
}

export interface RenderRequest {
  seq: number;
  width: number;
  height: number;
  camera: Camera;
  mesh: Mesh;
}

export type RenderResponse =
  | {
      type: 'frame';
      seq: number;
      width: number;
      height: number;
      colors: Uint8ClampedArray;
      depth: Float32Array;
      primitiveId: Int32Array;
    }
  | { type: 'error'; seq: number; message: string };
