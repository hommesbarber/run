"use strict";
const {randomBytes, randomInt} = require("node:crypto");
const {replay} = require("./replay.cjs");
const actionsAllowed = new Set(["jump", "cutJump", "slide"]);
const seasonAt = now => Math.max(1, 1 + Math.floor((now - 1793646000000) / 1728000000));
const MAX_TICK = 216000;
class InvalidRun extends Error {}
function requireValid(ok) { if (!ok) throw new InvalidRun(); }

function createVerifier({saveScore, monotonic, wall}) {
  const sessions = new Map();
  const owners = new Map();
  function start(uid, {name, gender}) {
    const now = monotonic();
    for (const [id, run] of sessions) {
      if (now - run.lastAt > 15000) {
        sessions.delete(id);
        if (owners.get(run.uid) === id) owners.delete(run.uid);
      }
    }
    requireValid(typeof name === "string" && name.trim().length > 0 && name.length <= 16);
    requireValid(gender === "m" || gender === "f");
    const previous = owners.get(uid);
    if (previous) {
      requireValid(now - sessions.get(previous).started >= 1200);
      sessions.delete(previous);
    }
    requireValid(sessions.size < 512);
    const id = randomBytes(24).toString("hex");
    const seed = randomInt(0x100000000);
    const startedAt = wall();
    const season = seasonAt(startedAt);
    sessions.set(id, {uid, seed, name, gender, season, startedAt, started:now,
      lastAt:now, tick:0, actions:[], final:null});
    owners.set(uid, id);
    return {id, seed, season};
  }

  function advance({id, op, tick, actions}, received, finishedAt) {
    requireValid(typeof id === "string" && id.length === 48);
    const run = sessions.get(id);
    requireValid(run && owners.get(run.uid) === id);
    if (run.final) {
      requireValid(op === "finish" && tick === run.tick);
      return run.final;
    }
    const expectedMs = tick * 1000 / 60;
    const elapsed = received - run.started;
    requireValid(Number.isInteger(tick) && tick > run.tick && tick <= MAX_TICK);
    requireValid(elapsed >= expectedMs - 150 && elapsed <= expectedMs + 1250);
    requireValid(received - run.lastAt <= 2250 && seasonAt(finishedAt) === run.season);
    const step = tick - run.tick;
    requireValid(op === "checkpoint" ? step === 60 : op === "finish" && step <= 60);
    requireValid(Array.isArray(actions) && actions.length <= 40 && run.actions.length + actions.length <= 20000);
    let lastActionTick = run.tick, sameTick = 0;
    for (const entry of actions) {
      requireValid(entry && actionsAllowed.has(entry.action) && Number.isInteger(entry.tick)
        && entry.tick > run.tick && entry.tick >= lastActionTick && entry.tick <= tick);
      sameTick = entry.tick === lastActionTick ? sameTick + 1 : 1;
      requireValid(sameTick <= 6);
      lastActionTick = entry.tick;
    }
    if (op === "checkpoint") {
      run.actions.push(...actions.map(({tick, action}) => ({tick, action})));
      run.tick = tick;
      run.lastAt = received;
      return {ok:true};
    }
    let result;
    try { result = replay(run, run.actions.concat(actions), tick); }
    catch (error) {
      if (error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
      throw new InvalidRun();
    }
    run.tick = tick;
    run.lastAt = received;
    run.final = Promise.resolve().then(() => saveScore(run, result, finishedAt, id));
    return run.final;
  }
  return {start, advance};
}
module.exports = {createVerifier, InvalidRun};
