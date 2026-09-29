/* ======================================================================
 * EDU+ - Carteirinha Estudantil Digital
 * Logica principal: estado, renderizacao, persistencia e validacao.
 * ====================================================================== */
(function () {
  'use strict';

  var LS_SEED_DONE = 'eduplus.seeded';
  var LS_FOTO_OFF = 'eduplus.photo.off';

  /* Assets locais usados como identidade visual padrao */
  var ASSETS = {
    fotoPadrao: 'assets/avatar-victor.svg',
    logoPadrao: 'assets/insted-logo.svg'
  };

  var el = {};
  var state = {
    profile: null,
    institutions: [],
    photo: null,
    selectedInstitution: null,
    formShape: '3x4',
    qrPayload: '',
    installPrompt: null
  };

  /* ------------------------------------------------------------ utils */
  function $(id) { return document.getElementById(id); }

  function cacheElements() {
    [
      'screenCard', 'screenSettings', 'screenValidate',
      'btnSettings', 'btnValidate', 'btnInstall', 'btnBack', 'btnBackValidate',
      'instName', 'instLogo', 'instLogoFallback',
      'photoFrame', 'photoFrameSmall', 'studentPhoto', 'photoPreview', 'studentName',
      'studentRa', 'studentValid', 'studentCourse', 'badgeStatus', 'badgeSync',
      'qrHolder', 'qrHint', 'offlineNote', 'toast',
      'formSettings', 'instSelect', 'instPreview', 'instPreviewName',
      'instPreviewLogoBox', 'btnNewInst', 'newInstFields', 'newInstName',
      'newInstLogo', 'btnCancelNewInst', 'btnSaveNewInst',
      'inputName', 'inputRa', 'inputCourse', 'inputValid',
      'fileCamera', 'fileGallery', 'btnRemovePhoto',
      'btnReset', 'jacadDot', 'jacadText', 'inputPayload', 'btnValidatePayload',
      'btnUseOwn', 'validateResult', 'validateTitle', 'validateOrigem'
    ].forEach(function (id) { el[id] = $(id); });
  }

  function toast(msg, type) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.className = 'toast is-on' + (type ? ' is-' + type : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.className = 'toast'; }, 2800);
  }

  function showScreen(name) {
    ['screenCard', 'screenSettings', 'screenValidate'].forEach(function (id) {
      el[id].classList.toggle('is-active', id === name);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function defaultValidity() {
    var d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function formatDateBR(iso) {
    if (!iso) return '--/----';
    var p = String(iso).split('-');
    if (p.length !== 3) return '--/----';
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function normalizeRa(v) { return String(v || '').replace(/\s+/g, ''); }

  /* Sigla interna (nao aparece na interface) — ver Jacad.siglaDoNome. */

  /* Flags locais que nao cabem no perfil persistido */
  function readFlag(key) {
    try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
  }

  function setPhotoOffFlag() {
    try { localStorage.setItem(LS_FOTO_OFF, '1'); } catch (e) { /* ignora */ }
  }

  function clearPhotoOffFlag() {
    try { localStorage.removeItem(LS_FOTO_OFF); } catch (e) { /* ignora */ }
  }

  function isExpired(dateIso) {
    if (!dateIso) return false;
    var d = new Date(dateIso + 'T23:59:59');
    return !isNaN(d.getTime()) && d < new Date();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------- leitura de imagem */
  function readImageAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Arquivo nao encontrado.'));
      if (file.size > 12 * 1024 * 1024) return reject(new Error('Imagem muito grande (max. 12 MB).'));

      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 720;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          try {
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          } catch (err) {
            resolve(reader.result);
          }
        };
        img.onerror = function () { reject(new Error('Nao foi possivel ler a imagem.')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('Falha ao abrir o arquivo.')); };
      reader.readAsDataURL(file);
    });
  }

  /* ------------------------------------------------------ render card */
  function renderCard() {
    var p = state.profile || {};
    var inst = state.selectedInstitution;

    var nome = (p.nome || '').trim();
    var ra = normalizeRa(p.ra);
    var instNome = (inst && inst.nome) || p.instituicaoNome || 'Insted - Faculdade Insted';

    el.instName.textContent = instNome;
    el.studentName.textContent = nome || 'NOME DO ESTUDANTE';
    el.studentRa.textContent = ra || '0000000';
    el.studentValid.textContent = formatDateBR(p.validade);
    el.studentCourse.textContent = (p.curso || '').trim() || 'Curso nao informado';

    var logo = inst && inst.logo;
    if (logo) {
      el.instLogo.src = logo;
      el.instLogo.removeAttribute('hidden');
      el.instLogoFallback.setAttribute('hidden', '');
    } else {
      el.instLogo.removeAttribute('src');
      el.instLogo.setAttribute('hidden', '');
      el.instLogoFallback.removeAttribute('hidden');
    }

    applyPhoto();
    applyShape(p.formatoFoto || '3x4');
    renderStatus();
    renderQr();
  }

  function applyPhoto() {
    var src = state.photo;
    [el.studentPhoto, el.photoPreview].forEach(function (img) {
      if (!img) return;
      if (src) {
        img.src = src;
        img.classList.add('has-photo');
      } else {
        img.removeAttribute('src');
        img.classList.remove('has-photo');
      }
    });
    [el.photoFrame, el.photoFrameSmall].forEach(function (f) {
      if (f) f.classList.toggle('has-photo', !!src);
    });
  }

  function applyShape(shape) {
    state.formShape = shape === 'circle' ? 'circle' : '3x4';
    if (el.photoFrame) el.photoFrame.setAttribute('data-shape', state.formShape);
    if (el.photoFrameSmall) el.photoFrameSmall.setAttribute('data-shape', state.formShape);
  }

  function renderStatus() {
    var p = state.profile || {};
    var ativo = p.meioEntrada !== false;
    var vencida = isExpired(p.validade);

    el.badgeStatus.textContent = ativo && !vencida
      ? 'MEIA-ENTRADA ATIVA'
      : (vencida ? 'CARTEIRINHA VENCIDA' : 'MEIA-ENTRADA INATIVA');
    el.badgeStatus.classList.toggle('is-expired', !ativo || vencida);
  }

  /* -------------------------------------- link de validacao do QR Code
   *
   * O QR Code grava um endereco (https://<site>/?v=<payload>) em vez do
   * texto solto. Assim a camera de qualquer celular abre a pagina e mostra
   * a comprobacao da carteirinha, sem precisar do app instalado.
   *
   * O endereco vem do proprio app (location), entao funciona em qualquer
   * hospedagem. Para fixar um dominio especifico, defina no index.html,
   * antes do app.js:  <script>window.EDU_BASE_URL = 'https://.../'</script>
   * Sem endereco (aberto por file://), o QR volta a gravar o payload em
   * texto puro, que continua valendo pela tela "Validar Carteirinha".
   */
  function baseValidacao() {
    var fixo = String((typeof window !== 'undefined' && window.EDU_BASE_URL) || '').trim();
    if (fixo) return fixo.replace(/\/+$/, '') + '/';
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return location.origin + location.pathname;
    }
    return '';
  }

  function linkValidacao(payload) {
    var base = baseValidacao();
    if (!base) return '';
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'v=' + payload;
  }

  /* Le o payload vindo do link (?v=...). */
  function payloadDoLink() {
    var m = /[?&]v=([^&#]*)/.exec(String(location.search || ''));
    if (!m || !m[1]) return '';
    var bruto = m[1];
    /* O navegador escapa os separadores do link (| e : viram %7C e %3A);
       so eles sao restaurados, para nao mexer no texto percent-encoded
       dos campos (nome, curso, instituicao). */
    bruto = bruto.replace(/%7C/gi, '|').replace(/%3A/gi, ':');
    return bruto;
  }

  function renderQr() {
    var p = state.profile || {};
    var inst = state.selectedInstitution;
    var payload = Jacad.montarPayload({
      id: p.id,
      nome: p.nome,
      ra: normalizeRa(p.ra),
      instituicaoNome: (inst && inst.nome) || p.instituicaoNome,
      instituicaoSigla: (inst && inst.sigla) || p.instituicaoSigla,
      validade: p.validade,
      curso: p.curso
    });
    state.qrPayload = payload;

    var link = linkValidacao(payload);
    state.qrLink = link;
    if (el.qrHint) {
      el.qrHint.textContent = link
        ? 'Escaneie para ver a validacao da carteirinha'
        : 'Escaneie e valide pela tela de validacao';
    }

    el.qrHolder.innerHTML = '';
    try {
      var qr = QRCodegen.encodeText(link || payload, QRCodegen.Ecc.MEDIUM, { boostEcl: false });
      var canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'QR Code de validacao da carteirinha');
      el.qrHolder.appendChild(canvas);

      /* Escala inteira: cada modulo vira N pixels exatos, sem borrar nem
         cortar. O canvas fica centralizado dentro do quadro. */
      var modulos = qr.size + 8; /* 4 modulos de borda de cada lado */
      var lado = el.qrHolder.clientWidth || 196;
      var escala = Math.max(2, Math.floor(lado / modulos));
      var px = escala * modulos;

      QRCodegen.renderToCanvas(qr, canvas, escala, '#ffffff', '#0d2137');
      if (px <= lado) {
        canvas.style.width = px + 'px';
        canvas.style.height = px + 'px';
      } else {
        /* Payload gigante: preenche o quadro para nunca estourar o cartao. */
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      }
    } catch (err) {
      el.qrHolder.innerHTML = '<p style="font-size:12px;color:#5a7897;padding:8px;">QR indisponivel</p>';
    }
  }

  /* ---------------------------------------------- instituicoes (UI) */
  function renderInstitutionSelect() {
    el.instSelect.innerHTML = '';
    state.institutions.forEach(function (inst) {
      var o = document.createElement('option');
      o.value = inst.id;
      o.textContent = inst.nome;
      el.instSelect.appendChild(o);
    });

    var current = state.profile && state.profile.instituicaoId;
    if (current && state.institutions.some(function (i) { return i.id === current; })) {
      el.instSelect.value = current;
    }
    onInstitutionChange();
  }

  function onInstitutionChange() {
    var id = el.instSelect.value;
    state.selectedInstitution = state.institutions.filter(function (i) { return i.id === id; })[0] || state.institutions[0] || null;

    var inst = state.selectedInstitution;
    el.instPreviewName.textContent = inst ? inst.nome : '-';

    var box = el.instPreviewLogoBox;
    var oldImg = box.querySelector('img');
    if (inst && inst.logo) {
      if (!oldImg) {
        oldImg = document.createElement('img');
        oldImg.alt = 'Logo da instituicao';
        box.insertBefore(oldImg, box.firstChild);
      }
      oldImg.src = inst.logo;
      oldImg.classList.add('has-logo');
    } else if (oldImg) {
      box.removeChild(oldImg);
    }
  }

  /* ---------------------------------------------- formulario (UI) */
  function fillForm() {
    var p = state.profile || {};
    el.inputName.value = p.nome || '';
    el.inputRa.value = p.ra || '';
    el.inputCourse.value = p.curso || '';
    el.inputValid.value = p.validade || defaultValidity();
    applyShape(p.formatoFoto || '3x4');
    syncShapeButtons();
    applyPhoto();
  }

  function syncShapeButtons() {
    var btns = document.querySelectorAll('.seg-btn[data-shape]');
    Array.prototype.forEach.call(btns, function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-shape') === state.formShape);
    });
  }

  function toggleNewInst(open) {
    el.newInstFields.hidden = !open;
    if (open) el.newInstName.focus();
  }

  /* --------------------------------------------------------- acoes */
  function saveForm() {
    var nome = el.inputName.value.trim();
    var ra = normalizeRa(el.inputRa.value);
    var curso = el.inputCourse.value.trim();
    var validade = el.inputValid.value;
    var inst = state.selectedInstitution;

    if (!nome) { toast('Informe o nome completo.', 'error'); el.inputName.focus(); return; }
    if (ra.length < 4) { toast('Informe um R.A. valido.', 'error'); el.inputRa.focus(); return; }
    if (!validade) { toast('Informe a data de validade.', 'error'); el.inputValid.focus(); return; }

    state.profile = {
      id: (state.profile && state.profile.id) || ('edu-' + Date.now().toString(36)),
      nome: nome,
      ra: ra,
      curso: curso,
      instituicaoId: inst ? inst.id : null,
      instituicaoNome: inst ? inst.nome : '',
      instituicaoSigla: inst ? inst.sigla : '',
      validade: validade,
      formatoFoto: state.formShape,
      meioEntrada: state.profile ? state.profile.meioEntrada !== false : true
    };

    EduStore.savePhoto(state.photo).catch(function () { });
    EduStore.saveProfile(state.profile).then(function () {
      renderCard();
      toast('Dados salvos no dispositivo.', 'ok');
      showScreen('screenCard');
    });
  }

  function handlePhotoFile(file) {
    if (!file) return;
    readImageAsDataUrl(file).then(function (dataUrl) {
      state.photo = dataUrl;
      clearPhotoOffFlag();
      applyPhoto();
      toast('Foto atualizada.', 'ok');
    }).catch(function (err) {
      toast(err.message || 'Nao foi possivel carregar a foto.', 'error');
    });
  }

  function removePhoto() {
    state.photo = null;
    setPhotoOffFlag();
    EduStore.clearPhoto().catch(function () { });
    applyPhoto();
    toast('Foto removida.');
  }

  function saveNewInstitution() {
    var nome = el.newInstName.value.trim();
    if (!nome) { toast('Informe o nome da instituicao.', 'error'); el.newInstName.focus(); return; }

    var logoData = null;
    var file = el.newInstLogo.files && el.newInstLogo.files[0];

    var proceed = function () {
      /* A sigla nao e perguntada: e gerada a partir do nome e usada so
         internamente no payload do QR. */
      EduStore.saveInstitution({ nome: nome, sigla: Jacad.siglaDoNome(nome), logo: logoData }).then(function (list) {
        state.institutions = list;
        renderInstitutionSelect();
        var nova = list[list.length - 1];
        if (nova && el.instSelect.querySelector('option[value="' + nova.id + '"]')) {
          el.instSelect.value = nova.id;
        }
        onInstitutionChange();
        el.newInstName.value = '';
        el.newInstLogo.value = '';
        toggleNewInst(false);
        toast('Instituicao cadastrada.', 'ok');
      });
    };

    if (file) {
      readImageAsDataUrl(file).then(function (url) { logoData = url; proceed(); })
        .catch(function () { logoData = null; proceed(); });
    } else {
      proceed();
    }
  }

  function resetAll() {
    if (!window.confirm('Isso apaga nome, R.A., foto e instituicoes salvas neste dispositivo. Continuar?')) return;
    EduStore.reset().then(function () {
      state.profile = null;
      state.photo = ASSETS.fotoPadrao;
      clearPhotoOffFlag();
      try { localStorage.removeItem(LS_SEED_DONE); } catch (e) { }
      seedProfile().then(function () {
        EduStore.getInstitutions().then(function (list) {
          state.institutions = list;
          state.selectedInstitution = list[0];
          renderInstitutionSelect();
          fillForm();
          renderCard();
          showScreen('screenCard');
          toast('Dados limpos.');
        });
      });
    });
  }

  /* ----------------------------------------------------- validacao */
  function abrirComprovanteDoLink() {
    var payload = payloadDoLink();
    if (!payload) return;

    if (el.validateTitle) el.validateTitle.textContent = 'Comprovante da carteirinha';
    if (el.validateOrigem) el.validateOrigem.removeAttribute('hidden');
    el.inputPayload.value = payload;
    el.validateResult.hidden = true;
    showScreen('screenValidate');
    runValidation(payload);

    /* Tira o parametro da barra de endereco: recarregar a pagina nao deve
       repetir a validacao, e o QR da carteirinha continua intacto. */
    try {
      var limpo = location.pathname;
      history.replaceState(null, '', limpo);
    } catch (e) { /* file:// pode bloquear */ }
  }

  function renderValidationResult(res) {
    var box = el.validateResult;
    box.hidden = false;
    box.className = 'result ' + (res.ok ? 'is-ok' : 'is-err');

    if (!res.ok && res.motivo) {
      box.innerHTML = '<h4>QR Code recusado</h4><p>' + escapeHtml(res.motivo) + '</p>';
      return;
    }

    var d = res.dados || {};
    var j = res.jacad || {};

    var linhas = [
      'Estudante: <strong>' + escapeHtml(d.nome || 'nao informado') + '</strong>',
      'R.A.: <strong>' + escapeHtml(d.ra || '-') + '</strong>',
      'Instituicao: <strong>' + escapeHtml(d.instituicaoNome || '-') + '</strong>',
      'Validade: <strong>' + formatDateBR(d.validade) + '</strong>',
      'Curso: <strong>' + escapeHtml(d.curso || j.curso || '-') + '</strong>',
      'Situacao JACAD: <strong>' + escapeHtml(j.situacao || '-') + '</strong>'
    ];

    var titulo = res.ok ? 'Meia-entrada liberada' : 'Meia-entrada nao liberada';
    var obs = res.ok
      ? 'Registro valido e matricula ativa no JACAD.'
      : motivoFalha(res);

    box.innerHTML = '<h4>' + titulo + '</h4><ul><li>' + linhas.join('</li><li>') + '</li></ul>'
      + '<p style="margin:10px 0 0;font-weight:600;">' + escapeHtml(obs) + '</p>'
      + '<p class="result-hash">Hash de validade: ' + escapeHtml(d.hash || '-') + '</p>';
  }

  function motivoFalha(res) {
    if (res.motivo) return res.motivo;
    if (!res.hashConfere) return 'Hash de validade divergente: o QR Code pode ter sido alterado.';
    if (res.vencida) return 'Carteirinha fora do prazo de validade.';
    if (res.jacad && !res.jacad.matriculado) return 'RA sem matricula ativa no periodo no JACAD.';
    if (res.jacad && !res.jacad.meiEntrada) return 'Estudante sem desconto de meia-entrada liberado no JACAD.';
    return 'Nao foi possivel confirmar a validacao.';
  }

  function runValidation(payload) {
    el.jacadDot.className = 'dot';
    el.jacadText.textContent = 'Consultando JACAD (simulado)...';

    return Jacad.validarPayload(payload).then(function (res) {
      if (res.ok) {
        el.jacadDot.className = 'dot is-ok';
        el.jacadText.textContent = 'JACAD respondeu: matricula conferida.';
      } else {
        el.jacadDot.className = 'dot is-err';
        el.jacadText.textContent = 'JACAD respondeu: validacao negada.';
      }
      renderValidationResult(res);
      return res;
    }).catch(function (err) {
      el.jacadDot.className = 'dot is-err';
      el.jacadText.textContent = 'Falha na comunicacao com o JACAD.';
      renderValidationResult({ ok: false, motivo: err.message || 'Erro inesperado.' });
    });
  }

  /* ---------------------------------------------------------- PWA */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('service-worker.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Atualizacao disponivel. Reabra o app.');
          }
        });
      });
    }).catch(function () { /* offline continua funcionando sem SW */ });
  }

  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.installPrompt = e;
      el.btnInstall.hidden = false;
    });

    window.addEventListener('appinstalled', function () {
      state.installPrompt = null;
      el.btnInstall.hidden = true;
      toast('EDU+ instalado com sucesso.', 'ok');
    });
  }

  function doInstall() {
    if (!state.installPrompt) {
      toast('Use o menu do navegador para instalar o app.');
      return;
    }
    state.installPrompt.prompt();
    state.installPrompt.userChoice.then(function () {
      state.installPrompt = null;
      el.btnInstall.hidden = true;
    });
  }

  function updateNetworkStatus() {
    var offline = !navigator.onLine;
    el.offlineNote.hidden = !offline;
    if (!offline) {
      el.badgeSync.textContent = 'JACAD: Sincronizado';
      el.badgeSync.classList.remove('is-error');
    } else {
      el.badgeSync.textContent = 'JACAD: Offline';
      el.badgeSync.classList.add('is-error');
    }
  }

  /* ------------------------------------------------------ bootstrap */
  function seedProfile() {
    return EduStore.getProfile().then(function (p) {
      if (p) { state.profile = p; return p; }
      var seed = {
        id: 'edu-demo',
        nome: 'Victor Sakamoto',
        ra: '2023156789',
        curso: 'Analise e Desenvolvimento de Sistemas',
        instituicaoId: 'insted',
        instituicaoNome: 'Insted - Faculdade Insted',
        instituicaoSigla: 'INSTED',
        validade: defaultValidity(),
        formatoFoto: '3x4',
        meioEntrada: true
      };
      state.profile = seed;
      return EduStore.saveProfile(seed);
    });
  }

  function init() {
    cacheElements();
    registerServiceWorker();
    setupInstallPrompt();
    updateNetworkStatus();

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    EduStore.ready()
      .then(seedProfile)
      .then(function () {
        return Promise.all([EduStore.getInstitutions(), EduStore.getPhoto()]);
      })
      .then(function (res) {
        state.institutions = res[0] || [];
        state.photo = res[1] || (readFlag(LS_FOTO_OFF) ? null : ASSETS.fotoPadrao);

        if (state.profile && state.profile.instituicaoId) {
          state.selectedInstitution = state.institutions.filter(function (i) {
            return i.id === state.profile.instituicaoId;
          })[0] || state.institutions[0];
        } else {
          state.selectedInstitution = state.institutions[0];
        }

        renderInstitutionSelect();
        fillForm();
        renderCard();

        if (state.profile && normalizeRa(state.profile.ra)) checkJacad();

        abrirComprovanteDoLink();
      })
      .catch(function (err) {
        toast('Falha ao carregar os dados salvos.', 'error');
        if (err) console.error(err);
      });

    bindEvents();
  }

  function checkJacad() {
    var p = state.profile;
    if (!p || !normalizeRa(p.ra)) return;
    Jacad.consultarPorRA(p.ra).then(function (dados) {
      state.profile.meioEntrada = !!dados.meiEntrada;
      EduStore.saveProfile(state.profile).catch(function () { });
      renderStatus();
      el.badgeSync.textContent = dados.matriculado ? 'JACAD: Sincronizado' : 'JACAD: Sem matricula';
      el.badgeSync.classList.toggle('is-error', !dados.matriculado);
    }).catch(function () {
      el.badgeSync.textContent = 'JACAD: Indisponivel';
      el.badgeSync.classList.add('is-error');
    });
  }

  function bindEvents() {
    el.btnSettings.addEventListener('click', function () {
      fillForm();
      showScreen('screenSettings');
    });

    el.btnBack.addEventListener('click', function () { showScreen('screenCard'); });
    el.btnBackValidate.addEventListener('click', function () { showScreen('screenCard'); });

    el.btnValidate.addEventListener('click', function () {
      if (el.validateOrigem) el.validateOrigem.setAttribute('hidden', '');
      if (el.validateTitle) el.validateTitle.textContent = 'Validacao de meia-entrada';
      el.inputPayload.value = state.qrPayload || '';
      el.validateResult.hidden = true;
      el.jacadDot.className = 'dot';
      el.jacadText.textContent = 'Aguardando leitura do QR Code.';
      showScreen('screenValidate');
    });

    el.instSelect.addEventListener('change', onInstitutionChange);
    el.btnNewInst.addEventListener('click', function () { toggleNewInst(true); });
    el.btnCancelNewInst.addEventListener('click', function () { toggleNewInst(false); });
    el.btnSaveNewInst.addEventListener('click', saveNewInstitution);

    el.formSettings.addEventListener('submit', function (e) {
      e.preventDefault();
      saveForm();
    });

    el.fileCamera.addEventListener('change', function () { handlePhotoFile(this.files && this.files[0]); this.value = ''; });
    el.fileGallery.addEventListener('change', function () { handlePhotoFile(this.files && this.files[0]); this.value = ''; });
    el.btnRemovePhoto.addEventListener('click', removePhoto);

    Array.prototype.forEach.call(document.querySelectorAll('.seg-btn[data-shape]'), function (b) {
      b.addEventListener('click', function () {
        applyShape(b.getAttribute('data-shape'));
        syncShapeButtons();
        if (state.profile) {
          state.profile.formatoFoto = state.formShape;
          EduStore.saveProfile(state.profile).catch(function () { });
        }
        renderCard();
      });
    });

    el.btnReset.addEventListener('click', resetAll);
    el.btnInstall.addEventListener('click', doInstall);

    el.btnValidatePayload.addEventListener('click', function () {
      runValidation(el.inputPayload.value);
    });

    el.btnUseOwn.addEventListener('click', function () {
      el.inputPayload.value = state.qrPayload || '';
      runValidation(el.inputPayload.value);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
