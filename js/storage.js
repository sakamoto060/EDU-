/* ======================================================================
 * EDU+ - Camada de armazenamento local
 *
 * Estrategia:
 *  - IndexedDB para dados estruturados (carteirinha, instituicoes, fotos
 *    em Blob) - suporta grandes volumes e gravacao assincrona.
 *  - localStorage como fallback automatico e para espelhar os dados
 *    principais, garantindo leitura imediata e persistencia.
 *
 * API publica (window.EduStore):
 *    ready()                     -> Promise<void>
 *    getProfile()                -> Object|null
 *    saveProfile(profile)        -> Promise<Object>
 *    getInstitutions()           -> Array
 *    saveInstitution(inst)       -> Promise<Array>
 *    removeInstitution(id)       -> Promise<Array>
 *    getPhoto()                  -> Promise<Blob|null>
 *    savePhoto(blob)             -> Promise<void>
 *    clearPhoto()                -> Promise<void>
 *    reset()                     -> Promise<void>
 * ====================================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'eduplus-db';
  var DB_VERSION = 1;
  var STORE = 'kv';
  var LS_PROFILE = 'eduplus.profile';
  var LS_INST = 'eduplus.institutions';
  var LS_PHOTO = 'eduplus.photo';

  /* Logos oficiais empacotados no app, usados quando a instituicao nao possui um. */
  var LOGOS_PADRAO = {
    insted: 'assets/insted-logo.svg'
  };

  var dbPromise = null;
  var useIdb = true;
  var idbBroken = false;
  var IDB_TIMEOUT_MS = 2000;

  /* ------------------------------------------------------- IndexedDB */
  function openDb() {
    if (dbPromise) return dbPromise;
    if (idbBroken || typeof global.indexedDB === 'undefined') {
      useIdb = false;
      return Promise.reject(new Error('IndexedDB indisponivel'));
    }
    dbPromise = new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        idbBroken = true;
        fallback(new Error('IndexedDB nao respondeu a tempo'));
      }, IDB_TIMEOUT_MS);

      function fallback(err) {
        if (settled) return;
        settled = true;
        useIdb = false;
        clearTimeout(timer);
        reject(err);
      }

      var req;
      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        return fallback(err);
      }
      req.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function (event) {
        if (settled) { try { event.target.result.close(); } catch (err) { /* ignora */ } return; }
        settled = true;
        clearTimeout(timer);
        resolve(event.target.result);
      };
      req.onerror = function (event) {
        idbBroken = true;
        fallback(event.target.error || new Error('IndexedDB indisponivel'));
      };
      req.onblocked = function () {
        idbBroken = true;
        fallback(new Error('IndexedDB bloqueado'));
      };
    }).catch(function (err) {
      useIdb = false;
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function idbDel(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* ---------------------------------------------------- localStorage */
  function lsGet(key) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  function lsSet(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { return false; }
  }

  function lsDel(key) {
    try { global.localStorage.removeItem(key); } catch (err) { /* ignora */ }
  }

  /* ------------------------------------------- abstracts com fallback */
  function read(key, lsKey) {
    if (useIdb) {
      return idbGet(key).then(function (value) {
        if (value === undefined || value === null) {
          var fb = lsGet(lsKey);
          if (fb !== null) { idbSet(key, fb).catch(function () { }); return fb; }
          return null;
        }
        return value;
      }).catch(function () {
        useIdb = false;
        return lsGet(lsKey);
      });
    }
    return Promise.resolve(lsGet(lsKey));
  }

  function write(key, lsKey, value) {
    lsSet(lsKey, isBlobLike(value) ? null : value);
    if (!useIdb) return Promise.resolve(value);
    return idbSet(key, value).then(function () { return value; })
      .catch(function () { useIdb = false; lsSet(lsKey, value); return value; });
  }

  function remove(key, lsKey) {
    lsDel(lsKey);
    if (!useIdb) return Promise.resolve(true);
    return idbDel(key).catch(function () { return false; });
  }

  function isBlobLike(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
  }

  /* ---------------------------------------------------------- Perfil */
  function getProfile() {
    return read('profile', LS_PROFILE);
  }

  function saveProfile(profile) {
    var clean = {
      id: profile.id || ('edu-' + Date.now().toString(36)),
      nome: (profile.nome || '').trim(),
      ra: (profile.ra || '').trim(),
      curso: (profile.curso || '').trim(),
      instituicaoId: profile.instituicaoId || null,
      instituicaoNome: profile.instituicaoNome || '',
      instituicaoSigla: profile.instituicaoSigla || '',
      validade: profile.validade || '',
      foto: isBlobLike(profile.foto) ? profile.foto : (profile.foto || null),
      formatoFoto: profile.formatoFoto || '3x4',
      meioEntrada: profile.meioEntrada !== false,
      atualizadoEm: new Date().toISOString()
    };
    return write('profile', LS_PROFILE, clean);
  }

  /* ------------------------------------------------- Instituicoes */
  function getInstitutions() {
    return read('institutions', LS_INST).then(function (list) {
      var arr = Array.isArray(list) && list.length ? list : defaultInstitutions();
      /* Aplica o logo oficial empacotado quando a instituicao nao tem um. */
      return arr.map(function (inst) {
        if (!inst.logo && LOGOS_PADRAO[inst.id]) inst.logo = LOGOS_PADRAO[inst.id];
        return inst;
      });
    });
  }

  function saveInstitution(inst) {
    return getInstitutions().then(function (list) {
      var record = {
        id: inst.id || ('inst-' + Date.now().toString(36)),
        nome: (inst.nome || '').trim(),
        sigla: (inst.sigla || '').trim().toUpperCase(),
        logo: inst.logo || null,
        criadoEm: inst.criadoEm || new Date().toISOString()
      };
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].id === record.id) idx = i;
      if (idx >= 0) list[idx] = record; else list.push(record);
      return write('institutions', LS_INST, list).then(function () { return list; });
    });
  }

  function removeInstitution(id) {
    return getInstitutions().then(function (list) {
      var next = list.filter(function (item) { return item.id !== id; });
      if (!next.length) next = defaultInstitutions();
      return write('institutions', LS_INST, next).then(function () { return next; });
    });
  }

  function defaultInstitutions() {
    return [{
      id: 'insted',
      nome: 'Insted - Faculdade Insted',
      sigla: 'INSTED',
      logo: LOGOS_PADRAO.insted,
      criadoEm: '2024-01-01T00:00:00.000Z'
    }];
  }

  /* ----------------------------------------------------------- Foto */
  function getPhoto() {
    return read('photo', LS_PHOTO).then(function (value) {
      if (value && typeof value === 'object' && value.dataUrl) return value.dataUrl;
      if (typeof value === 'string' && value.indexOf('data:') === 0) return value;
      return null;
    });
  }

  function savePhoto(dataUrl) {
    return write('photo', LS_PHOTO, dataUrl);
  }

  function clearPhoto() {
    return remove('photo', LS_PHOTO);
  }

  /* ---------------------------------------------------------- Reset */
  function reset() {
    lsDel(LS_PROFILE);
    lsDel(LS_INST);
    lsDel(LS_PHOTO);
    if (!useIdb) return Promise.resolve(true);
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function ready() {
    if (typeof global.indexedDB === 'undefined') { useIdb = false; return Promise.resolve(false); }
    return openDb().then(function () { return true; }).catch(function () { useIdb = false; return false; });
  }

  global.EduStore = {
    ready: ready,
    getProfile: getProfile,
    saveProfile: saveProfile,
    getInstitutions: getInstitutions,
    saveInstitution: saveInstitution,
    removeInstitution: removeInstitution,
    getPhoto: getPhoto,
    savePhoto: savePhoto,
    clearPhoto: clearPhoto,
    reset: reset,
    usingIndexedDB: function () { return useIdb; }
  };

})(window);
