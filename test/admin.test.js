import test from 'node:test';
import assert from 'node:assert/strict';
import { adminOverview, isSuperAdmin, adminAnalytics, adminUserCount } from '../src/admin.js';

test('super admin is identified by verified numeric Telegram ID only',()=>{
  assert.equal(isSuperAdmin({id:999001},{SUPER_ADMIN_ID:'999001\n'}),true);
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

test('daily analytics uses first-seen/creation dates and zero fills local calendar days across DST', () => {
  const now = Date.parse('2026-10-08T02:00:00Z');
  const rows = [
    {kind:'users',timestamp:'2026-10-03T15:30:00Z'}, // Oct 4 in Sydney, before DST jump
    {kind:'users',timestamp:'2026-10-03T16:30:00Z'}, // Same day, after jump
    {kind:'events',timestamp:'2026-10-07T13:30:00Z'}, // Oct 8 locally
    {kind:'events',timestamp:'2026-10-08T01:00:00Z'}, // Cancelled retained events count too
    {kind:'users',timestamp:null}, {kind:'events',timestamp:'invalid'},
    {kind:'users',timestamp:'2026-10-09T00:00:00Z'}, // Future records ignored
    {kind:'users',timestamp:'2020-01-01T00:00:00Z'},
    {kind:'sessions',timestamp:'2026-10-08T00:00:00Z'}
  ];
  const data = adminAnalytics(rows, {days:'7',zone:'Australia/Sydney',now});
  assert.equal(data.daily.length,7);
  assert.equal(data.daily[0].date,'2026-10-02');
  assert.equal(data.daily.at(-1).date,'2026-10-08');
  assert.equal(data.daily.find(d=>d.date==='2026-10-04').users,2);
  assert.equal(data.daily.find(d=>d.date==='2026-10-05').users,0);
  assert.equal(data.daily.at(-1).events,2);
  assert.deepEqual(data.totals,{users:2,events:2});
  assert.deepEqual(data.undated,{users:1,events:1});
  assert.notDeepEqual(adminAnalytics(rows,{days:7,zone:'UTC',now}).daily,data.daily);
});

test('analytics validates bounded ranges and timezone and returns aggregate data only', () => {
  for (const days of ['0','365','7junk',null,'']) assert.throws(()=>adminAnalytics([],{days}));
  assert.throws(()=>adminAnalytics([],{zone:'Bad/Timezone'}));
  const data=adminAnalytics([{kind:'users',timestamp:'2026-01-01T00:00:00Z',id:123,name:'Private name',phone:'private-phone'}],{days:90,now:Date.parse('2026-01-01T12:00:00Z')});
  assert.equal(data.daily.length,90);assert.equal(data.totals.users,1);
  assert.doesNotMatch(JSON.stringify(data),/Private name|private-phone|"id"/);
  assert.equal(adminAnalytics([]).daily.length,30);
});

test('total users includes legacy users, deduplicates sources and ignores non-user settings', () => {
  assert.equal(adminUserCount([{id:1},{id:'1'},{id:'2'},{id:'3'},{id:'_pricing'},{id:null},{id:0},{id:-1},{id:'bad'},{id:'9999999999999999999999'}]),3);
  assert.equal(adminUserCount([]),0);
});
