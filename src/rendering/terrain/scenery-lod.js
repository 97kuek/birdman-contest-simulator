import { Box3, BufferGeometry, Color, Group, InstancedMesh, LOD, Matrix4, Sphere, Vector3 } from 'three';

const viewMatrix = new Matrix4();
const viewBounds = new Box3();
const position = new Vector3();
const transform = new Matrix4();
const colour = new Color();
const referenceHeight = 1440; // Used for distance-based raycasts and cameras without a render target.

// The renderer calls LOD.update separately for the flight and reflection cameras.
// All placement buffers are static, so a nested lake pass cannot overwrite them.
class SceneryCell extends LOD {
  copy(source) {
    super.copy(source);
    this.bounds = source.bounds;
    this.instanceRadius = source.instanceRadius;
    this.error = source.error;
    return this;
  }

  update(camera) {
    viewMatrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld);
    viewBounds.copy(this.bounds).applyMatrix4(viewMatrix);
    const depth = camera.isPerspectiveCamera ? Math.max(.01, -viewBounds.max.z) : 1;
    const height = camera.userData.renderHeight ?? referenceHeight;
    const pixelsPerMetre = height * .5 * Math.abs(camera.projectionMatrix.elements[5])
      * this.matrixWorld.getMaxScaleOnAxis() / depth;
    const visible = this.instanceRadius * pixelsPerMetre >= 1.25;
    const [near, far] = this.children;
    near.visible = visible && (!far || this.error * pixelsPerMetre > 1.25);
    if (far) far.visible = visible && !near.visible;
  }
}

function splitField(source, indices, triangles, emit) {
  const elements = source.instanceMatrix.array;
  const bounds = new Box3();
  for (const i of indices) bounds.expandByPoint(position.fromArray(elements, i * 16 + 12));
  const width = bounds.max.x - bounds.min.x, length = bounds.max.z - bounds.min.z;
  // Split along the field's long axis. Long, thin shorelines need few draws;
  // stop splitting if a batch is already cheap or its instances are close together.
  if (indices.length < 2 || indices.length * triangles <= 24000 || Math.max(width, length) < 85) {
    emit(indices);
    return;
  }
  const offset = width > length ? 12 : 14;
  indices.sort((a, b) => elements[a * 16 + offset] - elements[b * 16 + offset]);
  const middle = Math.ceil(indices.length / 2);
  splitField(source, indices.slice(0, middle), triangles, emit);
  splitField(source, indices.slice(middle), triangles, emit);
}

function partitionField(source) {
  const { geometry, material } = source;
  const detail = geometry.userData.venueLod;
  let farGeometry;
  if (detail.indices) {
    farGeometry = new BufferGeometry();
    for (const [name, attr] of Object.entries(geometry.attributes)) farGeometry.setAttribute(name, attr);
    farGeometry.setIndex(detail.indices);
  }
  const field = new Group().copy(source, false);
  geometry.computeBoundingSphere();
  splitField(source, Array.from({ length: source.count }, (_, i) => i), geometry.index.count / 3, rows => {
    const cell = new SceneryCell();
    const near = new InstancedMesh(geometry, material, rows.length);
    near.castShadow = source.castShadow;
    near.receiveShadow = source.receiveShadow;
    let maxScale = 0;
    rows.forEach((row, i) => {
      source.getMatrixAt(row, transform);
      near.setMatrixAt(i, transform);
      maxScale = Math.max(maxScale, transform.getMaxScaleOnAxis());
      if (source.instanceColor) {
        source.getColorAt(row, colour);
        near.setColorAt(i, colour);
      }
    });
    near.computeBoundingBox();
    near.boundingSphere = near.boundingBox.getBoundingSphere(new Sphere());
    cell.bounds = near.boundingBox;
    cell.instanceRadius = geometry.boundingSphere.radius * maxScale;
    cell.error = (detail.error ?? 0) * maxScale;
    cell.addLevel(near, 0);
    if (farGeometry) {
      const far = new InstancedMesh(farGeometry, material, 0);
      far.instanceMatrix = near.instanceMatrix;
      far.instanceColor = near.instanceColor;
      far.count = near.count;
      far.boundingSphere = near.boundingSphere;
      far.castShadow = near.castShadow;
      far.receiveShadow = near.receiveShadow;
      far.visible = false;
      cell.addLevel(far, cell.error * referenceHeight * .5 / 1.25);
    }
    field.add(cell);
  });
  source.parent.add(field);
  source.removeFromParent();
}

export function prepareSceneryLod(scene) {
  const fields = [];
  scene.traverse(part => {
    if (part.isInstancedMesh && part.geometry.userData.venueLod) fields.push(part);
  });
  for (const source of fields) partitionField(source);
}
