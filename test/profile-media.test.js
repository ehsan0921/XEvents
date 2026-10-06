import test from 'node:test';
import assert from 'node:assert/strict';
import {profileFields,profilePreference} from '../src/profile.js';
import {mediaPreview,previewMime} from '../src/media-preview.js';
test('profile validates optional private fields and never returns stored photo identifiers',()=>{
  assert.deepEqual(profileFields({profileName:' Alex ',profilePhone:'+61 400 123 456'}),{profileName:'Alex',profilePhone:'+61 400 123 456'});
  assert.deepEqual(profileFields({profilePhone:''}),{profilePhone:''});assert.throws(()=>profileFields({profilePhone:'invalid'}));assert.throws(()=>profileFields({profileName:'x'.repeat(101)}));
  const p=profilePreference({profileName:'Alex',profilePhone:'123456',profilePhoto:'private-file',starOrders:{secret:true},timezone:'UTC'});
  assert.equal(p.hasPhoto,true);assert.equal(p.profilePhoto,undefined);assert.equal(p.starOrders,undefined);
});
test('image and video documents preview by MIME or extension, while active documents never preview',()=>{
  assert.equal(mediaPreview({type:'document',mimeType:'image/png'}),'photo');assert.equal(previewMime({mimeType:'image/png'}),'image/png');
  assert.equal(mediaPreview({type:'document',filename:'photo.JPG'}),'photo');assert.equal(mediaPreview({type:'document',filename:'movie.webm'}),'video');
  assert.equal(previewMime({filename:'movie.webm'}),'video/webm');assert.equal(mediaPreview({type:'video'}),'video');
  assert.equal(mediaPreview({type:'document',filename:'danger.svg',mimeType:'image/svg+xml'}),null);assert.equal(mediaPreview({filename:'page.html'}),null);
});
