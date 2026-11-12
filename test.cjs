"use strict";
const assert = require("node:assert/strict");
const {createVerifier, InvalidRun} = require("./protocol.cjs");
const {replay} = require("./replay.cjs");
const vm = require("node:vm");
const html = require("node:fs").readFileSync(require("node:path").join(__dirname,"index.html"),"utf8");
for (const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);

let ms = 0, writes = 0;
const start = 1794436000000;
const verifier = createVerifier({
  wall:()=>start+ms, monotonic:()=>ms,
  async saveScore(run, score) {
    assert.equal(run.uid, "player");
    assert.ok(score.score > 0 && score.meters > 0);
    writes++;
    return {written:true, score:score.score};
  }
});
const session = verifier.start("player", {name:"БАРБЕР", gender:"m"});
const inputs = [{tick:12,action:"jump"},{tick:24,action:"cutJump"},{tick:90,action:"slide"}];
let finalTick;
for (let tick=120; tick<900; tick++) {
  try { replay(session,inputs,tick); finalTick=tick; break; }
  catch (error) {
    if (!/Incomplete run|ended before/.test(error.message)) throw error;
  }
}
assert.ok(finalTick, "generated track must end the unattended run");

async function main() {
  let tick = 0;
  const packet = (op,next,actions=[]) => ({id:session.id,op,tick:next,actions});
  const send = (data, at) => verifier.advance(data, at, start+at);
  assert.throws(()=>send(packet("checkpoint",60),2000+1251), InvalidRun);
  assert.throws(()=>send(packet("checkpoint",60),500), InvalidRun);
  assert.throws(()=>send(packet("finish",finalTick),finalTick*1000/60), InvalidRun);
  assert.throws(()=>send(packet("checkpoint",60,[{tick:61,action:"jump"}]),1100), InvalidRun);
  assert.throws(()=>send({...packet("checkpoint",60),id:"0".repeat(48)},1100), InvalidRun);
  while(tick+60<finalTick) {
    const next = tick+60;
    const actions = inputs.filter(entry=>entry.tick>tick&&entry.tick<=next);
    assert.deepEqual(send(packet("checkpoint",next,actions),next*1000/60+100),{ok:true});
    tick=next;
  }
  const finish=packet("finish",finalTick,inputs.filter(entry=>entry.tick>tick));
  const at = finalTick*1000/60+100;
  assert.throws(()=>send({...finish,tick:finalTick-1},at), InvalidRun);
  const accepted = await send({...finish,score:999999,meters:999999},at);
  assert.ok(accepted.score < 999999);
  assert.equal(writes,1);
  await send(finish,at+300);
  assert.equal(writes,1);
  console.log("PASS: paced inputs, slow and fast time, forged session, missing checkpoints, false finish, forged score and idempotent save.");
}
main().catch(error=>{console.error(error);process.exitCode=1});
