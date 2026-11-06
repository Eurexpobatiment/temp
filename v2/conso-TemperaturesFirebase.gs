/* ======================= Températures : lecture dans Firebase =======================
 * À ajouter dans le projet Apps Script de l'appli Consommations halls.
 * Remplace la lecture du classeur des températures : l'ancienne fonction readTemp_ est renommée
 * readTempSheet_ et sert encore pendant la transition (les deux sources sont fusionnées, sans doublon).
 */
var FB_TEMP = {
  project: 'equipe-batiment',
  key: 'AIzaSyARtP0RMkulG6c53-bnazwpGTspl0LgAhk',
  app: 'https://eurexpobatiment.github.io/temp/v2/'
};

/** Même résultat que l'ancienne lecture : { rows:[{day, salon, vals:{colonne: °C}}], cols, seuilBas, seuilHaut, corr, url } ou { err } */
function readTemp_(P, halls) {
  var fb;
  try { fb = readTempFirebase_(); } catch (e) { fb = { err: 'Températures Firebase illisibles : ' + e.message }; }
  var sh = (P && P.tempSheetId) ? readTempSheet_(P, halls) : { err: 'pas de classeur' };
  if (fb.err) return sh.err === 'pas de classeur' ? { err: fb.err } : sh;
  var rows = fb.rows.slice(), seen = {}, cols = fb.cols.slice();
  fb.rows.forEach(function (r) { seen[r.id] = true; });
  if (!sh.err) {
    sh.rows.forEach(function (r) { if (!r.id || !seen[r.id]) rows.push(r); });
    sh.cols.forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); });
  }
  return {
    rows: rows, cols: cols,
    seuilBas: fb.seuilBas !== '' ? fb.seuilBas : (sh.seuilBas || ''),
    seuilHaut: fb.seuilHaut !== '' ? fb.seuilHaut : (sh.seuilHaut || ''),
    corr: readCorr_(halls, cols), url: FB_TEMP.app
  };
}

function readTempFirebase_() {
  var base = 'https://firestore.googleapis.com/v1/projects/' + FB_TEMP.project + '/databases/(default)/documents/';
  var get = function (path) {
    var r = UrlFetchApp.fetch(base + path + (path.indexOf('?') < 0 ? '?' : '&') + 'key=' + FB_TEMP.key, { muteHttpExceptions: true });
    if (r.getResponseCode() === 404) return null;
    if (r.getResponseCode() !== 200) throw new Error('Firebase ' + r.getResponseCode());
    return JSON.parse(r.getContentText());
  };
  var pts = get('TempReglages/points');
  if (!pts) return { err: 'Températures pas encore copiées dans Firebase.' };
  var list = JSON.parse(tfDec_(pts.fields.json) || '[]');
  var label = {};
  list.forEach(function (p) { label[p[0]] = p[1]; });
  var cols = list.map(function (p) { return p[1]; });
  var s = get('TempReglages/seuils'), seuils = s ? tfObj_(s.fields) : {};

  var rows = [], page = '';
  do {
    var res = get('TempReleves?pageSize=300' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    ((res && res.documents) || []).forEach(function (d) {
      var o = tfObj_(d.fields), at = new Date(o.at), day = iso_(at);
      if (!day) return;
      var vals = {}, v = o.values || {};
      Object.keys(v).forEach(function (id) { if (label[id] && typeof v[id] === 'number') vals[label[id]] = v[id]; });
      rows.push({ id: d.name.split('/').pop(), day: day, salon: String(o.salon || ''), vals: vals });
    });
    page = (res && res.nextPageToken) || '';
  } while (page);

  return { rows: rows, cols: cols,
    seuilBas: typeof seuils.min === 'number' ? seuils.min : '', seuilHaut: typeof seuils.max === 'number' ? seuils.max : '' };
}

function tfObj_(fields) { var o = {}; Object.keys(fields || {}).forEach(function (k) { o[k] = tfDec_(fields[k]); }); return o; }
function tfDec_(v) {
  if (!v || 'nullValue' in v) return null;
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return tfObj_(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(tfDec_);
  return null;
}
