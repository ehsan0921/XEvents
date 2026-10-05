import test from 'node:test';
import assert from 'node:assert/strict';
import { adminOverview, isSuperAdmin } from '../src/admin.js';

test('super admin is identified by verified numeric Telegram ID only',()=>{
  assert.equal(isSuperAdmin({id:999001}),false);
  assert.equal(isSuperAdmin({id:999001}, {SUPER_ADMIN_ID: '999001'}),true);
  for(const user of [{id:'999001'},{id:1,isSuperAdmin:true},{id:1,username:'999001'},null]) assert.equal(isSuperAdmin(user, {SUPER_ADMIN_ID: '999001'}),false);
});
test('admin user directory includes legacy owners, guests, preferences and conversation-only users',()=>{
  const rows=[
    {kind:'events',id:'event',data:JSON.stringify({id:'event',owner:1,title:'Party',guests:{2:{name:'Guest',status:'later',phone:'12345',answers:[]}},media:[]})},
    {kind:'preferences',id:'3',data:JSON.stringify({timezone:'UTC'})},
    {kind:'sessions',id:'4',data:JSON.stringify({token:'SECRET',draft:{}})},
    {kind:'users',id:'2',data:JSON.stringify({id:2,firstName:'Telegram name',username:'guest'})}
  ];
  const data=adminOverview(rows);
  assert.deepEqual(data.users.map(u=>u.id).sort(),[1,2,3,4]);
  assert.equal(data.users.find(u=>u.id===2).username,'guest');
  assert.deepEqual(data.users.find(u=>u.id===2).invited,['event']);
  assert.equal(data.events[0].guests[0].phone,'12345');
  assert.doesNotMatch(JSON.stringify(data),/SECRET|token|draft/);
});
