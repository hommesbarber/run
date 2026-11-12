"use strict";

const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "index.html"), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from === -1 || to === -1) throw new Error("Simulation source changed: " + start);
  return source.slice(from, to);
}

const simulation = [
  "const GY=470, SIM_STEP=1/60;",
  ...["BONUS", "WAIT", "BUBBLES", "W_TEE", "LATE", "CL_SKIN", "OBS", "HANG"].map(
    name => section("const " + name + "=", "\n")
  ),
  section("function hex2(", "\n"),
  section("function mix(", "\n"),
  section("const SHIFTS=", "/* ============ звук и музыка"),
  section("function obstacleBox(o)", "/* ============ деньги"),
  section('let state="menu"', "const dust="),
  section("let runSeed =", "let lastHud="),
  section("function update(dt)", "function showBanner("),
  "function updateHud() {}",
  "function die() { state='over'; }",
  "function showBanner() {}",
  "const sfx=new Proxy({}, {get:()=>()=>{}}), label={};",
  "const $=()=>label;",
  `runSeed=seed; reset(); state="play";
   let actionIndex=0;
   for(let tick=1; tick<=finalTick; tick++){
     while(actionIndex<actions.length && actions[actionIndex].tick===tick){
       const action=actions[actionIndex++].action;
       if(action==="jump") jump();
       else if(action==="slide") slide();
       else cutJump();
     }
     update(SIM_STEP);
     if(state==="over"){
       if(tick!==finalTick) throw new Error("The run ended before its claimed finish");
       break;
     }
   }
   if(state!=="over" || actionIndex!==actions.length) throw new Error("Incomplete run");
   ({score:score(), meters:Math.floor(meters), coins:nCoin, cash:nCash,
     dur:Math.max(1,Math.round(runT)), jumps:nJump, slides:nSlide});`
].join("\n");

const replayScript = new vm.Script(simulation, {filename:"hommes-run-simulation.js"});
exports.replay = (run, actions, finalTick) => replayScript.runInNewContext({
  seed:run.seed, store:{get:(_, fallback)=>fallback},
  actions, finalTick
}, {timeout:2000});
