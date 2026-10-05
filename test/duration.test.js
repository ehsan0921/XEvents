import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, eventTime } from '../src/time.js';
import { eventGroup } from '../src/reminders.js';

test('duration and finish time are equivalent, including overnight events',()=>{
  const input={date:'2026-10-24',time:'23:00',timezone:'Australia/Sydney'};
  const duration=schedule({...input,endMode:'duration',durationMinutes:180});
  const finish=schedule({...input,endMode:'finish',endDate:'2026-10-25',endTime:'02:00'});
  assert.equal(duration.endsAt,'2026-10-24T15:00:00Z'); assert.equal(duration.endsAt,finish.endsAt);
  assert.equal(finish.durationMinutes,180);
  assert.match(eventTime(finish,'America/New_York'),/Finishes:/);
  assert.equal(eventGroup(finish,Date.parse(finish.startsAt)+60000),'Upcoming events');
  assert.equal(eventGroup(finish,Date.parse(finish.endsAt)+1),'Past events');
  assert.equal(schedule({...input,endMode:'none'}).endsAt,null);
});
test('durations use elapsed time through DST and invalid finish or duration is rejected',()=>{
  const input={date:'2026-10-04',time:'01:30',timezone:'Australia/Sydney'};
  const e=schedule({...input,endMode:'duration',durationMinutes:120});
  assert.match(eventTime(e),/4:30 am/);
  assert.throws(()=>schedule({...input,endMode:'finish',endDate:'2026-10-04',endTime:'02:30'}),/missing or repeated/);
  assert.throws(()=>schedule({...input,endMode:'finish',endDate:'2026-10-04',endTime:'01:00'}),/after/);
  for(const durationMinutes of [0,-1,1.5,525601,'60']) assert.throws(()=>schedule({...input,endMode:'duration',durationMinutes}),/duration/);
});
