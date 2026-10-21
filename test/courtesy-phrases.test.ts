import test from 'node:test';import assert from 'node:assert/strict';import {courtesyReply} from '../src/conversation.js';
test('team thanks stay local',()=>{for(const s of ['thanks team','thank you team','thanks, everyone'])assert.equal(courtesyReply(s),'You’re welcome.');});
test('terminal Unicode punctuation stays local',()=>{assert.equal(courtesyReply('Hello！'),'Hello! What would you like to work on?');assert.equal(courtesyReply('Thanks…'),'You’re welcome.');});
test('existing English courtesies work',()=>{for(const s of ['hello','hi team','good morning!','thank you'])assert.ok(courtesyReply(s));});
test('real work is not swallowed',()=>{for(const s of ['thanks, now fix it','hello\ninspect files','thank you team please fix this','hello world','bonjour'])assert.equal(courtesyReply(s),undefined);});
