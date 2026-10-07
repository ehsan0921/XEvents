import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('same-day schedules show the timezone once and a short finish time',()=>{
  const event=schedule({date:'2026-12-05',time:'18:00',timezone:'Australia/Sydney',endMode:'finish',endDate:'2026-12-05',endTime:'23:00'});
  assert.equal(eventTime(event),'Sat, 5 Dec 2026, 6:00 pm AEDT (Australia/Sydney)\nFinishes: 11:00 pm');
  assert.equal(eventTime(event).match(/Australia\/Sydney/g).length,1);
  assert.equal(eventTime({...event,endsAt:null}),'Sat, 5 Dec 2026, 6:00 pm AEDT (Australia/Sydney)');
  assert.equal(eventTime({when:'Tomorrow evening'}),'Tomorrow evening');
});

test('overnight finishes retain their date using the viewer timezone',()=>{
  const overnight=schedule({date:'2026-12-05',time:'23:00',timezone:'Australia/Sydney',endMode:'duration',durationMinutes:180});
  assert.equal(eventTime(overnight),'Sat, 5 Dec 2026, 11:00 pm AEDT (Australia/Sydney)\nFinishes: Sun, 6 Dec 2026, 2:00 am');
  assert.equal(eventTime(overnight,'America/New_York'),'Sat, 5 Dec 2026, 7:00 am GMT-5 (America/New_York)\nFinishes: 10:00 am\nOrganiser time: Sat, 5 Dec 2026, 11:00 pm AEDT (Australia/Sydney)');

  const sameOrganiserDay=schedule({date:'2026-12-05',time:'14:00',timezone:'Australia/Sydney',endMode:'duration',durationMinutes:240});
  assert.equal(eventTime(sameOrganiserDay,'America/New_York'),'Fri, 4 Dec 2026, 10:00 pm GMT-5 (America/New_York)\nFinishes: Sat, 5 Dec 2026, 2:00 am\nOrganiser time: Sat, 5 Dec 2026, 2:00 pm AEDT (Australia/Sydney)');
});

test('schedules retain the finish offset label when the event crosses a clock change',()=>{
  const spring=schedule({date:'2026-10-04',time:'01:30',timezone:'Australia/Sydney',endMode:'duration',durationMinutes:120});
  assert.equal(eventTime(spring),'Sun, 4 Oct 2026, 1:30 am AEST (Australia/Sydney)\nFinishes: 4:30 am AEDT');
  const autumn=schedule({date:'2026-04-05',time:'01:30',timezone:'Australia/Sydney',endMode:'duration',durationMinutes:120});
  assert.equal(eventTime(autumn),'Sun, 5 Apr 2026, 1:30 am AEDT (Australia/Sydney)\nFinishes: 2:30 am AEST');
  for(const event of [spring,autumn])assert.equal(eventTime(event).match(/Australia\/Sydney/g).length,1);
});

test('Mini App and Telegram agree on compact schedules in local and guest timezones',()=>{
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const helpers=source.slice(source.indexOf('function dateInZone('),source.indexOf('function openTelegram('));
  const appFormat=new Function(helpers+'\nreturn format;')();
  const inputs=[
    {date:'2026-12-05',time:'18:00',durationMinutes:300},
    {date:'2026-12-05',time:'23:00',durationMinutes:180},
    {date:'2026-12-05',time:'14:00',durationMinutes:240},
    {date:'2026-10-04',time:'01:30',durationMinutes:120},
    {date:'2026-04-05',time:'01:30',durationMinutes:120}
  ];
  for(const input of inputs){
    const event=schedule({...input,timezone:'Australia/Sydney',endMode:'duration'});
    for(const zone of ['Australia/Sydney','America/New_York','Asia/Kathmandu']){
      const chatLocal=eventTime(event,zone).split('\nOrganiser time:')[0];
      assert.equal(appFormat(event,zone),chatLocal,JSON.stringify({input,zone}));
    }
  }
});
