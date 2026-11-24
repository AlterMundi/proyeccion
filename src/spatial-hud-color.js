import {MeshBasicMaterial} from 'three';

const alphaHex = /^#([\da-f]{3})([\da-f])$|^#([\da-f]{6})([\da-f]{2})$/i;

/** Preserve alpha in the CSS hex tokens used by a host's palette. */
export function setHudMeshColor(material, color, opacity = 1) {
  const match = typeof color === 'string' && alphaHex.exec(color);
  if (match) {
    const [, rgbShort, alphaShort, rgb, alpha] = match;
    color = '#' + (rgb ?? rgbShort);
    opacity *= Number.parseInt(alpha ?? alphaShort.repeat(2), 16) / 255;
  }
  material.color.set(color);
  material.opacity = opacity;
  const transparent = opacity < 1;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
}

export function hudMeshMaterial(color) {
  const material = new MeshBasicMaterial({toneMapped: false});
  setHudMeshColor(material, color);
  return material;
}
