import {Matrix4, Quaternion, Vector3} from 'three';

/**
 * Place an owned HUD group on a camera plane while keeping CSS-pixel size.
 * x/y are viewport pixels from the top left. The group's origin is its
 * top-center anchor; keep passing the active camera as the player moves.
 */
export function placeHudInViewport(group, camera, {
  width, height, x = width / 2, y = height / 2, pixelsPerUnit = 220,
  depth = Math.min(Math.max(camera.near * 4, 0.1), (camera.near + camera.far) / 2),
}) {
  if (![width, height, x, y, depth, pixelsPerUnit].every(Number.isFinite)
      || width <= 0 || height <= 0 || pixelsPerUnit <= 0 || depth <= camera.near || depth >= camera.far) {
    throw new RangeError('HUD placement requires a positive viewport, pixel scale and depth within the camera frustum');
  }
  camera.updateWorldMatrix(true, false);
  const z = new Vector3(0, 0, -depth).applyMatrix4(camera.projectionMatrix).z;
  const left = x / width * 2 - 1;
  const top = 1 - y / height * 2;
  const origin = new Vector3(left, top, z).unproject(camera);
  const right = new Vector3(left + 2 / width, top, z).unproject(camera);
  const up = new Vector3(left, top + 2 / height, z).unproject(camera);
  const unitX = origin.distanceTo(right) * pixelsPerUnit;
  const unitY = origin.distanceTo(up) * pixelsPerUnit;
  const world = new Matrix4().compose(origin, camera.getWorldQuaternion(new Quaternion()),
    new Vector3(unitX, unitY, Math.min(unitX, unitY)));
  const parent = group.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    world.premultiply(new Matrix4().copy(parent.matrixWorld).invert());
  }
  // Preserve the exact transform through rotated and scaled scene parents.
  group.matrixAutoUpdate = false;
  group.matrix.copy(world);
  group.matrixWorldNeedsUpdate = true;
}
