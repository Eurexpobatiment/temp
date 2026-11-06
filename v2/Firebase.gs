/**
 * Températures des halls – passage à Firebase
 * Fichier ajouté au projet Apps Script de l'appli températures (à côté de Code.gs, sans rien y changer).
 *
 *  1. copierVersFirebase() : à lancer une fois. Copie tous les relevés de l'onglet « Relevés »,
 *     la plage de confort et les points de mesure dans Firebase. Peut être relancée sans créer de doublons.
 *     Avant : créer dans Firestore le document TempSecret/code (champ « code » = code de l'onglet Réglages).
 *  2. installerFirebase() : à lancer une fois. Programme toutes les 10 minutes :
 *       - l'ajout de la météo (T ext. Bron, DJU veille) aux relevés saisis dans la version Firebase,
 *       - la copie dans Firebase des relevés encore saisis dans l'ancienne version (pendant la transition).
 *
 * Le script se connecte à Firebase comme les techniciens (connexion anonyme + code de saisie de l'onglet Réglages).
 */

const FB_PROJECT = "equipe-batiment";
const FB_KEY = "AIzaSyARtP0RMkulG6c53-bnazwpGTspl0LgAhk";
const FB_DOCS = "projects/" + FB_PROJECT + "/databases/(default)/documents";
const FB_URL = "https://firestore.googleapis.com/v1/" + FB_DOCS;

function copierVersFirebase() {
  const n = fbCopierReleves_(null);
  const s = getSettings_();
  const tok = fbToken_();
  fbWrite_(tok, [
    fbUpdate_("TempReglages/seuils", { min: s.min, max: s.max }),
    fbUpdate_("TempReglages/points", { json: JSON.stringify(POINTS) })
  ]);
  console.log(n + " relevés ajoutés dans Firebase (ceux déjà présents sont laissés tels quels), avec la plage de confort (" + s.min + " à " + s.max + " °C) et les " + POINTS.length + " points de mesure.");
}

function installerFirebase() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === "majFirebase") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("majFirebase").timeBased().everyMinutes(10).create();
  majFirebase();
  console.log("Mise à jour Firebase programmée toutes les 10 minutes.");
}

/** Lancée automatiquement toutes les 10 minutes */
function majFirebase() {
  try { fbCopierReleves_(3); } catch (e) { console.warn("Copie des relevés : " + e.message); }
  fbMeteo_();
}

/* ---------- fonctions internes ---------- */

/** Copie les relevés de l'onglet « Relevés » (tous, ou ceux des derniers jours pas encore copiés).
 *  Un relevé déjà présent dans Firebase n'est jamais modifié ; un relevé copié puis supprimé dans
 *  la version Firebase n'est pas recopié. */
function fbCopierReleves_(joursMax) {
  const rel = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RELEVES);
  if (!rel || rel.getLastRow() < 2) return 0;
  const props = PropertiesService.getScriptProperties();
  let deja = {};
  try { deja = JSON.parse(props.getProperty("FB_COPIES") || "{}"); } catch (e) {}
  const rows = rel.getDataRange().getValues();
  const headers = rows[0].map(String);
  const byLabel = {};
  POINTS.forEach(p => byLabel[p[1]] = p[0]);
  const iExt = headers.indexOf(H_EXT), iDju = headers.indexOf(H_DJU);
  const num = (r, c) => (c >= 0 && r[c] !== "" && r[c] !== null && !isNaN(Number(r[c]))) ? Number(r[c]) : null;
  const limit = joursMax ? Date.now() - joursMax * 86400000 : 0;
  const writes = [], ids = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const at = r[1] instanceof Date ? r[1] : new Date(r[1]);
    const id = String(r[0] || "").replace(/[\/\s]/g, "_").slice(0, 40);
    if (!id || isNaN(at) || at.getTime() < limit) continue;
    if (joursMax && deja[id]) continue;
    const values = {};
    for (let c = FIXED_HEADERS.length; c < headers.length; c++) {
      const pid = byLabel[headers[c]], v = num(r, c);
      if (pid && v !== null) values[pid] = v;
    }
    const w = fbUpdate_("TempReleves/" + id, {
      at: at.toISOString(), salon: String(r[2] || "").slice(0, 120), auteur: String(r[3] || "").slice(0, 80),
      values: values, ext: num(r, iExt), dju: num(r, iDju), uid: "ancienne-version", cree: at.toISOString()
    });
    w.currentDocument = { exists: false }; // déjà dans Firebase : on n'y touche pas
    writes.push(w); ids.push([id, at.getTime()]);
  }
  if (!writes.length) return 0;
  const tok = fbToken_();
  const existe = fbIdsExistants_(tok);
  let n = 0, erreurs = [];
  const todo = [];
  writes.forEach((w, j) => { const [id, t] = ids[j]; if (existe[id]) deja[id] = t; else { delete w.currentDocument; todo.push([w, id, t]); } });
  for (let k = 0; k < todo.length; k += 100) {
    const lot = todo.slice(k, k + 100);
    try { fbWrite_(tok, lot.map(x => x[0])); lot.forEach(x => { deja[x[1]] = x[2]; n++; }); }
    catch (e) { // lot refusé : relevé par relevé pour trouver le fautif
      lot.forEach(x => { try { fbWrite_(tok, [x[0]]); deja[x[1]] = x[2]; n++; } catch (e2) { erreurs.push(x[1] + " : " + e2.message); } });
    }
  }
  // on ne garde la liste que sur 10 jours
  const old = Date.now() - 10 * 86400000;
  Object.keys(deja).forEach(id => { if (deja[id] < old) delete deja[id]; });
  props.setProperty("FB_COPIES", JSON.stringify(deja));
  if (erreurs.length) console.warn(erreurs.length + " relevé(s) non copiés : " + erreurs.slice(0, 5).join(" | "));
  return n;
}

/** Identifiants des relevés déjà dans Firebase */
function fbIdsExistants_(tok) {
  const ids = {};
  let page = "";
  do {
    const r = UrlFetchApp.fetch(FB_URL + "/TempReleves?pageSize=300&mask.fieldPaths=at" + (page ? "&pageToken=" + encodeURIComponent(page) : ""),
      { headers: { Authorization: "Bearer " + tok }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error("Firebase " + r.getResponseCode() + " : lecture des relevés");
    const j = JSON.parse(r.getContentText() || "{}");
    (j.documents || []).forEach(d => ids[d.name.split("/").pop()] = true);
    page = j.nextPageToken || "";
  } while (page);
  return ids;
}

/** Ajoute la température extérieure et le DJU aux relevés des 3 derniers jours qui n'en ont pas */
function fbMeteo_() {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const tok = fbToken_();
  const res = fbFetch_("post", FB_URL + ":runQuery", tok, {
    structuredQuery: { from: [{ collectionId: "TempReleves" }],
      where: { fieldFilter: { field: { fieldPath: "at" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: since } } } }
  });
  const writes = [];
  (res || []).forEach(x => {
    if (!x.document) return;
    const d = fbObj_(x.document.fields || {});
    if (d.ext !== null && d.ext !== undefined && d.dju !== null && d.dju !== undefined) return;
    const at = new Date(d.at);
    if (isNaN(at) || at.getTime() > Date.now()) return;
    let m = {};
    try { m = meteoPour_(at); } catch (e) { return; }
    const upd = {}, mask = [];
    if ((d.ext === null || d.ext === undefined) && m.ext !== null) { upd.ext = m.ext; mask.push("ext"); }
    if ((d.dju === null || d.dju === undefined) && m.dju !== null) { upd.dju = m.dju; mask.push("dju"); }
    if (!mask.length) return;
    writes.push({ update: { name: x.document.name, fields: fbFields_(upd) }, updateMask: { fieldPaths: mask }, currentDocument: { exists: true } });
  });
  if (writes.length) fbWrite_(tok, writes);
  return writes.length;
}

/** Connexion anonyme à Firebase (gardée dans les propriétés du script) + enregistrement du code de saisie */
function fbToken_() {
  const props = PropertiesService.getScriptProperties();
  const refresh = props.getProperty("FB_REFRESH");
  let tok = null;
  if (refresh) {
    const r = UrlFetchApp.fetch("https://securetoken.googleapis.com/v1/token?key=" + FB_KEY,
      { method: "post", payload: { grant_type: "refresh_token", refresh_token: refresh }, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      const j = JSON.parse(r.getContentText());
      tok = { id: j.id_token, uid: j.user_id };
      props.setProperty("FB_REFRESH", j.refresh_token);
    }
  }
  if (!tok) {
    const r = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + FB_KEY,
      { method: "post", contentType: "application/json", payload: JSON.stringify({ returnSecureToken: true }), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error("Connexion à Firebase refusée (activer « Anonyme » dans Authentication › Mode de connexion) : " + r.getContentText());
    const j = JSON.parse(r.getContentText());
    tok = { id: j.idToken, uid: j.localId };
    props.setProperty("FB_REFRESH", j.refreshToken);
  }
  const code = getSettings_().code;
  if (!code) throw new Error("Code de saisie vide dans l'onglet Réglages.");
  try {
    fbFetch_("patch", FB_URL + "/TempSessions/" + tok.uid, tok.id, { fields: fbFields_({ code: code, at: new Date().toISOString() }) });
  } catch (e) {
    throw new Error("Code de saisie refusé par Firebase : le document TempSecret/code doit contenir le même code que l'onglet Réglages (" + e.message + ")");
  }
  return tok.id;
}

function fbUpdate_(path, obj) { return { update: { name: FB_DOCS + "/" + path, fields: fbFields_(obj) } }; }

function fbWrite_(tok, writes) { return fbFetch_("post", FB_URL + ":commit", tok, { writes: writes }); }

function fbFetch_(method, url, tok, body) {
  const r = UrlFetchApp.fetch(url, { method: method, contentType: "application/json", payload: JSON.stringify(body),
    headers: { Authorization: "Bearer " + tok }, muteHttpExceptions: true });
  const c = r.getResponseCode();
  if (c < 200 || c >= 300) {
    let msg = r.getContentText();
    try { msg = JSON.parse(msg).error.message; } catch (e) {}
    throw new Error("Firebase " + c + " : " + msg);
  }
  return JSON.parse(r.getContentText() || "null");
}

function fbFields_(obj) { const f = {}; Object.keys(obj).forEach(k => f[k] = fbVal_(obj[k])); return f; }

function fbVal_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "number") return { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "object") return { mapValue: { fields: fbFields_(v) } };
  return { stringValue: String(v) };
}

function fbObj_(fields) { const o = {}; Object.keys(fields || {}).forEach(k => o[k] = fbDec_(fields[k])); return o; }

function fbDec_(v) {
  if (!v || "nullValue" in v) return null;
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return fbObj_(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fbDec_);
  return null;
}
