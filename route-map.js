(function () {
  if (customElements.get('route-map')) return;
  var D3 = 'https://unpkg.com/d3@7.9.0/dist/d3.min.js';
  var D3H = 'sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i';
  var TJ = 'https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js';
  var TJH = 'sha384-Ukv1p/xTma6P4/2bY5KzWBw+ydSpXmhCMtyciIQVDJ1RmOxtCYNMF1uXT9T63H67';
  var WORLD = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';

  function load(src, integrity, ready) {
    return new Promise(function (res, rej) {
      if (ready()) return res();
      var s = document.querySelector('script[src="' + src + '"]');
      if (!s) {
        s = document.createElement('script');
        s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous';
        document.head.appendChild(s);
      }
      s.addEventListener('load', function () { res(); });
      s.addEventListener('error', function () { rej(new Error('load ' + src)); });
    });
  }
  var worldP = null;
  function world() {
    if (!worldP) {
      worldP = load(D3, D3H, function () { return !!window.d3; })
        .then(function () { return load(TJ, TJH, function () { return !!window.topojson; }); })
        .then(function () { return fetch(WORLD); })
        .then(function (r) { return r.json(); })
        .then(function (t) { return topojson.feature(t, t.objects.land); });
    }
    return worldP;
  }
  var rasterP = null;
  function raster() {
    if (!rasterP) {
      var px = (window.innerWidth || 1000) * (window.devicePixelRatio || 1);
      var sz = px > 1500 ? 2048 : 1280;
      var src = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=BlueMarble_ShadedRelief_Bathymetry&SRS=EPSG:4326&FORMAT=image/jpeg&BBOX=-180,-90,180,90&WIDTH=' + sz + '&HEIGHT=' + (sz / 2);
      rasterP = new Promise(function (res, rej) {
        var im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
        im.onload = function () {
          try { var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
            var x = c.getContext('2d'); x.drawImage(im, 0, 0);
            res({ w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data }); } catch (e) { rej(e); }
        };
        im.onerror = rej; im.src = src;
      });
    }
    return rasterP;
  }
  var l50P = null;
  function land50() {
    if (!l50P) l50P = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json').then(function (r) { return r.json(); }).then(function (t) { return topojson.feature(t, t.objects.land); }).catch(function () { return null; });
    return l50P;
  }
  var hiP = null;
  function worldHi() {
    if (!hiP) {
      var c = navigator.connection;
      if (c && (c.saveData || /2g|3g/.test(c.effectiveType || ''))) return (hiP = Promise.resolve(null));
      var W = Math.max(1280, Math.min(3200, Math.round((window.innerWidth || 1000) * Math.min(window.devicePixelRatio || 1, 2) * 1.1 / 2) * 2));
      if (W <= 1920) return (hiP = Promise.resolve(null));
      hiP = new Promise(function (res) {
        var im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
        im.onload = function () { try { var cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; var x = cv.getContext('2d'); x.drawImage(im, 0, 0); res({ w: cv.width, h: cv.height, d: x.getImageData(0, 0, cv.width, cv.height).data }); } catch (e) { res(null); } };
        im.onerror = function () { res(null); };
        im.src = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=BlueMarble_ShadedRelief_Bathymetry&SRS=EPSG:4326&FORMAT=image/jpeg&BBOX=-180,-90,180,90&WIDTH=' + W + '&HEIGHT=' + (W / 2);
      });
    }
    return hiP;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  class RouteMap extends HTMLElement {
    static get observedAttributes() { return ['stops', 'at', 'mode', 'highlight']; }
    connectedCallback() {
      this.style.display = 'block'; this.style.width = '100%'; this.style.height = '100%'; this.style.position = 'relative';
      // CC BY 4.0 requires the credit to be visible wherever the imagery is
      // shown, to name the licence, and to state that the imagery was changed.
      if (!this._cred) {
        var cr = document.createElement('div');
        cr.style.cssText = 'position:absolute;right:7px;bottom:6px;z-index:6;font:10px/1.4 Archivo,system-ui,sans-serif;color:#5E574E;background:rgba(251,246,238,.78);padding:3px 8px;border-radius:8px;max-width:94%;text-align:right';
        cr.innerHTML = 'Land imagery EOxCloudless by EOX IT Services GmbH, contains modified Copernicus Sentinel data 2016, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#2E5AAC">CC BY 4.0</a>, colour modified. Relief NASA GIBS.';
        this._cred = cr;
        // The home page map is taller than the window, so anchoring the credit
        // to the foot of the element put it below the fold where a visitor
        // never saw it. Keep it against the bottom edge of whatever part of the
        // map is actually on screen.
        var selfC = this, pend = 0;
        var fit = function () {
          pend = 0;
          var r = selfC.getBoundingClientRect();
          if (r.height <= 0) return;
          var hidden = r.bottom - Math.min(r.bottom, window.innerHeight || r.bottom);
          cr.style.bottom = (6 + Math.max(0, hidden)) + 'px';
        };
        this._fit = function () { if (!pend) pend = requestAnimationFrame(fit); };
        addEventListener('scroll', this._fit, { passive: true });
        addEventListener('resize', this._fit, { passive: true });
        this._fit();
      }
      this.appendChild(this._cred);
      if (this._fit) this._fit();
      var self = this;
      if (!this._ro) { this._ro = new ResizeObserver(function () { self.render(); }); this._ro.observe(this); }
      var go = function () {
        raster().then(function (s) { if (!self._src || self._src.w < s.w) { self._src = s; self._cv = null; self.render(); } worldHi().then(function (hs) { if (!hs || (self._src && self._src.w >= hs.w)) return; self._src = hs; self._cv = null; if (self._swapBase) self._swapBase(); else self.render(); }); }).catch(function () {});
        world().then(function (f) { self._f = f; self.render(); }).catch(function () {
          self.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;font:14px Archivo,sans-serif;color:var(--muted)">The map could not load. Every route detail is listed on this page.</div>';
        });
      };
      if (worldP) go();
      else if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 800 });
      else setTimeout(go, 150);
    }
    _paint(proj, w, h, nc, S2) {
      var key = w + ',' + h + ',' + proj.scale().toFixed(3) + ',' + proj.translate().map(function (v) { return v.toFixed(2); }).join(',');
      if (!nc && this._cv && this._cvk === key) return this._cv;
      var S = this._src, sw = S.w, sh = S.h, sd = S.d;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cap = this._hiRes ? 6e6 : 2.6e6; if (this._hiRes) dpr = Math.min(3, dpr * 1.6);
      if (w * h * dpr * dpr > cap) dpr = Math.sqrt(cap / (w * h));
      var W = Math.round(w * dpr), H = Math.round(h * dpr);
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      var ctx = cv.getContext('2d'), im = ctx.createImageData(W, H), od = im.data;
      var cx = proj([0, 0])[0];
      var MA = null;
      var LND = (S2 && S2.land) || this._f;
      if (LND) {
        var pxd = proj.scale() * Math.PI / 180 * dpr, rad = Math.max(2, Math.min(40, 0.35 * pxd)), sc = Math.max(1, rad / 1.5);
        var mw = Math.ceil(W / sc), mh = Math.ceil(H / sc), mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
        var mx = mc.getContext('2d'), mp = d3.geoMercator().scale(proj.scale() * dpr / sc).translate([proj.translate()[0] * dpr / sc, proj.translate()[1] * dpr / sc]);
        mx.fillStyle = '#fff'; var mt = mp.translate(), per = 2 * Math.PI * mp.scale(); for (var rep = -2; rep <= 2; rep++) { mp.translate([mt[0] + rep * per, mt[1]]); mx.beginPath(); d3.geoPath(mp, mx)(LND); mx.fill(); } mp.translate(mt);
        var bc = document.createElement('canvas'); bc.width = W; bc.height = H; var bx = bc.getContext('2d'); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high'; bx.drawImage(mc, 0, 0, W, H);
        MA = bx.getImageData(0, 0, W, H).data;
      }
      var BG = [251, 246, 238];
      for (var y = 0; y < H; y++) {
        var py = (y + 0.5) / dpr, inv = proj.invert([cx, py]), phi = inv ? inv[1] : NaN;
        var row = y * W * 4, ok = isFinite(phi) && Math.abs(phi) <= 90, ey = ok ? Math.max(0, Math.min(1, (86 - phi) / 4, (phi + 64) / 6)) : 0;
        var x0 = 0, k = 1;
        if (ok) { x0 = proj([0, phi])[0]; k = proj([1, phi])[0] - x0; if (!(Math.abs(k) > 1e-6)) ok = false; }
        var gv = (90 - phi) / 180 * (sh - 1), gv0 = Math.floor(gv), gfv = gv - gv0, gv1 = Math.min(gv0 + 1, sh - 1);
        var inH = S2 && phi >= S2.lat0 && phi <= S2.lat1, hv = inH ? (S2.lat1 - phi) / (S2.lat1 - S2.lat0) * (S2.h - 1) : 0, hv0 = Math.floor(hv), hfv = hv - hv0, hv1 = inH ? Math.min(hv0 + 1, S2.h - 1) : 0;
        for (var x = 0; x < W; x++) {
          var o4 = row + x * 4, lam = ok ? ((x + 0.5) / dpr - x0) / k : 999;
          if (ok) lam = ((lam + 180) % 360 + 360) % 360 - 180;
          if (!ok) { od[o4] = BG[0]; od[o4 + 1] = BG[1]; od[o4 + 2] = BG[2]; od[o4 + 3] = 255; continue; }
          var cw, cd, v0, v1, fv, u, hi = false;
          var lamH = (inH && S2.lon1 > 180 && lam < S2.lon0) ? lam + 360 : lam;
          if (inH && lamH >= S2.lon0 && lamH <= S2.lon1) { cw = S2.w; cd = S2.d; v0 = hv0; v1 = hv1; fv = hfv; u = (lamH - S2.lon0) / (S2.lon1 - S2.lon0) * (cw - 1); hi = true; }
          else { cw = sw; cd = sd; v0 = gv0; v1 = gv1; fv = gfv; u = (lam + 180) / 360 * (sw - 1); }
          var u0 = Math.floor(u), fu = u - u0, u1 = Math.min(u0 + 1, cw - 1);
          var i00 = (v0 * cw + u0) * 4, i10 = (v0 * cw + u1) * 4, i01 = (v1 * cw + u0) * 4, i11 = (v1 * cw + u1) * 4;
          var w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
          var r = (cd[i00] * w00 + cd[i10] * w10 + cd[i01] * w01 + cd[i11] * w11) / 255;
          var g = (cd[i00 + 1] * w00 + cd[i10 + 1] * w10 + cd[i01 + 1] * w01 + cd[i11 + 1] * w11) / 255;
          var b = (cd[i00 + 2] * w00 + cd[i10 + 2] * w10 + cd[i01 + 2] * w01 + cd[i11 + 2] * w11) / 255;
          var L = 0.3 * r + 0.55 * g + 0.15 * b;
          // Land colour comes from the Sentinel-2 tile where one is loaded.
          // That imagery is darker than the relief layer, so it is lifted to
          // sit in the same tonal range before the brand grading runs.
          var rl = r, gl = g, bl = b, Ll = L, wet = 0;
          if (hi && S2.dl) {
            var q = S2.dl, GN = 1.32;
            rl = Math.min(1, (q[i00] * w00 + q[i10] * w10 + q[i01] * w01 + q[i11] * w11) / 255 * GN);
            gl = Math.min(1, (q[i00 + 1] * w00 + q[i10 + 1] * w10 + q[i01 + 1] * w01 + q[i11 + 1] * w11) / 255 * GN);
            bl = Math.min(1, (q[i00 + 2] * w00 + q[i10 + 2] * w10 + q[i01 + 2] * w01 + q[i11 + 2] * w11) / 255 * GN);
            Ll = 0.3 * rl + 0.55 * gl + 0.15 * bl;
            // Lakes and rivers lie inside the land outline but read almost black
            // in this imagery, so without this they came out as dark ground.
            // Water is dark and blue leaning, woodland is dark and green
            // leaning, and that is what separates the two here.
            var dk = (0.26 - Ll) / 0.12, bu = (bl - gl) * 14 - 0.1;
            wet = (dk < 0 ? 0 : dk > 1 ? 1 : dk) * (bu < 0 ? 0 : bu > 1 ? 1 : bu);
          }
          var A = MA ? MA[o4 + 3] / 255 : 0.5, dm = Math.max(r, g) - b, m;
          if (A < 0.12) m = 0; else if (A > 0.88) m = 1; else { m = 12 * dm + 0.15; m = m < 0 ? 0 : m > 1 ? 1 : m; }
          var m0 = m; if (wet) m *= 1 - wet;
          var t = Math.min(1, Ll * 1.3), lr, lg, lb, f;
          if (t < 0.4) { f = t / 0.4; lr = 0.235 + 0.25 * f; lg = 0.18 + 0.21 * f; lb = 0.145 + 0.165 * f; }
          else if (t < 0.75) { f = (t - 0.4) / 0.35; lr = 0.485 + 0.27 * f; lg = 0.39 + 0.285 * f; lb = 0.31 + 0.26 * f; }
          else { f = (t - 0.75) / 0.25; lr = 0.755 + 0.2 * f; lg = 0.675 + 0.247 * f; lb = 0.57 + 0.293 * f; }
          var sat = (hi && S2.dl) ? 0.15 : 0.32, gw = (hi && S2.dl) ? 0.05 : 0.12;
          var gp = Math.max(0, gl - rl) * gw; lr += sat * (rl - Ll) - gp * 0.2 + 0.012; lg += sat * (gl - Ll) + gp; lb += sat * (bl - Ll) - gp * 0.4 - 0.012;
          var ld = (L - 0.1) / 0.45; ld = ld < 0 ? 0 : ld > 1 ? 1 : Math.pow(ld, 0.8); var sr = 0.76 + 0.19 * ld + 0.3 * (r - L), sg = 0.81 + 0.135 * ld + 0.3 * (g - L), sb = 0.835 + 0.065 * ld + 0.3 * (b - L);
          // A lake's water colour cannot come from the relief layer, which shows
          // dry ground at that spot, so it would render pale grey. Lakes take a
          // fixed water colour instead, matching the sea.
          // Only inside the coastline. The open sea reads dark blue in this
          // imagery too, so applying this everywhere flattened the ocean to one
          // tone and threw away the seafloor shading.
          var wf = wet * m0;
          if (wf) { sr += (0.70 - sr) * wf; sg += (0.77 - sg) * wf; sb += (0.845 - sb) * wf; }
          var e = ey; var cr = sr + (lr - sr) * m, cg = sg + (lg - sg) * m, cb = sb + (lb - sb) * m;
          od[o4] = 255 * cr * e + BG[0] * (1 - e); od[o4 + 1] = 255 * cg * e + BG[1] * (1 - e); od[o4 + 2] = 255 * cb * e + BG[2] * (1 - e); od[o4 + 3] = 255;
        }
      }
      ctx.putImageData(im, 0, 0);
      if (!nc) { this._cv = cv; this._cvk = key; }
      return cv;
    }
    _hiFetch(p2, w, h) {
      var c = navigator.connection;
      if (c && (c.saveData || /2g|3g/.test(c.effectiveType || ''))) return Promise.resolve(null);
      var lo = [], la = [];
      for (var i = 0; i <= 24; i++) { var f = i / 24; [[f * w, 0], [f * w, h], [0, f * h], [w, f * h], [f * w, h / 2], [w / 2, f * h]].forEach(function (pt) { var q = p2.invert(pt); if (q && isFinite(q[0]) && isFinite(q[1]) && Math.abs(q[1]) <= 90) { lo.push(q[0]); la.push(q[1]); } }); }
      if (lo.length < 4) return Promise.resolve(null);
      // A view over the Pacific straddles the antimeridian, where longitude jumps
      // from 180 to -180. Measured in the plain frame that reads as a span of
      // nearly the whole globe, so the old code gave up and left the blurry base
      // image behind. New Zealand and Fiji sit exactly there.
      //
      // So measure both frames and keep the narrower one. The shifted frame runs
      // past 180, which is what lets a Pacific view be described at all.
      var rawMin = Math.min.apply(null, lo), rawMax = Math.max.apply(null, lo);
      var shifted = lo.map(function (v) { return v < 0 ? v + 360 : v; });
      var shMin = Math.min.apply(null, shifted), shMax = Math.max.apply(null, shifted);
      var wrap = (shMax - shMin) < (rawMax - rawMin);
      var lon0 = wrap ? Math.floor(shMin - 1) : Math.max(-180, Math.floor(rawMin - 1));
      var lon1 = wrap ? Math.ceil(shMax + 1) : Math.min(180, Math.ceil(rawMax + 1));
      var lat0 = Math.max(-90, Math.floor(Math.min.apply(null, la) - 1)), lat1 = Math.min(90, Math.ceil(Math.max.apply(null, la) + 1));
      if (lon1 - lon0 > 200) return Promise.resolve(null);
      var PW = Math.round(w * Math.min(window.devicePixelRatio || 1, 3)), PH = Math.round(PW * (lat1 - lat0) / (lon1 - lon0));
      var mx = Math.max(PW, PH); if (mx > 2400) { PW = Math.round(PW * 2400 / mx); PH = Math.round(PH * 2400 / mx); }
      var key = [lon0, lat0, lon1, lat1, PW].join(',');
      this._hiCache = this._hiCache || {};
      if (this._hiCache[key]) return this._hiCache[key];

      // The imagery service cannot serve a box that crosses 180, so a wrapped
      // frame is fetched as two boxes and stitched side by side into one tile.
      // Two sources, because neither one alone is right. The relief layer is the
      // only one that carries the seafloor, and Sentinel-2 cannot see underwater
      // at all: over open ocean it reads almost black. So the sea keeps the
      // relief layer and only the land is raised to Sentinel-2 detail.
      var SEA = function (a, b, wpx) { return 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=BlueMarble_ShadedRelief_Bathymetry&SRS=EPSG:4326&FORMAT=image/jpeg&BBOX=' + [a, lat0, b, lat1].join(',') + '&WIDTH=' + wpx + '&HEIGHT=' + PH; };
      // Proxied through this site so visitors never hit the imagery service
      // directly and the responses can be cached at our own edge.
      var LAND = function (a, b, wpx) { return '/sat?service=WMS&version=1.1.1&request=GetMap&layers=s2cloudless&srs=EPSG:4326&format=image/jpeg&bbox=' + [a, lat0, b, lat1].join(',') + '&width=' + wpx + '&height=' + PH; };
      var grab = function (url) {
        return new Promise(function (res) {
          var im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
          im.onload = function () { res(im); }; im.onerror = function () { res(null); };
          im.src = url;
        });
      };
      var layer = function (mk) {
        var parts;
        if (lon1 > 180) {
          var leftDeg = 180 - lon0, span = lon1 - lon0;
          var lw = Math.max(1, Math.round(PW * leftDeg / span)), rw = Math.max(1, PW - lw);
          parts = Promise.all([grab(mk(lon0, 180, lw)), grab(mk(-180, lon1 - 360, rw))]).then(function (ims) {
            return (ims[0] && ims[1]) ? { ims: ims, widths: [lw, rw] } : null;
          });
        } else {
          parts = grab(mk(lon0, lon1, PW)).then(function (im) { return im ? { ims: [im], widths: [PW] } : null; });
        }
        return parts.then(function (got) {
          if (!got) return null;
          try {
            var totalW = got.widths.reduce(function (a, b) { return a + b; }, 0);
            var cv = document.createElement('canvas'); cv.width = totalW; cv.height = got.ims[0].naturalHeight;
            var x = cv.getContext('2d'), at = 0;
            for (var i = 0; i < got.ims.length; i++) { x.drawImage(got.ims[i], at, 0, got.widths[i], cv.height); at += got.widths[i]; }
            return { w: cv.width, h: cv.height, d: x.getImageData(0, 0, cv.width, cv.height).data };
          } catch (e) { return null; }
        });
      };
      // A missing land tile is survivable: the map falls back to relief alone.
      var pr = Promise.all([layer(SEA), layer(LAND)]).then(function (v) {
        var sea = v[0], land = v[1];
        if (!sea) return null;
        var dl = (land && land.w === sea.w && land.h === sea.h) ? land.d : null;
        return { w: sea.w, h: sea.h, d: sea.d, dl: dl, lon0: lon0, lon1: lon1, lat0: lat0, lat1: lat1 };
      });
      var keys = Object.keys(this._hiCache); if (keys.length > 6) delete this._hiCache[keys[0]];
      pr = Promise.all([pr, land50()]).then(function (v) { if (v[0]) v[0].land = v[1]; return v[0]; });
      this._hiCache[key] = pr;
      return pr;
    }
    _idle(proj, w, h, reduce, landD) {
      var self = this, alive = true, timers = [], raf = 0;
      var PAIRS = [
        { a: [-74,40.7], b: [3.4,6.5], from: 'United States', to: 'Nigeria', item: 'Limited release sneakers' },
        { a: [-0.1,51.5], b: [36.8,-1.3], from: 'United Kingdom', to: 'Kenya', item: 'Premier League home kit' },
        { a: [127,37.6], b: [-46.6,-23.5], from: 'South Korea', to: 'Brazil', item: 'K-pop album with photocards' },
        { a: [139.7,35.7], b: [121,14.6], from: 'Japan', to: 'Philippines', item: 'Anime figure' },
        { a: [13.4,52.5], b: [74.3,31.5], from: 'Germany', to: 'Pakistan', item: 'Camera lens' },
        { a: [2.35,48.85], b: [-7.6,33.6], from: 'France', to: 'Morocco', item: 'Designer handbag' },
        { a: [12.5,41.9], b: [31.2,30], from: 'Italy', to: 'Egypt', item: 'Leather loafers' },
        { a: [-79.4,43.7], b: [-76.8,18], from: 'Canada', to: 'Jamaica', item: 'Hockey jersey' },
        { a: [151.2,-33.9], b: [106.8,-6.2], from: 'Australia', to: 'Indonesia', item: 'Sheepskin boots' },
        { a: [121.5,25], b: [100.5,13.8], from: 'Taiwan', to: 'Thailand', item: 'Graphics card' },
        { a: [18.1,59.3], b: [28,-26.2], from: 'Sweden', to: 'South Africa', item: 'Kids rain suit' },
        { a: [55.3,25.2], b: [77.2,28.6], from: 'United Arab Emirates', to: 'India', item: 'Unlocked smartphone' },
        { a: [-99.1,19.4], b: [-74.1,4.7], from: 'Mexico', to: 'Colombia', item: 'Lucha libre mask' },
        { a: [8.5,47.4], b: [44.4,40.2], from: 'Switzerland', to: 'Armenia', item: 'Mechanical wristwatch' },
        { a: [-3.7,40.4], b: [-58.4,-34.6], from: 'Spain', to: 'Argentina', item: 'Football boots' },
        { a: [103.8,1.35], b: [105.8,21], from: 'Singapore', to: 'Vietnam', item: 'Wireless earbuds' },
        { a: [-6.3,53.35], b: [39.3,-6.8], from: 'Ireland', to: 'Tanzania', item: 'Aran knit sweater' },
        { a: [174.8,-36.8], b: [178.4,-18.1], from: 'New Zealand', to: 'Fiji', item: 'Rugby boots' },
        { a: [21,52.2], b: [71.4,51.2], from: 'Poland', to: 'Kazakhstan', item: 'Strategy board game' },
        { a: [29,41], b: [69.2,41.3], from: 'Turkey', to: 'Uzbekistan', item: 'Kilim cushion covers' },
        { a: [114.2,22.3], b: [3,36.75], from: 'Hong Kong', to: 'Algeria', item: 'Retro game console' },
        { a: [-70.65,-33.45], b: [-68.15,-16.5], from: 'Chile', to: 'Bolivia', item: 'Climbing harness' },
        { a: [4.9,52.4], b: [-0.2,5.6], from: 'Netherlands', to: 'Ghana', item: 'Wax print fabric' },
        { a: [72.8,19.1], b: [-61.5,10.65], from: 'India', to: 'Trinidad and Tobago', item: 'Bridal lehenga' },
        { a: [12.6,55.7], b: [85.3,27.7], from: 'Denmark', to: 'Nepal', item: 'Building brick set' },
        { a: [4.35,50.85], b: [11.5,3.85], from: 'Belgium', to: 'Cameroon', item: 'Comic book box set' },
        { a: [-9.1,38.7], b: [13.2,-8.8], from: 'Portugal', to: 'Angola', item: 'National team jersey' },
        { a: [10.75,59.9], b: [-77,-12], from: 'Norway', to: 'Peru', item: 'Merino base layers' },
        { a: [14.4,50.1], b: [44.8,41.7], from: 'Czech Republic', to: 'Georgia', item: 'Crystal glassware' },
        { a: [101.7,3.1], b: [79.9,6.9], from: 'Malaysia', to: 'Sri Lanka', item: 'Batik shirt' },
        { a: [16.4,48.2], b: [49.9,40.4], from: 'Austria', to: 'Azerbaijan', item: 'Violin strings' },
        { a: [24.9,60.2], b: [106.9,47.9], from: 'Finland', to: 'Mongolia', item: 'Kids winter overalls' },
        { a: [23.7,38], b: [28.3,-15.4], from: 'Greece', to: 'Zambia', item: 'Leather sandals' }
      ];
      for (var si = PAIRS.length - 1; si > 0; si--) { var sj = Math.floor(Math.random() * (si + 1)), st = PAIRS[si]; PAIRS[si] = PAIRS[sj]; PAIRS[sj] = st; }
      var idx = this._idleIdx || 0, sharp = null, tok = 0;
      this._hiRes = true;
      this.innerHTML = '<div style="position:absolute;inset:0;overflow:hidden"><div data-w style="position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;transform-origin:0 0;will-change:transform"></div><svg data-o width="' + w + '" height="' + h + '" style="position:absolute;inset:0;display:block;overflow:visible"></svg></div>';
      var wrap = this.querySelector('[data-w]'), ov = this.querySelector('[data-o]');
      if (this._src) wrap.appendChild(this._paint(proj, w, h));
      else wrap.innerHTML = '<svg width="' + w + '" height="' + h + '" style="display:block"><rect width="' + w + '" height="' + h + '" style="fill:#FBF6EE"></rect><path d="' + landD + '" style="fill:#B8A685"></path><path d="' + landD + '" transform="translate(' + (2 * Math.PI * proj.scale()) + ',0)" style="fill:#B8A685"></path><path d="' + landD + '" transform="translate(' + (-2 * Math.PI * proj.scale()) + ',0)" style="fill:#B8A685"></path></svg>';
      this._swapBase = function () { if (!alive) return; self._hiRes = true; var nc = self._paint(proj, w, h); self._hiRes = false; wrap.innerHTML = ''; wrap.appendChild(nc); };
      this._hiRes = false;
      var K = 1, TX = 0, TY = 0;
      var setT = function () { wrap.style.transform = 'translate(' + TX.toFixed(2) + 'px,' + TY.toFixed(2) + 'px) scale(' + K.toFixed(4) + ')'; };
      var later = function (fn, ms) { var id = setTimeout(function () { if (alive) fn(); }, ms); timers.push(id); };
      var ease = function (x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
      var NS = 'http://www.w3.org/2000/svg';
      var el = function (tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
      var defs = '<defs><filter id="ish" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#2B211B" flood-opacity=".22"></feDropShadow></filter></defs>';
      var pin = function (p, icon) {
        var g = el('g', { transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')' }, ov), inner = el('g', {}, g);
        el('circle', { r: 17, fill: '#FBF6EE', filter: 'url(#ish)' }, inner);
        el('path', { d: icon === 'store' ? 'M-7 -3 L-6 -8 H6 L7 -3 M-7 -3 H7 M-6 -3 V7 H6 V-3 M-2 7 V2 H2 V7' : 'M-7.5 -1 L0 -8 L7.5 -1 M-5.5 -2.5 V7 H5.5 V-2.5 M-1.8 7 V2.5 H1.8 V7', fill: 'none', stroke: '#2B211B', 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, inner);
        if (!reduce) inner.animate([{ transform: 'translateY(-26px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 560, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'both' });
        return g;
      };
      var chip = function (p, label, sub, other) {
        var tw = Math.max(label.length * 7.4, sub.length * 6) + 26, sx = other[0] > p[0] ? -0.35 : 0.35;
        var x = Math.min(Math.max(p[0] - tw / 2 + sx * tw, 8), w - tw - 8), y = other[1] > p[1] + 24 ? p[1] - 64 : p[1] + 24; y = Math.min(Math.max(y, 8), h - 48);
        var g = el('g', {}, ov);
        el('rect', { x: x, y: y, width: tw, height: 40, rx: 10, fill: '#FBF6EE', filter: 'url(#ish)' }, g);
        var t1 = el('text', { x: x + tw / 2, y: y + 17, 'text-anchor': 'middle', style: 'font:600 13px Archivo,system-ui,sans-serif;fill:#2B211B' }, g); t1.textContent = label;
        var t2 = el('text', { x: x + tw / 2, y: y + 31, 'text-anchor': 'middle', style: 'font:500 10px ui-monospace,Menlo,monospace;letter-spacing:.08em;fill:#5E574E' }, g); t2.textContent = sub;
        if (!reduce) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, fill: 'both' });
      };
      var card = function (P0) {
        var g = el('g', {}, ov), tw = Math.max(P0.item.length * 8.6, (P0.from + ' to ' + P0.to).length * 6.9) + 32;
        el('rect', { x: 16, y: 16, width: tw, height: 66, rx: 12, fill: '#FBF6EE', filter: 'url(#ish)' }, g);
        var a1 = el('text', { x: 32, y: 36, style: 'font:500 10px ui-monospace,Menlo,monospace;letter-spacing:.1em;fill:#2E5AAC' }, g); a1.textContent = 'EXAMPLE ORDER';
        var a2 = el('text', { x: 32, y: 56, style: 'font:700 16px Archivo,system-ui,sans-serif;fill:#2B211B' }, g); a2.textContent = P0.item;
        var a3 = el('text', { x: 32, y: 72, style: 'font:500 12px Archivo,system-ui,sans-serif;fill:#5E574E' }, g); a3.textContent = P0.from + ' to ' + P0.to;
        if (!reduce) g.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 400, fill: 'both' });
      };
      var tgt = function (P0) {
        var pa = proj(P0.a), pb = proj(P0.b);
        var dx = pb[0] - pa[0], dy = pb[1] - pa[1], dist = Math.sqrt(dx * dx + dy * dy), lift = dist * 0.28;
        var minX = Math.min(pa[0], pb[0]), maxX = Math.max(pa[0], pb[0]), minY = Math.min(pa[1], pb[1], (pa[1] + pb[1]) / 2 - dist * 0.14), maxY = Math.max(pa[1], pb[1]);
        var k = Math.max(1, Math.min((w - 180) / Math.max(maxX - minX, 1), (h - 130) / Math.max(maxY - minY, 1), 6));
        var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        var tx = Math.min(0, Math.max(w - k * w, w / 2 - k * cx)), ty = Math.min(0, Math.max(h - k * h, h / 2 - k * cy));
        return { pa: pa, pb: pb, k: k, tx: tx, ty: ty };
      };
      var pfor = function (T) { return d3.geoMercator().scale(proj.scale() * T.k).translate([proj.translate()[0] * T.k + T.tx, proj.translate()[1] * T.k + T.ty]); };
      var scene = function () {
        if (!alive) return;
        tok++;
        var P0 = PAIRS[idx % PAIRS.length]; idx++; self._idleIdx = idx;
        var T0 = tgt(P0), pa = T0.pa, pb = T0.pb, k = T0.k, tx = T0.tx, ty = T0.ty, myTok = tok;
        var k0 = K, x0 = TX, y0 = TY, t0 = performance.now(), dur = reduce ? 0 : 680;
        var hp = self._src && k > 1.25 ? self._hiFetch(pfor(T0), w, h) : null;
        [0].forEach(function (o) { var NT = tgt(PAIRS[(idx + o) % PAIRS.length]); if (self._src && NT.k > 1.25) self._hiFetch(pfor(NT), w, h); });
        ov.innerHTML = defs;
        if (sharp) { var old = sharp; sharp = null; old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).onfinish = function () { old.remove(); }; }
        var step = function (now) {
          if (!alive) return;
          var f = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(f);
          K = k0 + (k - k0) * e; TX = x0 + (tx - x0) * e; TY = y0 + (ty - y0) * e; setT();
          if (f < 1) raf = requestAnimationFrame(step); else play();
        };
        var play = function () {
          var S = function (p) { return [p[0] * K + TX, p[1] * K + TY]; };
          var sa = S(pa), sb = S(pb), ddx = sb[0] - sa[0], ddy = sb[1] - sa[1], dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          var c = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2 - dd * 0.28];
          var d = 'M' + sa[0].toFixed(1) + ' ' + sa[1].toFixed(1) + ' Q' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + ' ' + sb[0].toFixed(1) + ' ' + sb[1].toFixed(1);
          if (self._src) {
            var p2 = d3.geoMercator().scale(proj.scale() * K).translate([proj.translate()[0] * K + TX, proj.translate()[1] * K + TY]);
            sharp = self._paint(p2, w, h, true); sharp.style.opacity = 0; ov.parentNode.insertBefore(sharp, ov);
            sharp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, fill: 'forwards' });
            if (K > 1.25) { var my = tok; self._hiFetch(p2, w, h).then(function (S2) {
              if (!alive || my !== tok || !S2) return;
              var c2 = self._paint(p2, w, h, true, S2), prev = sharp; c2.style.opacity = 0; ov.parentNode.insertBefore(c2, ov); sharp = c2;
              c2.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, fill: 'forwards' }).onfinish = function () { if (prev && prev !== sharp) prev.remove(); };
            }); }
          }
          card(P0);
          later(function () { pin(sa, 'store'); chip(sa, P0.from, 'ORDERED FROM', sb); }, 250);
          later(function () { pin(sb, 'home'); chip(sb, P0.to, 'DELIVERED TO', sa); }, 850);
          later(function () {
            var under = el('path', { d: d, fill: 'none', stroke: '#FBF6EE', 'stroke-width': 9, 'stroke-linecap': 'round' }), line = el('path', { d: d, fill: 'none', stroke: '#2E5AAC', 'stroke-width': 4.5, 'stroke-linecap': 'round' });
            ov.insertBefore(line, ov.querySelector('g')); ov.insertBefore(under, line);
            var L = line.getTotalLength();
            [under, line].forEach(function (p) { p.style.strokeDasharray = L + ' ' + L; p.style.strokeDashoffset = reduce ? 0 : L; if (!reduce) p.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 1300, easing: 'cubic-bezier(.6,0,.3,1)', fill: 'forwards' }); });
            later(function () {
              var bx = el('g', {}, ov), bi = el('g', {}, bx);
              bi.setAttribute('filter', 'url(#ish)'); var bb = el('g', { transform: 'translate(-19.3,-16) scale(.42)' }, bi); bb.innerHTML = '<path d="M10 22 L18 14 H82 L74 22 Z" fill="#DDBF94"></path><path d="M74 22 L82 14 V54 L74 62 Z" fill="#B08A5B"></path><rect x="10" y="22" width="64" height="40" fill="#C9A274"></rect><rect x="38" y="22" width="8" height="40" fill="#2E5AAC"></rect><path d="M38 22 L46 14 H54 L46 22 Z" fill="#4C74BF"></path><rect x="52" y="44" width="16" height="11" rx="1" fill="#F4EBDC"></rect><path d="M55 48 H65" fill="none" stroke="#2B211B" stroke-width="1.2"></path><path d="M55 51.5 H62" fill="none" stroke="#2B211B" stroke-width="1"></path>';
              var s0 = performance.now(), D = reduce ? 0 : 2200;
              var mv = function (now) { if (!alive) return; var f = D ? Math.min(1, (now - s0) / D) : 0.5, q = line.getPointAtLength(L * ease(f)); bx.setAttribute('transform', 'translate(' + q.x.toFixed(1) + ',' + q.y.toFixed(1) + ')'); if (f < 1) raf = requestAnimationFrame(mv); };
              raf = requestAnimationFrame(mv);
            }, reduce ? 0 : 1300);
          }, 1350);
          if (!reduce) later(function () { ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).onfinish = function () { if (!alive) return; ov.getAnimations().forEach(function (a) { a.cancel(); }); scene(); }; }, 6600);
        };
        raf = requestAnimationFrame(step);
      };
      setT();
      if (this._held) scene(); else { this._held = true; if (this._src) { var F0 = tgt(PAIRS[idx % PAIRS.length]); if (F0.k > 1.25) this._hiFetch(pfor(F0), w, h); } later(scene, reduce ? 0 : 3500); }
      this._stop = function () { alive = false; self._swapBase = null; timers.forEach(clearTimeout); cancelAnimationFrame(raf); self._stop = null; };
    }
    disconnectedCallback() {
      if (this._stop) this._stop(); this._idleKey = null; if (this._ro) { this._ro.disconnect(); this._ro = null; } }
    attributeChangedCallback() { this.render(); }
    render() {
      if (!this._f || !window.d3) return;
      var w = this.clientWidth, h = this.clientHeight;
      if (w < 10 || h < 10) return;
      var stops = [];
      try { stops = JSON.parse(this.getAttribute('stops') || '[]'); } catch (e) { stops = []; }
      if (stops.length < 1) return;
      var mode = this.getAttribute('mode') || 'progress';
      var key = mode + '|' + this.getAttribute('stops');
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var anim = !reduce && key !== this._key;
      this._key = key;
      if (!this._uid) this._uid = 'rm' + Math.random().toString(36).slice(2, 8);
      var U = this._uid;
      var legs = stops.length - 1;
      var at = (this.getAttribute('at') || '0:0').split(':');
      var leg = Number(at[0]) || 0, t = Number(at[1]) || 0;
      if (leg >= legs) { leg = legs - 1; t = 1; }
      var pt = function (s) { return [s.lon, s.lat]; };
      var proj;
      if (mode === 'idle') {
        proj = d3.geoMercator().fitExtent([[0, 0], [w, h]], { type: 'MultiPoint', coordinates: [[-180, 82], [180, -58]] });
      } else {
        var lon = stops.map(function (s) { return s.lon; }), lat = stops.map(function (s) { return s.lat; });
        var padX = Math.max(70, w * 0.15), padTop = Math.max(110, h * 0.3), padBot = Math.max(70, h * 0.16);
        proj = d3.geoMercator().fitExtent([[padX, padTop], [w - padX, h - padBot]], { type: 'MultiPoint', coordinates: stops.map(pt) });
      }
      var path = d3.geoPath(proj);
      var P = function (g) { return path(g) || ''; };
      if (mode === 'idle') {
        var ik = w + 'x' + h + '|' + (this._src ? 1 : 0);
        if (this._idleKey === ik && this._stop) return;
        if (this._stop) this._stop();
        this._idleKey = ik;
        this._idle(proj, w, h, reduce, P(this._f));
        // The animated map clears the element as it sets up, so the licence
        // credit has to go back afterwards here too. Without this the credit was
        // absent from the home page, which is where the map is seen most.
        if (this._cred) { this.appendChild(this._cred); if (this._fit) this._fit(); }
        return;
      }
      if (this._stop) { this._stop(); this._stop = null; this._idleKey = null; }
      var draw = anim ? 1.3 : 0;
      var arc = function (p, q, lift) {
        var dx = q[0] - p[0], dy = q[1] - p[1], dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - dist * (lift == null ? 0.28 : lift)];
        return { d: 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' Q' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + ' ' + q[0].toFixed(1) + ' ' + q[1].toFixed(1), c: c,
          at: function (k) { var m = 1 - k; return [m * m * p[0] + 2 * m * k * c[0] + k * k * q[0], m * m * p[1] + 2 * m * k * c[1] + k * k * q[1]]; } };
      };
      var split = function (A, k) {
        var p = A.at(0), c = A.c, q = A.at(1);
        var c1 = [p[0] + (c[0] - p[0]) * k, p[1] + (c[1] - p[1]) * k], m = A.at(k);
        var c2 = [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k];
        return { a: 'M' + p[0] + ' ' + p[1] + ' Q' + c1[0] + ' ' + c1[1] + ' ' + m[0] + ' ' + m[1], b: 'M' + m[0] + ' ' + m[1] + ' Q' + c2[0] + ' ' + c2[1] + ' ' + q[0] + ' ' + q[1] };
      };

      var o = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block" role="img" aria-label="Route map">';
      o += '<defs><filter id="' + U + 'sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity=".4"></feDropShadow></filter>' +
        '<filter id="' + U + 'ls" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity=".45"></feDropShadow></filter>';
      var raster = this._src;
      var land = P(this._f);
      o += '</defs>';
      if (!raster) {
        o += '<rect width="' + w + '" height="' + h + '" style="fill:#FBF6EE"></rect>';
        o += '<path d="' + land + '" style="fill:#B8A685"></path>';
      }
      

      var badge = function (p, icon, delay) {
        var g = '<g transform="translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')"' + (delay ? ' opacity="0"' : '') + '>' + (delay ? '<set attributeName="opacity" to="1" begin="' + delay + 's"></set>' : '');
        g += '<circle r="17" style="fill:#FBF6EE" filter="url(#' + U + 'sh)"></circle>';
        if (icon === 'store') g += '<path d="M-7 -3 L-6 -8 H6 L7 -3 M-7 -3 H7 M-6 -3 V7 H6 V-3 M-2 7 V2 H2 V7" style="fill:none;stroke:#2B211B;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round"></path>';
        else if (icon === 'home') g += '<path d="M-7.5 -1 L0 -8 L7.5 -1 M-5.5 -2.5 V7 H5.5 V-2.5 M-1.8 7 V2.5 H1.8 V7" style="fill:none;stroke:#2B211B;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round"></path>';
        else g += '<circle r="4" style="fill:#2B211B"></circle>';
        return g + '</g>';
      };
      var box = function () {
        return '<g filter="url(#' + U + 'sh)" transform="translate(-19.3,-16) scale(.42)"><path d="M10 22 L18 14 H82 L74 22 Z" fill="#DDBF94"></path><path d="M74 22 L82 14 V54 L74 62 Z" fill="#B08A5B"></path><rect x="10" y="22" width="64" height="40" fill="#C9A274"></rect><rect x="38" y="22" width="8" height="40" fill="#2E5AAC"></rect><path d="M38 22 L46 14 H54 L46 22 Z" fill="#4C74BF"></path><rect x="52" y="44" width="16" height="11" rx="1" fill="#F4EBDC"></rect><path d="M55 48 H65" fill="none" stroke="#2B211B" stroke-width="1.2"></path><path d="M55 51.5 H62" fill="none" stroke="#2B211B" stroke-width="1"></path></g>';
      };
      var chip = function (p, label, below, delay) {
        var tw = label.length * 6.9 + 22, x = Math.min(Math.max(p[0] - tw / 2, 6), w - tw - 6), y = below ? p[1] + 24 : p[1] - 52;
        var s = '<g' + (delay ? ' opacity="0"' : '') + '>' + (delay ? '<set attributeName="opacity" to="1" begin="' + delay + 's"></set>' : '');
        s += '<rect x="' + x + '" y="' + y + '" width="' + tw + '" height="26" rx="13" style="fill:#FBF6EE" filter="url(#' + U + 'sh)"></rect>';
        s += '<text x="' + (x + tw / 2) + '" y="' + (y + 17.5) + '" text-anchor="middle" style="font:600 12.5px Archivo,system-ui,sans-serif;fill:#2B211B">' + esc(label) + '</text></g>';
        return s;
      };
      var solid = function (d, id, animate) {
        var s = '<path d="' + d + '" style="fill:none;stroke:#FBF6EE;stroke-width:9;stroke-linecap:round;opacity:.95"' + (animate ? ' pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"' : '') + '>' + (animate ? '<animate attributeName="stroke-dashoffset" from="1" to="0" dur="' + draw + 's" calcMode="spline" keyTimes="0;1" keySplines=".6 0 .3 1" fill="freeze"></animate>' : '') + '</path>';
        s += '<path' + (id ? ' id="' + id + '"' : '') + ' d="' + d + '" filter="url(#' + U + 'ls)" style="fill:none;stroke:#2E5AAC;stroke-width:5;stroke-linecap:round"' + (animate ? ' pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"' : '') + '>' + (animate ? '<animate attributeName="stroke-dashoffset" from="1" to="0" dur="' + draw + 's" calcMode="spline" keyTimes="0;1" keySplines=".6 0 .3 1" fill="freeze"></animate>' : '') + '</path>';
        return s;
      };
      var faint = function (d) { return '<path d="' + d + '" style="fill:none;stroke:#2B211B;stroke-width:3;stroke-linecap:round;stroke-dasharray:2 8;opacity:.5"></path>'; };

      if (mode === 'idle') {
      } else if (mode === 'found' || mode === 'none') {
        var pa = proj(pt(stops[0])), pb = proj(pt(stops[stops.length - 1]));
        var A0 = arc(pa, pb);
        if (mode === 'found') {
          o += solid(A0.d, U + 'r', anim);
          if (!reduce) o += '<g opacity="0"><set attributeName="opacity" to="1" begin="' + (draw + 0.15) + 's"></set>' + box() + '<animateMotion dur="3.8s" begin="' + (draw + 0.15) + 's" repeatCount="indefinite" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines=".45 0 .55 1"><mpath href="#' + U + 'r"></mpath></animateMotion></g>';
          else { var m0 = A0.at(0.5); o += '<g transform="translate(' + m0[0] + ',' + m0[1] + ')">' + box() + '</g>'; }
        } else {
          o += '<path d="' + A0.d + '" style="fill:none;stroke:#2B211B;stroke-width:3;stroke-linecap:round;stroke-dasharray:1 9;opacity:.5"></path>';
          var mm = A0.at(0.5);
          o += '<g transform="translate(' + mm[0] + ',' + mm[1] + ')"><circle r="15" style="fill:#FBF6EE" filter="url(#' + U + 'sh)"></circle><path d="M-5 -5 L5 5 M5 -5 L-5 5" style="fill:none;stroke:#2B211B;stroke-width:2.4;stroke-linecap:round"></path></g>';
        }
        o += badge(pa, 'store', 0) + badge(pb, 'home', mode === 'found' && anim ? draw - 0.1 : 0);
        if (stops[0].label) o += chip(pa, stops[0].label, true, 0);
        if (stops[stops.length - 1].label) o += chip(pb, stops[stops.length - 1].label, true, mode === 'found' && anim ? draw : 0);
      } else {
        var pts = stops.map(function (s) { return proj(pt(s)); });
        var arcs = [];
        for (var j = 0; j < legs; j++) arcs.push(arc(pts[j], pts[j + 1], j === legs - 1 ? 0.28 : 0.18));
        arcs.forEach(function (A, j) {
          if (mode === 'planned') o += faint(A.d);
          else if (j < leg) o += solid(A.d, '', false);
          else if (j === leg) { var sp = split(A, Math.max(0.001, Math.min(0.999, t))); o += faint(sp.b) + (t > 0 ? solid(sp.a, '', false) : ''); }
          else o += faint(A.d);
        });
        if (mode === 'planned') { var Ap = arcs[0]; o += '<path d="' + Ap.d + '" pathLength="1" style="fill:none;stroke:#2E5AAC;stroke-width:5;stroke-linecap:round;stroke-dasharray:.12 .88;stroke-dashoffset:1">' + (reduce ? '' : '<animate attributeName="stroke-dashoffset" from="1" to="0" dur="2.6s" repeatCount="indefinite"></animate>') + '</path>'; }
        pts.forEach(function (p, k) {
          if (k === 0) o += badge(p, 'store', 0);
          else if (k === pts.length - 1) o += badge(p, 'home', 0);
          else o += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="5" style="fill:#FBF6EE;stroke:#2E5AAC;stroke-width:2.5"></circle>';
        });
        stops.forEach(function (s, k) { if (s.label && (k === 0 || k === stops.length - 1)) o += chip(pts[k], s.label, true, 0); });
        if (mode === 'progress') {
          var q = arcs[leg].at(t);
          o += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="15" style="fill:#2E5AAC;opacity:.3">' + (reduce ? '' : '<animate attributeName="r" values="15;30;15" dur="2.4s" repeatCount="indefinite"></animate><animate attributeName="opacity" values=".3;0;.3" dur="2.4s" repeatCount="indefinite"></animate>') + '</circle>';
          o += '<g transform="translate(' + q[0] + ',' + q[1] + ')">' + box() + '</g>';
        }
      }
      this.innerHTML = o + '</svg>';
      var svg = this.firstChild; if (svg && svg.style) svg.style.position = 'relative';
      if (raster) {
        var cv = this._paint(proj, w, h); this.insertBefore(cv, svg);
        // A still map used to draw from the low resolution world image alone, so
        // a zoomed route never gained the detail the animated map already had.
        // Fetch the tile for this view and repaint when it lands. A view wide
        // enough to not need one is already rejected inside the fetch.
        var self2 = this, tk = (this._rtok = (this._rtok || 0) + 1);
        this._hiFetch(proj, w, h).then(function (S2) {
          if (!S2 || tk !== self2._rtok || !self2.isConnected) return;
          var old = self2.querySelector('canvas');
          if (!old || !old.parentNode) return;
          old.parentNode.replaceChild(self2._paint(proj, w, h, true, S2), old);
        });
      }
      // innerHTML above clears the element, so the licence credit is put back.
      if (this._cred) { this.appendChild(this._cred); if (this._fit) this._fit(); }
    }
  }
  customElements.define('route-map', RouteMap);
})();
