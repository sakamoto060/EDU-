/* ======================================================================
 * EDU+ - Integracao simulada com o sistema academico JACAD
 *
 * Camada de mock que reproduz o comportamento de uma API REST do JACAD
 * (registro academico, matricula, curso e situacao de matricula).
 * Todo o trafego e local e assincrono, permitindo testar o fluxo de
 * validacao sem dependencia de rede.
 *
 * API publica (window.Jacad):
 *    consultarPorRA(ra)        -> Promise<Object>
 *    sincronizarCarteirinha()  -> Promise<Object>
 *    montarPayload(perfil)     -> String
 *    parsePayload(payload)     -> Object|null
 *    validarPayload(payload)   -> Promise<Object>
 *    hashValidade(perfil)      -> String
 *    siglaDoNome(nome)         -> String
 * ====================================================================== */
(function (global) {
  'use strict';

  var CURSOS = [
    'Administracao', 'Direito', 'Enfermagem', 'Engenharia Civil',
    'Fisioterapia', 'Logistica', 'Marketing', 'Pedagogia', 'Psicologia',
    'Quimica', 'Seguranca do Trabalho', 'Servico Social', 'Sistemas de Informacao'
  ];

  var PERIODOS = ['Matutino', 'Noturno', 'Vespertino'];

  function seedFromRa(ra) {
    var s = String(ra || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function hashHex(input) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < input.length; i++) {
      var c = input.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0;
      h1 = Math.imul(h1, 16777619) >>> 0;
      h2 = (h2 + c) >>> 0;
      h2 = Math.imul(h2 ^ (h2 >>> 13), 2246822519) >>> 0;
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  function hashValidade(perfil) {
    var base = [
      String(perfil.ra || '').toUpperCase(),
      String(perfil.instituicaoSigla || perfil.instituicaoNome || '').toUpperCase(),
      String(perfil.validade || ''),
      String(perfil.nome || '').toUpperCase()
    ].join('|');
    return hashHex(base).toUpperCase();
  }

  /* Sigla usada na assinatura do QR: iniciais do nome da instituicao.
     Nao aparece na interface, mas precisa ser reproduzivel por quem valida. */
  var PALAVRAS_IGNORADAS = { de: 1, do: 1, da: 1, das: 1, dos: 1, e: 1, em: 1 };

  function siglaDoNome(nome) {
    var palavras = String(nome || '').toUpperCase().split(/[^A-Z0-9]+/).filter(function (p) {
      return p && !PALAVRAS_IGNORADAS[p.toLowerCase()];
    });
    if (!palavras.length) return '';
    if (palavras.length === 1) return palavras[0].slice(0, 12);
    return palavras.map(function (p) { return p.charAt(0); }).join('').slice(0, 12);
  }

  function consultarPorRA(ra) {
    var limpo = String(ra || '').replace(/\D/g, '');
    if (limpo.length < 4) {
      return Promise.reject(new Error('RA invalido: informe ao menos 4 digitos.'));
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        var h = seedFromRa(limpo);
        var matriculado = (h % 97) > 6;
        resolve({
          origem: 'JACAD (simulado)',
          ra: limpo,
          matriculado: matriculado,
          situacao: matriculado ? 'MATRICULADO' : 'SEM MATRICULA NO PERIODO',
          curso: CURSOS[h % CURSOS.length],
          periodo: PERIODOS[(h >> 3) % PERIODOS.length],
          campus: ['Campus Central', 'Campus Norte', 'Campus Unidade Leste'][h % 3],
          entrada: (2015 + (h % 10)) + '-' + String(1 + (h % 12)).padStart(2, '0'),
          meiEntrada: matriculado && (h % 5) !== 0,
          verificadoEm: new Date().toISOString()
        });
      }, 420);
    });
  }

  function sincronizarCarteirinha(perfil) {
    return consultarPorRA(perfil.ra).then(function (dados) {
      return {
        perfil: perfil,
        jacad: dados,
        meioEntradaAtivo: !!dados.meiEntrada,
        hash: hashValidade(perfil)
      };
    });
  }

  function montarPayload(perfil) {
    var partes = [
      'EDU+',
      'V2',
      'R:' + (perfil.ra || ''),
      'N:' + encodeURIComponent(perfil.nome || ''),
      'I:' + encodeURIComponent(perfil.instituicaoNome || ''),
      'S:' + (perfil.instituicaoSigla || siglaDoNome(perfil.instituicaoNome)),
      'V:' + (perfil.validade || ''),
      'C:' + encodeURIComponent(perfil.curso || ''),
      'H:' + hashValidade(perfil)
    ];
    return partes.join('|');
  }

  function parsePayload(payload) {
    var texto = String(payload || '').trim();
    if (!texto) return null;
    var itens = texto.split('|');
    if (itens[0] !== 'EDU+') return null;

    var out = { versao: itens[1] === 'V2' ? 2 : (itens[1] === 'V1' ? 1 : 0), bruto: texto };
    for (var i = 2; i < itens.length; i++) {
      var sep = itens[i].indexOf(':');
      if (sep < 0) continue;
      var chave = itens[i].slice(0, sep);
      var valor = itens[i].slice(sep + 1);
      switch (chave) {
        /* V2 (compacto) */
        case 'R': out.ra = valor; break;
        case 'N': out.nome = decodeURIComponent(valor); break;
        case 'I': out.instituicaoNome = decodeURIComponent(valor); break;
        case 'S': out.instituicaoSigla = valor; break;
        case 'V': out.validade = valor; break;
        case 'C': out.curso = decodeURIComponent(valor); break;
        case 'H': out.hash = valor; break;
        /* V1 (legado) */
        case 'ID': out.id = valor; break;
        case 'NOME': out.nome = decodeURIComponent(valor); break;
        case 'RA': out.ra = valor; break;
        case 'INST': out.instituicaoNome = decodeURIComponent(valor); break;
        case 'SIGLA': out.instituicaoSigla = valor; break;
        case 'VAL': out.validade = valor; break;
        case 'HASH': out.hash = valor; break;
        default: break;
      }
    }
    return out;
  }

  function validarPayload(payload) {
    var dados = parsePayload(payload);
    if (!dados) {
      return Promise.resolve({ ok: false, motivo: 'QR Code invalido: payload nao reconhecido.' });
    }
    if (!dados.ra) {
      return Promise.resolve({ ok: false, motivo: 'QR Code invalido: R.A. ausente.', dados: dados });
    }

    var hashEsperado = hashValidade({
      nome: dados.nome,
      ra: dados.ra,
      instituicaoSigla: dados.instituicaoSigla || siglaDoNome(dados.instituicaoNome),
      instituicaoNome: dados.instituicaoNome,
      validade: dados.validade
    });

    var hashConfere = String(hashEsperado).toUpperCase() === String(dados.hash || '').toUpperCase();

    return consultarPorRA(dados.ra).then(function (jacad) {
      var hoje = new Date();
      var vencida = false;
      if (dados.validade) {
        var limite = new Date(dados.validade + 'T23:59:59');
        vencida = !isNaN(limite.getTime()) && limite < hoje;
      }
      var ok = hashConfere && jacad.matriculado && jacad.meiEntrada && !vencida;
      return {
        ok: ok,
        dados: dados,
        hashConfere: hashConfere,
        vencida: vencida,
        jacad: jacad,
        verificadoEm: new Date().toISOString()
      };
    }).catch(function (err) {
      return { ok: false, dados: dados, motivo: err.message || 'Falha ao consultar o JACAD.' };
    });
  }

  global.Jacad = {
    consultarPorRA: consultarPorRA,
    sincronizarCarteirinha: sincronizarCarteirinha,
    montarPayload: montarPayload,
    parsePayload: parsePayload,
    validarPayload: validarPayload,
    hashValidade: hashValidade,
    siglaDoNome: siglaDoNome
  };

})(window);
