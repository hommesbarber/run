"use strict";
const http = require("node:http");
const {performance} = require("node:perf_hooks");
const {initializeApp, applicationDefault} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");
const {createVerifier, InvalidRun} = require("./protocol.cjs");

const projectId = process.env.FIREBASE_PROJECT_ID || "hommesgame-9b2dc";
const origin = process.env.GAME_ORIGIN || "https://hommesbarber.github.io";
const app = initializeApp({projectId, credential:applicationDefault()});
const db = getFirestore(app);
const archiveFields = ["season","score","name","meters","at","dur","jumps","slides","runStart","endAt"];

async function saveScore(run, result, finishedAt, id) {
  const ref = db.collection("scores").doc(run.uid);
  return db.runTransaction(async tx => {
    const old = (await tx.get(ref)).data() || {};
    if (old.runId === id) return {written:true};
    const same = old.season === run.season;
    if (result.score <= 0 || old.season > run.season || (same && result.score <= old.score)) {
      return {written:false};
    }
    const record = {
      ...result, name:run.name, gender:run.gender, season:run.season,
      at:finishedAt, runStart:Timestamp.fromMillis(run.startedAt),
      endAt:Timestamp.fromMillis(finishedAt), runId:id, verified:true
    };
    for (const field of archiveFields) {
      const key = "prev" + field[0].toUpperCase() + field.slice(1);
      if (old.season > 0 && old[same ? key : field] != null) record[key] = old[same ? key : field];
    }
    for (const field of ["claimSeason","claimAt"]) {
      if (old[field] != null) record[field] = old[field];
    }
    tx.set(ref, record);
    return {written:true};
  });
}

const verifier = createVerifier({saveScore, monotonic:()=>performance.now(), wall:Date.now});
async function jsonBody(req) {
  let bytes = 0, text = "";
  req.setEncoding("utf8");
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 8192) throw new InvalidRun();
    text += chunk;
  }
  try { return JSON.parse(text); } catch { throw new InvalidRun(); }
}
const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, {"Content-Type":"text/plain", "Access-Control-Allow-Origin":origin,
      "Cache-Control":"no-store"}).end("ok");
    return;
  }
  if (req.url !== "/ranked" || req.headers.origin !== origin) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  try {
    const body = await jsonBody(req);
    if (!body || !["start","checkpoint","finish"].includes(body.op)) throw new InvalidRun();
    let result;
    if (body.op === "start") {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || "")?.[1];
      let uid;
      try { if (token) ({uid} = await getAuth(app).verifyIdToken(token)); }
      catch { /* Invalid Firebase identity. */ }
      if (!uid) { res.writeHead(401).end(); return; }
      result = verifier.start(uid, body);
    } else {
      result = await verifier.advance(body, performance.now(), Date.now());
    }
    res.writeHead(200, {"Content-Type":"application/json"}).end(JSON.stringify(result));
  } catch (error) {
    if (!(error instanceof InvalidRun)) console.error(error);
    res.writeHead(error instanceof InvalidRun ? 409 : 503).end();
  }
});
server.requestTimeout = 8000;
server.listen(Number(process.env.PORT || 8080), "0.0.0.0");
