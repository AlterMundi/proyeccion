import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Ray, Vector3} from 'three';
import {createLocomotionControl,createLocomotionInput} from '../src/spatial-hud-locomotion.js';

test('vertical pointers are independent of the stick and cancel without arming jump',()=>{
  const input=createLocomotionInput(({row})=>!row.disabled);
  const palette={button:'#142534',focus:'#ffcb9b'};
  const stick=createLocomotionControl('stick',palette);
  const up={...createLocomotionControl('jump',palette),vertical:1};
  const down={...createLocomotionControl('jump',palette),vertical:-1};
  const ray=new Ray(new Vector3(0,-.2,1),new Vector3(0,0,-1));
  assert.ok(input.start('stick',stick,1,ray));
  assert.ok(input.start('up',up,2,ray));
  assert.ok(input.start('down',down,3,ray));
  assert.deepEqual(input.getOutput(),{direction:0,isSprinting:true,jump:false,vertical:0});
  input.end(2);
  assert.equal(input.getOutput().vertical,-1);
  assert.equal(up.indicator.visible,false);
  down.disabled=true;
  assert.deepEqual(input.getOutput(),{direction:0,isSprinting:true,jump:false});
  assert.equal(down.indicator.visible,false);
  input.end(1);
  input.pulse('up',up);
  up.vertical=0;
  assert.equal(input.getOutput(),null);
  input.pulse('jump',up);
  assert.deepEqual(input.getOutput(),{direction:null,isSprinting:false,jump:true});
});
