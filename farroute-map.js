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

  function load(u) {
    return new Promise(function (res) {
      var i = new Image(); i.crossOrigin = 'anonymous';
      i.onload = function () { res(i); }; i.onerror = function () { res(null); };
      i.src = u;
    });
  }

  // Used by the preload, where a tile that does not arrive must not be mistaken
  // for one that did. Tries twice, then reports the failure.
  function loadStrict(u) {
    return load(u).then(function (r) { return r || load(u); })
      .then(function (r) { if (!r) throw new Error('tile'); return r; });
  }

  function createFarrouteMap(el, opts) {
    var L = root.L;
    if (!L) throw new Error('Leaflet must be loaded before farroute-map.js');
    opts = opts || {};
    var state = {
      source: opts.source || 'esri',
      brandGrade: opts.brandGrade !== false,
      gradeStrength: opts.gradeStrength != null ? opts.gradeStrength : 0.7
    };
    var map, base, layer, under, onZoom, ro, lut = null, lutS = null, uTok = null, moved = false, auto = false;

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
      var w = el.clientWidth;
      if (!(w > 0)) return map.getZoom() || 0;
      var z = Math.log2(w / 256);
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

    function makeLayer(url, max, attr, live) {
      var ret = (root.devicePixelRatio || 1) > 1.4, off = ret ? 1 : 0;
      var Layer = L.GridLayer.extend({
        createTile: function (c, done) {
          var cv = document.createElement('canvas'); cv.width = cv.height = 256;
          var z = c.z + off, x = c.x, y = c.y;
          // Water outline tile: same zoom up to 16, then upscaled from 16.
          var mz = Math.min(z, 16), sh = z - mz, mx = x >> sh, my = y >> sh, n = 1 << sh;
          // Sea texture tile: 3 zoom levels coarser so currents read as smooth, not noisy.
          var pz = Math.max(0, z - 3), psh = z - pz, px = x >> psh, py = y >> psh, pn = 1 << psh;
          var U = function (zz, xx, yy) { return url.replace('{z}', zz).replace('{x}', xx).replace('{y}', yy); };
          Promise.all([load(U(z, x, y)), load(MASK + mz + '/' + my + '/' + mx), load(U(pz, px, py))]).then(function (r) {
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
      return new Layer({ tileSize: ret ? 128 : 256, maxNativeZoom: max - off, maxZoom: max + 2, noWrap: true, bounds: BOUNDS, keepBuffer: 4, attribution: attr });  // every level is preloaded before a
      // move, so drawing each one as the camera passes costs nothing and keeps
      // the picture continuous instead of snapping at the end.
    }

    // One graded 1024px world image underneath, so no blank tiles show while zooming.
    function buildUnderlay() {
      var lyr = makeLayer(BLUE_MARBLE, 8, ''), off = lyr.constructor._off;
      var big = document.createElement('canvas'); big.width = big.height = 4096;
      var bx = big.getContext('2d'), jobs = [];
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) (function (x, y) {
        jobs.push(new Promise(function (res) { lyr.createTile({ x: x, y: y, z: 4 - off }, function (e, cv) { bx.drawImage(cv, x * 256, y * 256); res(); }); }));
      })(x, y);
      var token = uTok = {};
      Promise.all(jobs).then(function () {
        if (token !== uTok || !map) return;
        under = L.imageOverlay(big.toDataURL('image/jpeg', 0.9), [[-85.0511, -180], [85.0511, 180]], { pane: 'tilePane', zIndex: 0 }).addTo(map);
        under.getElement().style.zIndex = 0;
      });
    }

    function setSource() {
      var s = SOURCES[state.source] || SOURCES.esri;
      if (layer) map.removeLayer(layer);
      if (base) map.removeLayer(base);
      if (onZoom) map.off('zoom', onZoom);
      if (under) { map.removeLayer(under); under = null; }
      // Zoomed out: Blue Marble only (no water outlines, no high-res photo).
      base = makeLayer(BLUE_MARBLE, 8, 'NASA Blue Marble', true).addTo(map);
      // The backdrop carries the middle of a flight and is not needed to show
      // the opening view, so it is built once the map is already on screen.
      base.once('load', function () { setTimeout(buildUnderlay, 60); });
      setTimeout(function () { if (!under) buildUnderlay(); }, 6000);
      layer = makeLayer(s.url, s.max, s.attr + ', water outlines © Esri').addTo(map);
      // High-res photo fades in from zoom 4.2 to 5.8 (Esri) or 5.5 to 7.1 (Sentinel).
      var a = state.source === 'sentinel' ? 7.6 : 7.4;
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
        var z = map.getZoom(), o = Math.max(0, Math.min(1, (z - a) / 0.6));
        if (o <= 0) { if (map.hasLayer(layer)) map.removeLayer(layer); return; }
        if (!map.hasLayer(layer)) layer.addTo(map);
        layer.setOpacity(o);
      };
      map.on('zoom', onZoom); onZoom();
      map.setMaxZoom(s.max + 2);
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
      warm: function (c, z) {
        // A preload still in flight when the map is torn down would project
        // against a map that no longer has a size, which yields NaN coordinates.
        if (!layer || !map || !map._loaded) return Promise.resolve();
        if (map.getSize().x < 10 || map.getSize().y < 10) return Promise.resolve();
        var ret = (root.devicePixelRatio || 1) > 1.4, off = ret ? 1 : 0, ts = ret ? 128 : 256;
        var sz = map.getSize(), src = (SOURCES[state.source] || SOURCES.esri);
        var jobs = [];
        [7, 8, 9, 10, 11, 12, 13, 14, 15].filter(function (tz) { return tz <= Math.round(z); }).forEach(function (tz) {
          if (tz < 1) return;
          var pt = map.project(L.latLng(c[0], c[1]), tz);
          var cx = Math.floor(pt.x / ts), cy = Math.floor(pt.y / ts);
          // Leaflet keeps a ring of tiles beyond the viewport, so preloading only
          // what is on screen left that ring to arrive late and show soft.
          var rx = Math.ceil(sz.x / ts / 2) + 2, ry = Math.ceil(sz.y / ts / 2) + 2;
          var pz = Math.min(tz + off, src.max);
          for (var x = cx - rx; x <= cx + rx; x++) {
            for (var y = cy - ry; y <= cy + ry; y++) {
              if (y < 0 || x < 0) continue;
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
        for (var f = 1; f <= 6; f++) {
          var t = f / 7;
          seeds.push([here.lat + (c[0] - here.lat) * t, here.lng + (c[1] - here.lng) * t]);
        }
        var wrx = Math.ceil(sz.x / 256 / 2) + 1, wry = Math.ceil(sz.y / 256 / 2) + 1;
        seeds.forEach(function (pt, idx) {
          // The destination gets the full band; the points in between only need
          // the wide levels the camera actually passes through over them.
          var lo = idx === 0 ? Math.max(2, Math.round(z) - 7) : 4;
          var hi = idx === 0 ? Math.min(8, Math.round(z) - 2) : 8;
          for (var wz = lo; wz <= hi; wz++) {
            var wp = map.project(L.latLng(pt[0], pt[1]), wz);
            var wx = Math.floor(wp.x / 256), wy = Math.floor(wp.y / 256);
            var r2 = idx === 0 ? 1 : 0;
            for (var bx2 = wx - wrx - r2; bx2 <= wx + wrx + r2; bx2++) {
              for (var by2 = wy - wry - r2; by2 <= wy + wry + r2; by2++) {
                if (bx2 < 0 || by2 < 0) continue;
                jobs.push(loadStrict(BLUE_MARBLE.replace('{z}', wz).replace('{x}', bx2).replace('{y}', by2)));
              }
            }
          }
        });
        // A move is only safe once every tile it will show has been fetched, so
        // the caller waits for all of it. An unfinished preload means no flight.
        return Promise.all(jobs);
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
        if (srcChanged) setSource(); else { base.redraw(); layer.redraw(); }
      },
      destroy: function () { ro && ro.disconnect(); map && map.remove(); map = null; }
    };
  }

  root.createFarrouteMap = createFarrouteMap;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createFarrouteMap: createFarrouteMap };
})(typeof window !== 'undefined' ? window : this);
