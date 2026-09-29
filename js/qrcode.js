/* ======================================================================
 * QR Code generator (ISO/IEC 18004) - Implementacao standalone em JS puro.
 *
 * Baseado no algoritmo de referencia de Project Nayuki
 * (https://www.nayuki.io/page/qr-code-generator-library), MIT License.
 * Portado para JavaScript sem dependencias externas.
 *
 * Uso:
 *   var qr = QRCodegen.encodeText("texto", QRCodegen.Ecc.MEDIUM);
 *   QRCodegen.renderToCanvas(qr, document.getElementById("canvas"), 8, "black", "white");
 *
 * Modo global: script (window.QRCodegen)
 * ====================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------ helpers */
  function appendBits(val, len, bb) {
    for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }

  function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
  }

  function toUtf8ByteArray(str) {
    var enc = encodeURI(str), out = [];
    for (var i = 0; i < enc.length; i++) {
      if (enc.charAt(i) !== '%') out.push(enc.charCodeAt(i));
      else { out.push(parseInt(enc.substring(i + 1, i + 3), 16)); i += 2; }
    }
    return out;
  }

  /* ----------------------------------------------------- Error correction */
  function Ecc(ordinal, formatBits) {
    this.ordinal = ordinal;
    this.formatBits = formatBits;
  }

  /* ------------------------------------------------------------- Segments */
  function Mode(modeBits, numBitsCharCount) {
    this.modeBits = modeBits;
    this.numBitsCharCount = numBitsCharCount;
  }

  Mode.prototype.numCharCountBits = function (ver) {
    return this.numBitsCharCount[Math.floor((ver + 7) / 17)];
  };

  var Mode_NUMERIC = new Mode(0x1, [10, 12, 14]);
  var Mode_ALPHANUMERIC = new Mode(0x2, [9, 11, 13]);
  var Mode_BYTE = new Mode(0x4, [8, 16, 16]);
  var Mode_KANJI = new Mode(0x8, [8, 10, 12]);
  var Mode_ECI = new Mode(0x7, [0, 0, 0]);

  function QrSegment(mode, numChars, bitData) {
    this.mode = mode;
    this.numChars = numChars;
    this.bitData = bitData.slice();
  }

  QrSegment.prototype.getData = function () { return this.bitData.slice(); };

  QrSegment.getTotalBits = function (segs, version) {
    var result = 0;
    for (var i = 0; i < segs.length; i++) {
      var ccbits = segs[i].mode.numCharCountBits(version);
      if (segs[i].numChars >= (1 << ccbits)) return Infinity;
      result += 4 + ccbits + segs[i].bitData.length;
    }
    return result;
  };

  QrSegment.makeBytes = function (data) {
    var bb = [];
    for (var i = 0; i < data.length; i++) appendBits(data[i], 8, bb);
    return new QrSegment(Mode_BYTE, data.length, bb);
  };

  QrSegment.makeNumeric = function (digits) {
    if (!/^[0-9]*$/.test(digits)) throw new RangeError('String contains non-numeric characters');
    var bb = [], i = 0;
    while (i < digits.length) {
      var n = Math.min(digits.length - i, 3);
      appendBits(parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bb);
      i += n;
    }
    return new QrSegment(Mode_NUMERIC, digits.length, bb);
  };

  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  QrSegment.makeAlphanumeric = function (text) {
    if (!/^[0-9A-Z $%*+-.\/:]*$/.test(text)) throw new RangeError('String contains unencodable characters in alphanumeric mode');
    var bb = [], i = 0;
    for (; i + 2 <= text.length; i += 2) {
      var temp = ALNUM.indexOf(text.charAt(i)) * 45 + ALNUM.indexOf(text.charAt(i + 1));
      appendBits(temp, 11, bb);
    }
    if (i < text.length) appendBits(ALNUM.indexOf(text.charAt(i)), 6, bb);
    return new QrSegment(Mode_ALPHANUMERIC, text.length, bb);
  };

  QrSegment.makeSegments = function (text) {
    if (text === '') return [];
    if (/^[0-9]*$/.test(text)) return [QrSegment.makeNumeric(text)];
    if (/^[0-9A-Z $%*+-.\/:]*$/.test(text)) return [QrSegment.makeAlphanumeric(text)];
    return [QrSegment.makeBytes(toUtf8ByteArray(text))];
  };

  QrSegment.makeEci = function (assignVal) {
    var bb = [];
    if (assignVal < 0) throw new RangeError('ECI assignment value out of range');
    else if (assignVal < (1 << 7)) appendBits(assignVal, 8, bb);
    else if (assignVal < (1 << 14)) { appendBits(0b10, 2, bb); appendBits(assignVal, 14, bb); }
    else { appendBits(0b110, 3, bb); appendBits(assignVal, 21, bb); }
    return new QrSegment(Mode_ECI, 0, bb);
  };

  /* ------------------------------------------------------- QrCode class */
  function QrCode(version, errorCorrectionLevel, dataCodewords, msk) {
    this.version = version;
    this.errorCorrectionLevel = errorCorrectionLevel;
    this.size = version * 4 + 17;

    var row = [], i;
    for (i = 0; i < this.size; i++) row.push(false);
    this.modules = [];
    this.isFunction = [];
    for (i = 0; i < this.size; i++) {
      this.modules.push(row.slice());
      this.isFunction.push(row.slice());
    }

    this.drawFunctionPatterns();
    var allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    if (msk === -1) {
      var minPenalty = 1000000000;
      for (i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        var penalty = this.getPenaltyScore();
        if (penalty < minPenalty) { msk = i; minPenalty = penalty; }
        this.applyMask(i);
      }
    }
    this.mask = msk;
    this.applyMask(msk);
    this.drawFormatBits(msk);
  }

  QrCode.prototype.getModule = function (x, y) {
    return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
  };

  QrCode.prototype.drawFunctionPatterns = function () {
    var i;
    for (i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    var alignPatPos = this.getAlignmentPatternPositions();
    var numAlign = alignPatPos.length;
    for (i = 0; i < numAlign; i++) {
      for (var j = 0; j < numAlign; j++) {
        if (!(i === 0 && j === 0 || i === 0 && j === numAlign - 1 || i === numAlign - 1 && j === 0))
          this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
      }
    }

    this.drawFormatBits(0);
    this.drawVersion();
  };

  QrCode.prototype.drawFormatBits = function (mask) {
    var data = this.errorCorrectionLevel.formatBits << 3 | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10 | rem) ^ 0x5412) >>> 0;

    for (i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    for (i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true);
  };

  QrCode.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (this.version << 12 | rem) >>> 0;
    for (i = 0; i < 18; i++) {
      var color = getBit(bits, i);
      var a = this.size - 11 + i % 3;
      var b = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  };

  QrCode.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx, yy = y + dy;
        if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size)
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  };

  QrCode.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++)
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  };

  QrCode.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  QrCode.prototype.addEccAndInterleave = function (data) {
    var ver = this.version, ecl = this.errorCorrectionLevel;

    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var rsDiv = reedSolomonComputeDivisor(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    var result = [];
    for (var j = 0; j < blocks[0].length; j++) {
      for (var b = 0; b < blocks.length; b++) {
        if (j !== shortBlockLen - blockEccLen || b >= numShortBlocks) result.push(blocks[b][j]);
      }
    }
    return result;
  };

  QrCode.prototype.drawCodewords = function (data) {
    var i = 0;
    for (var right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < this.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  QrCode.prototype.applyMask = function (mask) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        var invert;
        switch (mask) {
          case 0: invert = ((x + y) % 2) === 0; break;
          case 1: invert = (y % 2) === 0; break;
          case 2: invert = (x % 3) === 0; break;
          case 3: invert = ((x + y) % 3) === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2 + (x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2 + (x * y) % 3) % 2) === 0; break;
          case 7: invert = ((((x + y) % 2) + (x * y) % 3) % 2) === 0; break;
          default: throw new Error('Mask value out of range');
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  QrCode.prototype.getPenaltyScore = function () {
    var result = 0, x, y;

    for (y = 0; y < this.size; y++) {
      var runColor = false, runX = 0, runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (x = 0; x < this.size; x++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += 3; else if (runX > 5) result++;
        } else {
          finderPenaltyAddHistory(runX, runHistory, this.size);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * 40;
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, this.size) * 40;
    }

    for (x = 0; x < this.size; x++) {
      var runColorC = false, runY = 0, runHistoryC = [0, 0, 0, 0, 0, 0, 0];
      for (y = 0; y < this.size; y++) {
        if (this.modules[y][x] === runColorC) {
          runY++;
          if (runY === 5) result += 3; else if (runY > 5) result++;
        } else {
          finderPenaltyAddHistory(runY, runHistoryC, this.size);
          if (!runColorC) result += finderPenaltyCountPatterns(runHistoryC) * 40;
          runColorC = this.modules[y][x];
          runY = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColorC, runY, runHistoryC, this.size) * 40;
    }

    for (y = 0; y < this.size - 1; y++) {
      for (x = 0; x < this.size - 1; x++) {
        var color = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1])
          result += 3;
      }
    }

    var dark = 0;
    for (y = 0; y < this.size; y++)
      for (x = 0; x < this.size; x++)
        if (this.modules[y][x]) dark++;
    var total = this.size * this.size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;
    return result;
  };

  QrCode.prototype.getAlignmentPatternPositions = function () {
    if (this.version === 1) return [];
    var numAlign = Math.floor(this.version / 7) + 2;
    var step = Math.floor((this.version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    var result = [6];
    for (var pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  };

  /* ------------------------------------------------- Reed-Solomon / GF */
  function reedSolomonComputeDivisor(degree) {
    if (degree < 1 || degree > 255) throw new RangeError('Degree out of range');
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = reedSolomonMultiply(root, 0x02);
    }
    return result;
  }

  function reedSolomonComputeRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++)
        result[j] ^= reedSolomonMultiply(divisor[j], factor);
    }
    return result;
  }

  function reedSolomonMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function finderPenaltyCountPatterns(runHistory) {
    var n = runHistory[1];
    var core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0)
      + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  }

  function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory, size) {
    if (currentRunColor) {
      finderPenaltyAddHistory(currentRunLength, runHistory, size);
      currentRunLength = 0;
    }
    currentRunLength += size;
    finderPenaltyAddHistory(currentRunLength, runHistory, size);
    return finderPenaltyCountPatterns(runHistory);
  }

  function finderPenaltyAddHistory(currentRunLength, runHistory, size) {
    if (runHistory[0] === 0) currentRunLength += size;
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  }

  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function getNumDataCodewords(ver, ecl) {
    return Math.floor(getNumRawDataModules(ver) / 8)
      - ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  }

  /* -------------------------------------------------- API de alto nivel */
  QrCode.encodeText = function (text, ecl) {
    var segs = QrSegment.makeSegments(text);
    return QrCode.encodeSegments(segs, ecl);
  };

  QrCode.encodeBinary = function (data, ecl) {
    return QrCode.encodeSegments([QrSegment.makeBytes(data)], ecl);
  };

  QrCode.encodeSegments = function (segs, ecl, minVersion, maxVersion, mask, boostEcl) {
    if (minVersion === undefined) minVersion = 1;
    if (maxVersion === undefined) maxVersion = 40;
    if (mask === undefined) mask = -1;
    if (boostEcl === undefined) boostEcl = true;

    var version, dataUsedBits, i;
    for (version = minVersion; ; version++) {
      var dataCapacityBits = getNumDataCodewords(version, ecl) * 8;
      var usedBits = QrSegment.getTotalBits(segs, version);
      if (usedBits <= dataCapacityBits) { dataUsedBits = usedBits; break; }
      if (version >= maxVersion) throw new RangeError('Data too long');
    }

    var levels = [Ecc_MEDIUM, Ecc_QUARTILE, Ecc_HIGH];
    for (i = 0; i < levels.length; i++) {
      if (boostEcl && dataUsedBits <= getNumDataCodewords(version, levels[i]) * 8) ecl = levels[i];
    }

    var bb = [];
    for (i = 0; i < segs.length; i++) {
      appendBits(segs[i].mode.modeBits, 4, bb);
      appendBits(segs[i].numChars, segs[i].mode.numCharCountBits(version), bb);
      var segData = segs[i].getData();
      for (var k = 0; k < segData.length; k++) bb.push(segData[k]);
    }

    var dataCapacityBits2 = getNumDataCodewords(version, ecl) * 8;
    appendBits(0, Math.min(4, dataCapacityBits2 - bb.length), bb);
    appendBits(0, (8 - bb.length % 8) % 8, bb);

    for (var padByte = 0xEC; bb.length < dataCapacityBits2; padByte ^= 0xEC ^ 0x11)
      appendBits(padByte, 8, bb);

    var dataCodewords = [];
    for (i = 0; i * 8 < bb.length; i++) dataCodewords.push(0);
    for (i = 0; i < bb.length; i++)
      dataCodewords[i >>> 3] |= bb[i] << (7 - (i & 7));

    return new QrCode(version, ecl, dataCodewords, mask);
  };

  /* ------------------------------------------------------ Renderizacao */
  function renderToCanvas(qr, canvas, scale, lightColor, darkColor) {
    scale = scale || 4;
    lightColor = lightColor || '#ffffff';
    darkColor = darkColor || '#000000';

    var size = qr.size, border = 4;
    var dim = (size + border * 2) * scale;

    canvas.width = dim;
    canvas.height = dim;
    if (canvas.style) {
      canvas.style.width = dim + 'px';
      canvas.style.height = dim + 'px';
    }

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = darkColor;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (qr.getModule(x, y))
          ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
      }
    }
    return canvas;
  }

  function renderToSvgPath(qr, border) {
    border = (border === undefined) ? 4 : border;
    var parts = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) parts.push('M' + (x + border) + ',' + (y + border) + 'h1v1h-1z');
      }
    }
    return parts.join('');
  }

  /* ------------------------------------------------------- Constantes */
  var Ecc_LOW = new Ecc(0, 1);
  var Ecc_MEDIUM = new Ecc(1, 0);
  var Ecc_QUARTILE = new Ecc(2, 3);
  var Ecc_HIGH = new Ecc(3, 2);

  var ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];

  var NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  /* ------------------------------------------------------------ Export */
  global.QRCodegen = {
    QrCode: QrCode,
    QrSegment: QrSegment,
    Ecc: { LOW: Ecc_LOW, MEDIUM: Ecc_MEDIUM, QUARTILE: Ecc_QUARTILE, HIGH: Ecc_HIGH },
    encodeText: function (text, ecl) { return QrCode.encodeText(text, ecl || Ecc_MEDIUM); },
    encodeBinary: function (data, ecl) { return QrCode.encodeBinary(data, ecl || Ecc_MEDIUM); },
    renderToCanvas: renderToCanvas,
    renderToSvgPath: renderToSvgPath
  };

})(typeof window !== 'undefined' ? window : this);
