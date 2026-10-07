import {randomBytes} from 'node:crypto';
import {InputError,eventTime} from './time.js';
import {validTimezone,parseChatDate,parseChatTime,draftSchedule,scheduleDateCard,scheduleTimeCard} from './chat-schedule.js';
import {invitationMode,invitationSettings,oneTimeInvites} from './invitations.js';
import {permissions,requiresApproval} from './permissions.js';
import {reminderOptions,reminderLabel} from './reminders.js';

const zones=[['Sydney','Australia/Sydney'],['Melbourne','Australia/Melbourne'],['Perth','Australia/Perth'],['Tehran','Asia/Tehran'],['Dubai','Asia/Dubai'],['London','Europe/London'],['Berlin','Europe/Berlin'],['New York','America/New_York'],['Los Angeles','America/Los_Angeles'],['UTC','UTC']];
const paired=items=>Array.from({length:Math.ceil(items.length/2)},(_,i)=>items.slice(i*2,i*2+2));
const rotate=(s,step)=>{s.step=step;s.token=randomBytes(6).toString('hex');};
const cb=(s,action,value)=>`cc:${s.token}:${action}${value===undefined?'':':'+value}`;
const button=(s,[text,action,value])=>({text,callback_data:cb(s,action,value)});
const skip=text=>text==='/skip' || text==='⏭ Skip';
function savedZone(bot,id){try{return validTimezone(bot.db.preferences[id]?.timezone || 'UTC');}catch{return 'UTC';}}
function choices(bot,id,s,step,text,rows){
  rotate(s,step);
  return bot.send(id,text,{inline_keyboard:rows.map(row=>row.map(item=>button(s,item)))});
}
function ask(bot,id,s,step,text,optional=false){
  return choices(bot,id,s,step,text,[...(optional?[[['Skip','skip']]]:[]),[['Back','back'],['Cancel','cancel']]]);
}
function dateCard(bot,id,s){
  rotate(s,'chat-date');const card=scheduleDateCard({timezone:s.pickZone,datePage:s.datePage || 0,token:s.token});
  return bot.send(id,(s.picking==='deadline'?'RSVP deadline\n':'Event date\n')+card.text,card.reply_markup);
}
function timeCard(bot,id,s){
  rotate(s,'chat-time');const card=scheduleTimeCard({timezone:s.pickZone,date:s.pickDate,token:s.token});
  return bot.send(id,(s.picking==='deadline'?'RSVP deadline\n':'Event time\n')+card.text,card.reply_markup);
}
function startPick(bot,id,s,purpose='event'){
  s.picking=purpose;s.pickZone=purpose==='deadline'?s.draft.deadlineTimezone || s.draft.timezone || savedZone(bot,id):s.draft.timezone || savedZone(bot,id);s.datePage=0;delete s.pickDate;
  return dateCard(bot,id,s);
}
function zoneCard(bot,id,s){
  return choices(bot,id,s,'chat-zone',`Timezone: ${s.pickZone}\nChoose a city, or type your timezone (e.g. Asia/Kolkata).`,[...paired(zones.map(([label],i)=>[label,'zone-select',i])),[['Other timezone','custom-zone'],['Back','back']],[['Cancel','cancel']]]);
}
function locationCard(bot,id,s){return choices(bot,id,s,'chat-location','Where is it? Send an address, meeting point or online link.',[[['Location later','skip']],[['Back','back'],['Cancel','cancel']]]);}
function review(bot,id,s){
  const d=s.draft,mode=invitationMode(d)==='named'?`${Object.keys(d.invitees || {}).length} personal invitations`:'One shareable ticket link';
  const text=`Review your event\n\n${d.title}\n${eventTime(d)}\n📍 ${d.location || 'Location to follow'}\nFree · ${d.isPublic?'Public':'Private'}\n${mode}${d.description?'\n\n'+d.description:''}${d.inviteMessage?'\n\nInvitation message: '+d.inviteMessage:''}${d.banner?'\nBanner added':''}${d.defaultReminder?'\nReminder: '+reminderLabel(d.defaultReminder):''}${d.responseDeadline?'\nRespond by: '+eventTime({startsAt:d.responseDeadline,timezone:d.deadlineTimezone || d.timezone}):''}`;
  return choices(bot,id,s,'chat-review',text,[[['🎉 Create event','create']],[['More options','options']],[['Cancel','cancel']]]);
}
function options(bot,id,s){
  return choices(bot,id,s,'chat-options','More options · change only what you need.',[
    [['Event name','title'],['Date & time','schedule']],
    [['Location','location'],['Description','description']],
    [['Invite message','invite-message'],['Banner','banner']],
    [['Invitation type','mode'],['Guest options','permissions']],
    [['Reminders','reminders'],['Duration','duration']],
    [['Response deadline','deadline']],
    [['Review event','review'],['Cancel','cancel']]
  ]);
}
function modeCard(bot,id,s){return choices(bot,id,s,'chat-mode','How should guests join?',[[['Ticket link','tickets'],['Named invitations','named']],[['Back','back'],['Cancel','cancel']]]);}
function guestOptions(bot,id,s){
  rotate(s,'chat-permissions');
  const rows=bot.permissionKeyboard(s.draft,`cc:${s.token}:toggle`);
  rows.push([button(s,['Back','back']),button(s,['Cancel','cancel'])]);
  return bot.send(id,'Guest options · tap to turn extras on or off.',{inline_keyboard:rows});
}
function reminders(bot,id,s){return choices(bot,id,s,'chat-reminders','Default reminder for confirmed guests.',[...paired(reminderOptions.map(value=>[reminderLabel(value),'reminder',value])),[['Back','back'],['Cancel','cancel']]]);}
function durationCard(bot,id,s){return choices(bot,id,s,'chat-duration','How long is the event?',[[['1 hour','duration-set',60],['2 hours','duration-set',120]],[['3 hours','duration-set',180],['4 hours','duration-set',240]],[['No finish time','duration-set',0],['Other duration','custom-duration']],[['Back','back'],['Cancel','cancel']]]);}
function deadlineCard(bot,id,s){return choices(bot,id,s,'chat-deadline',s.draft.responseDeadline?'Respond by: '+eventTime({startsAt:s.draft.responseDeadline,timezone:s.draft.deadlineTimezone || s.draft.timezone}):'No response deadline.',[[['Set deadline','deadline-set'],['No deadline','deadline-clear']],[['Back','back'],['Cancel','cancel']]]);}

export function startChatCreation(bot,id){
  const s={flow:'chat-create',step:'chat-title',token:randomBytes(6).toString('hex'),draft:{invitationMode:'tickets',oneTimeInvite:false,isPublic:false,requireApproval:false,askParticipantCount:false,askPhone:false,askComments:false,qrEnabled:false,permissions:{guestList:false,uploadMedia:false,viewMedia:false},description:'',inviteMessage:'',questions:[],location:'',endMode:'none',defaultReminder:0}};
  bot.session(id,s);
  return bot.send(id,'Event name?',{keyboard:[[{text:'✖️ Cancel input'}]],resize_keyboard:true});
}
function back(bot,id,s){
  if(s.step==='chat-title')return s.draft.title?startPick(bot,id,s):bot.send(id,'Event name? Or tap Cancel input.');
  if(['chat-date','chat-custom-date'].includes(s.step))return s.picking==='deadline' || s.editingSchedule?options(bot,id,s):ask(bot,id,s,'chat-title','Event name?');
  if(['chat-time','chat-custom-time','chat-zone','chat-custom-zone'].includes(s.step))return dateCard(bot,id,s);
  if(s.step==='chat-location' && !s.editingLocation)return startPick(bot,id,s);
  if(['chat-options','chat-location'].includes(s.step))return review(bot,id,s);
  if(s.step==='chat-permissions' || s.step==='chat-mode' || s.step==='chat-reminders' || s.step==='chat-duration' || s.step==='chat-deadline')return options(bot,id,s);
  return options(bot,id,s);
}
async function applyTime(bot,id,s,input){
  const time=parseChatTime(input);
  const value=draftSchedule({date:s.pickDate,time,timezone:s.pickZone,...(s.picking==='event'?{endMode:s.draft.endMode || 'none',durationMinutes:s.draft.durationMinutes}:{})});
  if(s.picking==='deadline'){
    if(Date.parse(value.startsAt)>=Date.parse(s.draft.startsAt))throw new InputError('The response deadline must be before the event starts.');
    Object.assign(s.draft,{responseDeadline:value.startsAt,deadlineDate:value.localDate,deadlineTime:value.localTime,deadlineTimezone:value.timezone});
    return options(bot,id,s);
  }
  Object.assign(s.draft,value);
  return s.editingSchedule?review(bot,id,s):locationCard(bot,id,s);
}
function setZone(bot,id,s,input){
  const match=zones.find(([label])=>label.toLowerCase()===input.trim().toLowerCase());
  s.pickZone=validTimezone(match?match[1]:input);
  if(s.picking==='event'){bot.db.preferences[id] ||= {};bot.db.preferences[id].timezone=s.pickZone;}
  s.datePage=0;delete s.pickDate;return dateCard(bot,id,s);
}
function setDuration(bot,id,s,minutes){
  if(!Number.isSafeInteger(minutes) || minutes<0 || minutes>525600)throw new InputError('Use a duration of 1–525600 minutes, or choose No finish time.');
  Object.assign(s.draft,draftSchedule({date:s.draft.localDate,time:s.draft.localTime,timezone:s.draft.timezone,endMode:minutes?'duration':'none',durationMinutes:minutes}));
  return options(bot,id,s);
}
function setGuests(bot,id,s,text){
  if(!text || text.length>10000)throw new InputError('Send guest names, one per line (up to 100 guests).');
  Object.assign(s.draft,invitationSettings({invitationMode:'named',guestNames:text,isPublic:false,...(invitationMode(s.draft)!=='named'?{oneTimeInvite:true}:{})},s.draft));
  if(s.draft.requireApproval===true)s.draft.hideLocation=true;
  s.draft.requireApproval=false;s.draft.askParticipantCount=false;s.draft.isPublic=false;
  return options(bot,id,s);
}
function skipStep(bot,id,s){
  if(s.step==='chat-location'){s.draft.location='';return review(bot,id,s);}
  if(s.step==='chat-description'){s.draft.description='';return options(bot,id,s);}
  if(s.step==='chat-invite-message'){s.draft.inviteMessage='';return options(bot,id,s);}
  if(s.step==='chat-banner')return options(bot,id,s);
  throw new InputError('Choose a button or send the requested detail.');
}

export async function chatCreationMessage(bot,id,text,s,message){
  try{
    if(skip(text))return skipStep(bot,id,s);
    switch(s.step){
      case 'chat-title':case 'chat-edit-title':
        if(!text || text.length>100)throw new InputError('Event name: 1–100 characters.');
        s.draft.title=text;return s.step==='chat-title'?startPick(bot,id,s):options(bot,id,s);
      case 'chat-date':case 'chat-custom-date':s.pickDate=parseChatDate(text,s.pickZone);return timeCard(bot,id,s);
      case 'chat-time':case 'chat-custom-time':return await applyTime(bot,id,s,text);
      case 'chat-zone':case 'chat-custom-zone':return setZone(bot,id,s,text);
      case 'chat-location':
        if(!text || text.length>300)throw new InputError('Send a location up to 300 characters, or choose Location later.');
        s.draft.location=text;return review(bot,id,s);
      case 'chat-description':case 'chat-invite-message':{
        const field=s.step==='chat-description'?'description':'inviteMessage',limit=field==='description'?1500:1000;
        if(!text || text.length>limit)throw new InputError(`Use up to ${limit} characters, or tap Skip.`);
        s.draft[field]=text;return options(bot,id,s);
      }
      case 'chat-guests':return setGuests(bot,id,s,(message.text || text).trim());
      case 'chat-banner':
        if(!message.photo?.length)throw new InputError('Send a photo for the banner, or tap Skip.');
        s.draft.banner=message.photo.at(-1).file_id;return options(bot,id,s);
      case 'chat-custom-duration':
        if(!/^[1-9]\d*$/.test(text))throw new InputError('Duration in minutes? For example, 90.');
        return setDuration(bot,id,s,Number(text));
      default:return bot.send(id,'Use the event buttons below, or tap Cancel input.');
    }
  }catch(error){if(error instanceof InputError)return bot.send(id,error.message);throw error;}
}

export async function chatCreationCallback(bot,q){
  const id=q.from.id,s=bot.db.sessions[id],parts=(q.data || '').split(':'),[,token,action,value]=parts;
  if(q.id)await bot.api('answerCallbackQuery',{callback_query_id:q.id}).catch(()=>{});
  if(parts.length>4 || !s || s.flow!=='chat-create' || token!==s.token || q.message?.chat && (q.message.chat.id!==id || q.message.chat.type && q.message.chat.type!=='private'))return bot.send(id,'These buttons have expired. Use the latest event buttons, or tap Create event.');
  const allowed={
    'chat-date':['date','days','zone','custom-date'],'chat-custom-date':[],
    'chat-time':['time','custom-time'],'chat-custom-time':[],
    'chat-zone':['zone-select','custom-zone'],'chat-custom-zone':[],
    'chat-location':['skip'],'chat-review':['create','options'],
    'chat-options':['title','schedule','location','description','invite-message','banner','mode','permissions','reminders','duration','deadline','review'],
    'chat-mode':['tickets','named'],'chat-permissions':['toggle'],'chat-reminders':['reminder'],
    'chat-duration':['duration-set','custom-duration'],'chat-deadline':['deadline-set','deadline-clear'],
    'chat-description':['skip'],'chat-invite-message':['skip'],'chat-banner':['skip']
  };
  if(!['cancel','back'].includes(action) && !allowed[s.step]?.includes(action))return bot.send(id,'Use the latest buttons for this step.');
  try{
    const result=await (async()=>{
    if(action==='cancel'){await bot.clearButtons(id,q.message);bot.session(id);return bot.home(id,'Event creation cancelled.');}
    if(action==='back')return back(bot,id,s);
    if(action==='date'){s.pickDate=parseChatDate(value,s.pickZone);return timeCard(bot,id,s);}
    if(action==='days'){
      if(!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>51)throw new InputError('Choose a date page from the latest buttons.');
      s.datePage=Number(value);return dateCard(bot,id,s);
    }
    if(action==='zone')return zoneCard(bot,id,s);
    if(action==='zone-select'){
      if(!/^\d+$/.test(value) || !zones[Number(value)])throw new InputError('Choose a timezone from the latest buttons.');
      return setZone(bot,id,s,zones[Number(value)][1]);
    }
    if(action==='custom-zone')return ask(bot,id,s,'chat-custom-zone','Timezone? Type a city above or an IANA name, e.g. Asia/Kolkata.');
    if(action==='custom-date')return ask(bot,id,s,'chat-custom-date',`Date in ${s.pickZone}? Type YYYY-MM-DD or DD/MM/YYYY.`);
    if(action==='time'){
      if(!/^\d{4}$/.test(value))throw new InputError('Choose a time from the latest buttons.');
      return await applyTime(bot,id,s,value.slice(0,2)+':'+value.slice(2));
    }
    if(action==='custom-time')return ask(bot,id,s,'chat-custom-time',`Time in ${s.pickZone}? Type 18:00 or 6:30pm.`);
    if(action==='skip')return skipStep(bot,id,s);
    if(action==='options')return options(bot,id,s);
    if(action==='review')return review(bot,id,s);
    if(action==='title')return ask(bot,id,s,'chat-edit-title','Event name?');
    if(action==='schedule'){s.editingSchedule=true;return startPick(bot,id,s);}
    if(action==='location'){s.editingLocation=true;return locationCard(bot,id,s);}
    if(action==='description')return ask(bot,id,s,'chat-description','Description? Or tap Skip.',true);
    if(action==='invite-message')return ask(bot,id,s,'chat-invite-message','Invitation message? Or tap Skip.',true);
    if(action==='banner')return ask(bot,id,s,'chat-banner','Send a banner photo, or tap Skip.',true);
    if(action==='mode')return modeCard(bot,id,s);
    if(action==='tickets'){Object.assign(s.draft,{invitationMode:'tickets',oneTimeInvite:false});delete s.draft.invitees;return options(bot,id,s);}
    if(action==='named')return ask(bot,id,s,'chat-guests','Guest names, one per line.\nAlex = ? asks how many; Sam = 2! confirms two; Taylor = 2 reserves two. Max 10 per invitation.');
    if(action==='permissions')return guestOptions(bot,id,s);
    if(action==='toggle'){
      const d=s.draft,named=invitationMode(d)==='named';
      if(named && ['isPublic','requireApproval','askParticipantCount'].includes(value))throw new InputError('Named invitations stay private and use per-guest counts without approval.');
      if(Object.hasOwn(d.permissions,value))d.permissions[value]=!d.permissions[value];
      else if(value==='oneTimeInvite')d.oneTimeInvite=!oneTimeInvites(d);
      else if(['requireApproval','hideLocation','askParticipantCount','askPhone','askComments','qrEnabled','isPublic'].includes(value))d[value]=!d[value];
      else if(value==='allowLinkUploads'){d.allowLinkUploads=!d.allowLinkUploads;d.uploadToken=d.allowLinkUploads?randomBytes(16).toString('hex'):null;}
      else throw new InputError('Choose a guest option from the latest buttons.');
      return guestOptions(bot,id,s);
    }
    if(action==='reminders')return reminders(bot,id,s);
    if(action==='reminder'){
      if(!/^\d+$/.test(value) || !reminderOptions.includes(Number(value)))throw new InputError('Choose a reminder from the latest buttons.');
      s.draft.defaultReminder=Number(value);return options(bot,id,s);
    }
    if(action==='duration')return durationCard(bot,id,s);
    if(action==='duration-set'){
      if(!/^\d+$/.test(value))throw new InputError('Choose a duration from the latest buttons.');
      return setDuration(bot,id,s,Number(value));
    }
    if(action==='custom-duration')return ask(bot,id,s,'chat-custom-duration','Duration in minutes? For example, 90.');
    if(action==='deadline')return deadlineCard(bot,id,s);
    if(action==='deadline-set')return startPick(bot,id,s,'deadline');
    if(action==='deadline-clear'){Object.assign(s.draft,{responseDeadline:null,deadlineDate:'',deadlineTime:'',deadlineTimezone:null});return options(bot,id,s);}
    if(action==='create'){
      const d=s.draft;
      if(!d.title?.trim() || d.title.length>100 || typeof d.location!=='string' || d.location.length>300)throw new InputError('Check the event name and location.');
      Object.assign(d,draftSchedule({date:d.localDate,time:d.localTime,timezone:d.timezone,endMode:d.endMode || 'none',durationMinutes:d.durationMinutes}));
      if(d.responseDeadline && (Date.parse(d.responseDeadline)<=Date.now() || Date.parse(d.responseDeadline)>=Date.parse(d.startsAt)))throw new InputError('Update or remove the response deadline in More options.');
      if(invitationMode(d)==='named' && !Object.keys(d.invitees || {}).length)throw new InputError('Add guest names in More options → Invitation type.');
      if(invitationMode(d)==='named'){if(d.requireApproval===true)d.hideLocation=true;d.isPublic=false;d.askParticipantCount=false;}
      d.permissions=permissions(d);d.requireApproval=requiresApproval(d);
      await bot.clearButtons(id,q.message);return bot.finishCreation(id,s);
    }
    })();
    if(!['create','cancel'].includes(action) && s.token!==token)await bot.clearButtons(id,q.message);
    return result;
  }catch(error){if(error instanceof InputError)return bot.send(id,error.message);throw error;}
}
