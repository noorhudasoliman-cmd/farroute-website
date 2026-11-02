/*
 * Farroute branded satellite map. Exact port of the approved design
 * (Farroute Satellite Map.dc.html). Requires Leaflet 1.9.4 loaded first.
 *
 *   const fm = createFarrouteMap(document.getElementById('map'), {
 *     source: 'esri',        // 'esri' (default, to zoom 19) or 'sentinel' (to zoom 15)
 *     brandGrade: true,      // false shows the raw satellite photo
 *     gradeStrength: 0.7     // 0.3 to 1, approved value 0.7
 *   });
 *   fm.fly([45.62, 10.85], 9.4);  // fm.fly(null) returns to the whole world
 *   fm.destroy();
 *
 * Do not change the numbers in grade() or makeLayer(). They are the approved look.
 */
(function (root) {
  var SOURCES = {
    esri: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      max: 19,
      attr: 'Imagery © Esri, Maxar, Earthstar Geographics'
    },
    sentinel: {
      url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
      max: 15,
      attr: '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)'
    }
  };
  var BLUE_MARBLE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
  var MASK = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/';
  var BOUNDS = [[-85.05, -180], [85.05, 180]];
  var START = [22, 10];
  var LAND_STOPS = ['3A2C22', '5E4936', '84694E', 'A68866', 'C1A47F', 'D5BE9B', 'E4D4B7', 'EFE5D2', 'F8F3EA'];

  function load(u, pri) {
    return new Promise(function (res) {
      var i = new Image(); i.crossOrigin = 'anonymous';
      if (pri) { try { i.fetchPriority = pri; } catch (e) {} }
      i.onload = function () { res(i); }; i.onerror = function () { res(null); };
      i.src = u;
    });
  }

  /* A preload is a head start, never a queue the picture has to wait behind.
     Seeding the world and the route ahead asks for hundreds of tiles, and on a
     phone those were sent all at once: the sixteen tiles actually on screen
     then sat behind them, so the map showed bare squares for seconds and the
     backdrop that covers the gaps never arrived at all. Everything that is not
     on screen goes through here instead, a few at a time and marked low
     priority, so the browser serves what the visitor is looking at first. */
  var MAX_PRELOAD = 6, running = 0, waiting = [];
  function pump() {
    while (running < MAX_PRELOAD && waiting.length) { running++; waiting.shift()(); }
  }
  function queued(u) {
    return new Promise(function (res) {
      waiting.push(function () {
        load(u, 'low').then(function (r) { running--; pump(); res(r); });
      });
      pump();
    });
  }

  // Used by the preload, where a tile that does not arrive must not be mistaken
  // for one that did. Tries twice, then reports the failure.
  function loadStrict(u) {
    return queued(u).then(function (r) { return r || queued(u); })
      .then(function (r) { if (!r) throw new Error('tile'); return r; });
  }

  // Waiting makes the first view better, but only up to a point. Past the cap
  // the picture is good enough to fly on and the rest keeps loading behind it,
  // which matters on a phone where the full seed can take minutes.
  function capped(p, ms) {
    return new Promise(function (res) {
      var done = false, fin = function () { if (!done) { done = true; res(); } };
      setTimeout(fin, ms);
      Promise.resolve(p).then(fin, fin);
    });
  }

  function createFarrouteMap(el, opts) {
    var L = root.L;
    if (!L) throw new Error('Leaflet must be loaded before farroute-map.js');
    opts = opts || {};
    var state = {
      source: opts.source || 'esri',
      brandGrade: opts.brandGrade !== false,
      gradeStrength: opts.gradeStrength != null ? opts.gradeStrength : 0.7,
      worldImage: opts.worldImage || null
    };
    var map, base, layer, under, onZoom, ro, lut = null, lutS = null, uTok = null, moved = false, auto = false;

    // One place decides what a small frame is. A phone has less connection and
    // less processor to spend, and holds fewer tiles it is not showing.
    // 700 is also the width the page preloads the two backdrop sizes at, so
    // the one asked for in the head is the one this picks.
    function small() { return (root.innerWidth || el.clientWidth || 0) < 700; }
    MAX_PRELOAD = small() ? 4 : 8;

    // Tiles drawn 1px oversize so no hairline seams appear between them at fractional zoom.
    if (!L.GridLayer.prototype._frSeamFix) {
      var orig = L.GridLayer.prototype._initTile;
      L.GridLayer.include({
        _frSeamFix: true,
        _initTile: function (tile) {
          orig.call(this, tile);
          var s = this.getTileSize();
          tile.style.width = (s.x + 1) + 'px'; tile.style.height = (s.y + 1) + 'px';
        }
      });
    }

    // Minimum zoom = the whole world exactly fills the container width.
    function fitMin() {
      // A detached or hidden element reports no width, and log2 of zero is
      // negative infinity, which turns the zoom and then every coordinate into
      // NaN. That happens the moment the page navigates away from the map.
      var w = el.clientWidth, h = el.clientHeight;
      if (!(w > 0)) return map.getZoom() || 0;
      // Whichever side needs more, so the world fills the frame without empty
      // bands. It is never zoomed past that: going closer would cut the sides
      // off, which took Asia and Australia off a phone screen. A frame shaped
      // differently from the world is the page's job to size, not the map's to
      // crop away.
      var z = Math.max(Math.log2(w / 256), h > 0 ? Math.log2(h / 256) : 0);
      map.setMinZoom(z);
      return z;
    }

    // Luminance to espresso-and-cream ramp for land.
    function gradeLUT() {
      var st = state.gradeStrength;
      if (lut && lutS === st) return lut;
      var stops = LAND_STOPS.map(function (x) { return [0, 2, 4].map(function (i) { return parseInt(x.slice(i, i + 2), 16); }); });
      var out = new Uint8ClampedArray(256 * 3);
      for (var i = 0; i < 256; i++) {
        var t = Math.pow(i / 255, 0.65) * 8, k = Math.min(7, Math.floor(t)), f = t - k;
        for (var c = 0; c < 3; c++) out[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
      }
      lut = out; lutS = st; return out;
    }

    // d: satellite pixels (edited in place). m: water-outline tile pixels. bl: Blue Marble pixels for sea texture.
    function grade(d, m, bl) {
      var s = state.gradeStrength, ss = Math.min(0.95, s + 0.2), lt = gradeLUT();
      var W = null, N = 256, p, i;
      if (m) {
        var w0 = new Float32Array(N * N), t = new Float32Array(N * N);
        // Water in the Light Gray Canvas basemap is slightly bluer than green; land is neutral grey.
        for (p = 0, i = 0; p < N * N; p++, i += 4) w0[p] = m[i] >= m[i + 1] ? Math.max(0, Math.min(1, (m[i + 2] - m[i + 1] - 1.5) / 3.5)) : 0;
        // Neutral grey pixels inside water (border dashes, labels) take the strongest water value within 3px.
        for (p = 0, i = 0; p < N * N; p++, i += 4) {
          var r0 = m[i], g0 = m[i + 1], b0 = m[i + 2];
          if (r0 < 224 && Math.abs(r0 - g0) <= 3 && Math.abs(b0 - g0) <= 3) {
            var py = (p / N) | 0, px = p % N, v = 0;
            for (var dy = -3; dy <= 3; dy++) for (var dx = -3; dx <= 3; dx++) {
              var yy = py + dy, xx = px + dx;
              if (yy < 0 || yy >= N || xx < 0 || xx >= N) continue;
              var o = yy * N + xx; if (w0[o] > v) v = w0[o];
            }
            t[p] = v;
          } else t[p] = -1;
        }
        for (p = 0; p < N * N; p++) if (t[p] >= 0) w0[p] = t[p];
        W = w0;
      }
      for (i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2], w;
        var wh = 1 - Math.max(0, Math.min(1, (8 * r + 8 * g - 16 * b) / 255 + 0.8));
        if (W) { var wm = W[i >> 2]; w = wm * wm * (3 - 2 * wm); } else w = wh;
        var li = (0.3 * r + 0.59 * g + 0.11 * b) | 0;
        var lr = s * lt[li * 3] + (1 - s) * r, lg = s * lt[li * 3 + 1] + (1 - s) * g, lb = s * lt[li * 3 + 2] + (1 - s) * b;
        var R2 = bl ? bl[i] : r, G2 = bl ? bl[i + 1] : g, B2 = bl ? bl[i + 2] : b;
        // Light Farroute blue sea that keeps currents and depth from Blue Marble.
        var tr = 0.2 * R2 + 0.12 * G2 + 0.03 * B2 + 186, tg = 0.06 * R2 + 0.25 * G2 + 0.03 * B2 + 204, tb = 0.06 * R2 + 0.12 * G2 + 0.15 * B2 + 222;
        var sr = ss * tr + (1 - ss) * R2, sg = ss * tg + (1 - ss) * G2, sb = ss * tb + (1 - ss) * B2;
        d[i] = w * sr + (1 - w) * lr; d[i + 1] = w * sg + (1 - w) * lg; d[i + 2] = w * sb + (1 - w) * lb;
      }
    }

    function makeLayer(url, max, attr, live, bg) {
      var ret = (root.devicePixelRatio || 1) > 1.4, off = ret ? 1 : 0;
      var Layer = L.GridLayer.extend({
        createTile: function (c, done) {
          // On screen: straight out to the network. Building the backdrop: into
          // the preload queue, behind whatever the visitor is looking at.
          var get = this.options.frBg ? queued : load;
          var cv = document.createElement('canvas'); cv.width = cv.height = 256;
          var z = c.z + off, x = c.x, y = c.y;
          // Water outline tile: same zoom up to 16, then upscaled from 16.
          var mz = Math.min(z, 16), sh = z - mz, mx = x >> sh, my = y >> sh, n = 1 << sh;
          // Sea texture tile: 3 zoom levels coarser so currents read as smooth, not noisy.
          var pz = Math.max(0, z - 3), psh = z - pz, px = x >> psh, py = y >> psh, pn = 1 << psh;
          var U = function (zz, xx, yy) { return url.replace('{z}', zz).replace('{x}', xx).replace('{y}', yy); };
          Promise.all([get(U(z, x, y)), get(MASK + mz + '/' + my + '/' + mx), get(U(pz, px, py))]).then(function (r) {
            var img = r[0], mk = r[1], pimg = r[2];
            if (!img) return done(null, cv);
            var ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, 256, 256);
            if (!state.brandGrade) return done(null, cv);
            try {
              var id = ctx.getImageData(0, 0, 256, 256), m = null, bl = null;
              if (mk) {
                var mc = document.createElement('canvas'); mc.width = mc.height = 256;
                var mx2 = mc.getContext('2d'); mx2.imageSmoothingEnabled = true; mx2.imageSmoothingQuality = 'high';
                var sz = 256 / n; mx2.drawImage(mk, (x - mx * n) * sz, (y - my * n) * sz, sz, sz, 0, 0, 256, 256);
                m = mx2.getImageData(0, 0, 256, 256).data;
              }
              if (m && pimg) {
                var bc = document.createElement('canvas'); bc.width = bc.height = 256;
                var bx = bc.getContext('2d', { willReadFrequently: true }); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high';
                var ps = 256 / pn; bx.drawImage(pimg, (x - px * pn) * ps, (y - py * pn) * ps, ps, ps, 0, 0, 256, 256);
                bl = bx.getImageData(0, 0, 256, 256).data;
              }
              grade(id.data, m, bl);
              ctx.putImageData(id, 0, 0);
            } catch (e) {}
            done(null, cv);
          });
          return cv;
        }
      });
      Layer._off = off;
      // On retina screens, 128px tiles one zoom deeper so imagery is sharp at device resolution.
      // updateWhenZooming is off because Leaflet's default rebuilds the whole
      // grid every time the rounded zoom crosses an integer. A flight from the
      // world view down to a route crossed five of them and asked for 904 tiles
      // in mid air, and the load events alone cost the camera its frames. The
      // level already on screen is scaled through the flight instead, and the
      // real tiles are drawn once the camera stops, where they are cache hits
      // from the preload. updateWhenIdle does the same for the pan: Leaflet
      // otherwise rebuilds the grid every 200ms while the camera is in motion,
      // and nothing here is dragged by hand, so there is no interaction to
      // keep up with.
      // keepBuffer is a ring of tiles held outside the frame. Four of them on a
      // phone is more tiles off screen than on it, each one three requests and
      // a grading pass, so the small screen keeps the Leaflet default instead.
      return new Layer({ tileSize: ret ? 128 : 256, maxNativeZoom: max - off, maxZoom: max + 2, noWrap: true, bounds: BOUNDS, keepBuffer: small() ? 2 : 4, updateWhenZooming: false, updateWhenIdle: true, attribution: attr, frBg: !!bg });  // every level is preloaded before a
      // move, so drawing each one as the camera passes costs nothing and keeps
      // the picture continuous instead of snapping at the end.
    }

    // One graded world image underneath, so no blank tiles show while zooming.
    // It was built from 256 tiles onto a 4096 square canvas and handed to the
    // map as a base64 data URL. That is 16.8 million pixels, which is the point
    // where iOS stops honouring a canvas, and the encode alone took seconds on
    // a phone: the one thing that covers the gaps was the slowest thing to
    // arrive. 64 tiles onto a 2048 square is a sixteenth of the pixels and a
    // quarter of the tiles, and at this size the backdrop is still four times
    // the resolution any screen shows of it.
    // Draws the whole world once, graded, onto one canvas. Building it in the
    // browser is what the map used to do on every visit: 64 tiles, each three
    // requests and a grading pass, before the one thing that covers a gap was
    // on screen. On a throttled phone that took 19 seconds, and the visitor
    // spent them looking at bare blue. The picture never changes, so it is
    // built once here and kept as a file. Regenerate it with
    // tools/make-world-image.mjs whenever gradeStrength or LAND_STOPS change.
    function drawWorld(tiles, px) {
      var lyr = makeLayer(BLUE_MARBLE, 8, '', false, true), off = lyr.constructor._off;
      var zt = Math.round(Math.log2(tiles));
      var big = document.createElement('canvas'); big.width = big.height = px;
      var bx = big.getContext('2d'), cell = px / tiles, jobs = [];
      for (var y = 0; y < tiles; y++) for (var x = 0; x < tiles; x++) (function (x, y) {
        jobs.push(new Promise(function (res) {
          lyr.createTile({ x: x, y: y, z: zt - off }, function (e, cv) {
            bx.drawImage(cv, 0, 0, 256, 256, x * cell, y * cell, cell, cell); res();
          });
        }));
      })(x, y);
      return Promise.all(jobs).then(function () { return big; });
    }

    // The backdrop. One file from our own server, up before the first tile, so
    // a frame with no tiles yet is still a map rather than an empty rectangle.
    // If the file is missing the world is drawn in the browser instead, which
    // is slow but correct, and the map is never left with nothing underneath.
    function buildUnderlay(then) {
      var token = uTok = {};
      // Whatever happens to the backdrop, the tiles are never held for longer
      // than this. A map with no backdrop is worse than one without; a map
      // waiting on a file that will not come is worse than both.
      var went = false, go = function () { if (!went) { went = true; then && then(); } };
      setTimeout(go, 1800);
      var put = function (src) {
        if (token !== uTok || !map || under) return go();
        under = L.imageOverlay(src, [[-85.0511, -180], [85.0511, 180]], { pane: 'tilePane', zIndex: 0 }).addTo(map);
        var el2 = under.getElement(); if (el2) el2.style.zIndex = 0;
        go();
        seedWide();
      };
      // Asked for ahead of the tiles and at high priority: it is one request to
      // our own server against forty-eight to two map services, and until it
      // lands the frame is an empty rectangle. A phone is given the smaller
      // copy, which is still more than its screen can show.
      var src = state.worldImage || (small() ? './img/world-small.jpg' : './img/world.jpg');
      load(src, 'high').then(function (img) {
        if (token !== uTok || !map) return go();
        if (img) return put(src);
        // No file to be had, so the world is drawn here instead: slow, but the
        // map is never left with nothing underneath it.
        drawWorld(8, 2048).then(function (cv) { put(cv.toDataURL('image/jpeg', 0.86)); });
      });
    }

    // The wide middle of a flight was still soft over open ocean, because the
    // path is seeded along a straight line while the camera's widest point sits
    // off it. Rather than chase the curve, the whole world is held at the wide
    // levels: 336 coarse tiles, fetched once after the map is already up. After
    // that no wide frame anywhere depends on the network.
    var seeded = false, wideDone = null, wideSignal = null, firstWarm = true;
    wideDone = new Promise(function (r) { wideSignal = r; });
    function seedWide() {
      if (seeded) return; seeded = true;
      // Every level the camera can occupy must be held by something sharp, or
      // the blur simply moves to whichever level is not. The levels it can
      // occupy depend on the frame: a phone fits two ends of a route only by
      // standing back, so it never leaves the widest levels, while a wide
      // screen goes a couple deeper. Seeding to level 5 regardless asked for
      // 1,360 tiles, 1,024 of them at a level a phone never shows, and that
      // flood is what starved the sixteen tiles it did show. Level 5 is seeded
      // per route by the preload below instead.
      var deep = Math.min(4, Math.max(3, Math.ceil(map.getMinZoom() + 2.2)));
      var zs = [], i = 0;
      for (var z0 = 2; z0 <= deep; z0++) zs.push(z0);
      var step = function () {
        if (i >= zs.length) return;
        var z = zs[i++], n = 1 << z, jobs = [];
        for (var x = 0; x < n; x++) for (var y = 0; y < n; y++) {
          jobs.push(queued(BLUE_MARBLE.replace('{z}', z).replace('{x}', x).replace('{y}', y)));
        }
        Promise.all(jobs).then(function () { if (i >= zs.length) wideSignal(); else setTimeout(step, 120); });
      };
      step();
    }

    function setSource() {
      var s = SOURCES[state.source] || SOURCES.esri;
      if (layer) map.removeLayer(layer);
      if (base) map.removeLayer(base);
      if (onZoom) map.off('zoom', onZoom);
      if (under) { map.removeLayer(under); under = null; }
      map.setMaxZoom(s.max + 2);
      // The backdrop is one small file from our own server and it is a whole
      // world; the tiles are forty-eight requests to two map services that
      // only make a picture once all of them land. Asked for at the same time
      // they simply share the connection, and on a phone that left the frame
      // empty for seconds. So the backdrop is fetched first and the tiles are
      // added once it is up, or after the wait below if it never arrives.
      buildUnderlay(function () { if (map) addTiles(s); });
    }

    function addTiles(s) {
      // Zoomed out: Blue Marble only (no water outlines, no high-res photo).
      base = makeLayer(BLUE_MARBLE, 8, 'NASA Blue Marble', true).addTo(map);
      // The backdrop carries the middle of a flight and is not needed to show
      // the opening view, so it is built once the map is already on screen.
      // The seed follows the backdrop rather than competing with it for the
      // connection, and goes ahead anyway if the backdrop never arrives.
      setTimeout(seedWide, 12000);
      layer = makeLayer(s.url, s.max, s.attr + ', water outlines © Esri').addTo(map);
      // High-res photo fades in from zoom 4.2 to 5.8 (Esri) or 5.5 to 7.1 (Sentinel).
      // The photo takes over just above where the world is held globally, so no
      // level is left to a layer that has to be magnified to fill it.
      // The photo waits until the camera is close enough that its tiles have
      // been preloaded for this flight. Below that the world layer carries it,
      // held globally to zoom 5 and seeded along the route above that.
      var a = state.source === 'sentinel' ? 6.6 : 6.4;
      // A half built photo level shows as a hard rectangular seam, where tiles
      // from the level being left sit against tiles from the level being
      // entered. So the photo stays hidden while the camera is moving and is
      // revealed only once it has finished drawing. The world layer, coarse but
      // always whole, carries the movement by itself.
      onZoom = function () {
        // The photo used to take 1.6 zoom levels to become opaque, finishing at
        // zoom 9. Between zoom 8 and 9 it was therefore part transparent over a
        // layer already magnified past its own detail, and that blend is what
        // read as soft. It is preloaded, so it has no reason to ease in: it is
        // fully opaque by zoom 8, while the layer beneath is still sharp.
        // Blending the photo over the layer beneath softens every edge in the
        // frame while it is part transparent. Both are preloaded and their
        // grading matches, so the photo is simply on or off: no blend, no band
        // of softness on the way in.
        var z = map.getZoom(), o = z >= a ? 1 : 0;
        if (o <= 0) { if (map.hasLayer(layer)) map.removeLayer(layer); return; }
        if (!map.hasLayer(layer)) layer.addTo(map);
        layer.setOpacity(o);
      };
      map.on('zoom', onZoom); onZoom();
    }

    el.style.background = el.style.background || '#C2D6E8';
    map = L.map(el, {
      zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
      maxBounds: BOUNDS, maxBoundsViscosity: 1,
      worldCopyJump: false, attributionControl: true, zoomControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, boxZoom: false, keyboard: false, tap: false,
      inertia: false
    });
    map.attributionControl.setPrefix(false);
    map.setView(START, fitMin(), { animate: false });
    map.on('dragstart zoomstart', function () { if (!auto) moved = true; });
    setSource();
    ro = new ResizeObserver(function () {
      if (!map || !el.clientWidth || !el.clientHeight) return;
      map.invalidateSize();
      var m = fitMin(); auto = true;
      if (!moved) map.setView(START, m, { animate: false });
      else if (map.getZoom() < m) map.setZoom(m);
      auto = false;
    });
    ro.observe(el);

    return {
      map: map,
      // Fetches the tiles a destination will need before the camera starts
      // moving. The browser then serves them from its own cache on arrival, so
      // the picture is complete as the flight lands rather than filling in
      // square by square afterwards.
      // Resolves once the backdrop is drawn and the world is held at the wide
      // levels. Flying before then means the widest part of the flight has
      // nothing behind it.
      // The backdrop and the wide cover improve the first flight, they do not
      // gate it. On a slow connection the full seed is over a thousand tiles,
      // and blocking on it left the map sitting still for minutes.
      settled: function () {
        return capped(Promise.all([
          wideDone,
          new Promise(function (r) {
            var t = 0, w = function () { if (under || t++ > 60) return r(); setTimeout(w, 120); };
            w();
          })
        ]), 350);
      },
      warm: function (c, z) {
        // A preload still in flight when the map is torn down would project
        // against a map that no longer has a size, which yields NaN coordinates.
        if (!layer || !map || !map._loaded) return Promise.resolve();
        if (map.getSize().x < 10 || map.getSize().y < 10) return Promise.resolve();
        var ret = (root.devicePixelRatio || 1) > 1.4, off = ret ? 1 : 0, ts = ret ? 128 : 256;
        var sz = map.getSize(), src = (SOURCES[state.source] || SOURCES.esri);
        var jobs = [];
        [6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter(function (tz) { return tz <= Math.round(z); }).forEach(function (tz) {
          if (tz < 1) return;
          var pt = map.project(L.latLng(c[0], c[1]), tz);
          var cx = Math.floor(pt.x / ts), cy = Math.floor(pt.y / ts);
          // Leaflet keeps a ring of tiles beyond the viewport, so preloading only
          // what is on screen left that ring to arrive late and show soft.
          var rx = Math.ceil(sz.x / ts / 2) + 2, ry = Math.ceil(sz.y / ts / 2) + 2;
          var pz = Math.min(tz + off, src.max);
          var span = 1 << tz;
          for (var x = cx - rx; x <= cx + rx; x++) {
            for (var y = cy - ry; y <= cy + ry; y++) {
              if (x < 0 || y < 0 || x >= span || y >= span) continue;
              jobs.push(loadStrict(src.url.replace('{z}', pz).replace('{x}', x).replace('{y}', y)));
              jobs.push(loadStrict(MASK + Math.min(pz, 16) + '/' + (y >> Math.max(0, pz - 16)) + '/' + (x >> Math.max(0, pz - 16))));
            }
          }
        });
        // Never hold the camera for the whole preload. Whatever has arrived by
        // the cap is a head start; the rest keeps loading while the map moves.
        // The wide part of a flight is carried by the world layer, and preloading
        // it only around the destination left the path itself bare: the camera
        // crossed ground whose tiles had never been asked for, and fell back to
        // the stretched backdrop. Points along the route are seeded as well, so
        // every frame between here and there has real tiles behind it.
        var here = map.getCenter(), seeds = [[c[0], c[1]]];
        for (var f = 1; f <= 4; f++) {
          var t = f / 5;
          seeds.push([here.lat + (c[0] - here.lat) * t, here.lng + (c[1] - here.lng) * t]);
        }
        var wrx = Math.ceil(sz.x / 256 / 2) + 1, wry = Math.ceil(sz.y / 256 / 2) + 1;
        seeds.forEach(function (pt, idx) {
          // The destination gets the full band; the points in between only need
          // the wide levels the camera actually passes through over them.
          // Seeding a fixed band wasted most of its tiles when the camera was
          // only going to a wide view. The band follows the target zoom now.
          // Levels 2 to 5 are already held for the whole world, so seeding them
          // again per route fetched the same tiles over and over.
          var tz = Math.round(z);
          var lo = Math.max(5, (idx === 0 ? tz - 7 : tz - 3));
          var hi = Math.min(8, (idx === 0 ? tz - 2 : tz + 1));
          for (var wz = lo; wz <= hi; wz++) {
            var wp = map.project(L.latLng(pt[0], pt[1]), wz);
            var wx = Math.floor(wp.x / 256), wy = Math.floor(wp.y / 256);
            // Levels 5 to 8 are where a flight spends most of its wide time and
            // the world is only held globally to 4, so they are taken generously:
            // the tiles are coarse and there are few of them.
            var r2 = (wz >= 5 && wz <= 8 ? 2 : 0) + (idx === 0 ? 1 : 0);
            var wspan = 1 << wz;
            for (var bx2 = wx - wrx - r2; bx2 <= wx + wrx + r2; bx2++) {
              for (var by2 = wy - wry - r2; by2 <= wy + wry + r2; by2++) {
                if (bx2 < 0 || by2 < 0 || bx2 >= wspan || by2 >= wspan) continue;
                // The world layer is a backdrop with gaps of its own, so a tile
                // it cannot serve must not fail the whole preload the way a
                // missing photo tile should.
                jobs.push(load(BLUE_MARBLE.replace('{z}', wz).replace('{x}', bx2).replace('{y}', by2)));
              }
            }
          }
        });
        // Whatever has arrived by the cap is a head start, not a precondition.
        // The rest keeps loading while the camera moves, and the world layer and
        // the backdrop carry anything that has not landed yet. The first flight
        // gets a shorter cap so the page starts showing routes promptly.
        var cap = firstWarm ? 400 : 3500;
        firstWarm = false;
        return capped(Promise.all(jobs), cap);
      },
      // One tile build part way through a flight, taken once the camera is
      // already near its final zoom so the tile range is small. Rebuilding on
      // every frame is what made the camera stutter; never rebuilding left the
      // picture scaled up from a coarser level, which reads as grain. This is
      // the single update in between, and the tiles are already in the browser
      // cache from the preload, so they appear almost at once.
      refresh: function () {
        if (!map) return;
        [base, layer].forEach(function (ly) {
          if (ly && ly._map && ly._onMoveEnd) { try { ly._onMoveEnd(); } catch (e) {} }
        });
      },
      ready: function (cb) {
        if (!layer) return cb();
        var done = false, fin = function () { if (done) return; done = true; layer.off('load', fin); cb(); };
        layer.on('load', fin);
        setTimeout(fin, 2600);
      },
      fly: function (c, z) {
        if (!c) return map.flyTo(START, map.getMinZoom(), { duration: 1.4 });
        map.flyTo(c, z, { duration: 1.6 });
      },
      set: function (patch) {
        var srcChanged = patch.source && patch.source !== state.source;
        Object.assign(state, patch);
        if (srcChanged) setSource();
        else { base && base.redraw(); layer && layer.redraw(); }
      },
      // Used by tools/make-world-image.mjs to regenerate img/world.jpg through
      // this exact grading pipeline. Nothing at runtime calls it.
      worldImage: function (tiles, px, quality) {
        return drawWorld(tiles || 8, px || 2048).then(function (cv) {
          return cv.toDataURL('image/jpeg', quality || 0.86);
        });
      },
      destroy: function () { ro && ro.disconnect(); map && map.remove(); map = null; }
    };
  }

  root.createFarrouteMap = createFarrouteMap;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createFarrouteMap: createFarrouteMap };
})(typeof window !== 'undefined' ? window : this);
