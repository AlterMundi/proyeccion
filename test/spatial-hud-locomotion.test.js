import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocomotionInput} from '../src/spatial-hud-locomotion.js';

const jump = (vertical = 0) => ({movement: 'jump', vertical, indicator: {visible: false}});

test('a ground jump released between movement samples is delivered once', () => {
  const input = createLocomotionInput(() => true);
  assert.equal(input.start('jump', jump(), 1), true);
  input.end(1, {commit: true});
  assert.equal(input.getOutput()?.jump, true);
  assert.equal(input.getOutput(), null);
});

test('a sampled jump, cancelled touch and released ascent do not queue another jump', () => {
  const input = createLocomotionInput(() => true);
  assert.equal(input.start('jump', jump(), 1), true);
  assert.equal(input.getOutput()?.jump, true);
  input.end(1, {commit: true});
  assert.equal(input.getOutput(), null);

  assert.equal(input.start('jump', jump(), 2), true);
  input.end(2);
  assert.equal(input.getOutput(), null);

  assert.equal(input.start('up', jump(1), 3), true);
  input.end(3, {commit: true});
  assert.equal(input.getOutput(), null);
});

test('a short jump is dropped when its surface is no longer interactive', () => {
  let available = true;
  const input = createLocomotionInput(() => available);
  assert.equal(input.start('jump', jump(), 1), true);
  input.end(1, {commit: true});
  available = false;
  assert.equal(input.getOutput(), null);
});
