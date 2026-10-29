/* Country, region and city pickers backed by a GeoNames extract held in this
   repository: 246 countries, 3,857 regions and 230,654 cities of 500 people or
   more. Only the chosen country's file is fetched, so the page stays light and
   somebody in a small town still finds their town.

   Markup: a group of three fields sharing a data-geo-group name.
     <select data-geo="country" data-geo-group="apply">
     <select data-geo="region"  data-geo-group="apply">
     <input  data-geo="city"    data-geo-group="apply" list="geo-city-apply">
     <datalist id="geo-city-apply">

   The template re-renders and replaces these nodes, so the chosen values are
   kept here and restored whenever the fields reappear. */
(function (root) {
  var BASE = './geo/';
  var countries = null, loading = {}, cache = {};
  var picked = {};                       // group -> {country, region, city}

  function get(url) {
    return fetch(url, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function state(g) { return (picked[g] = picked[g] || { country: '', region: '', city: '' }); }

  function fields(g) {
    var q = function (kind) {
      return document.querySelector('[data-geo="' + kind + '"][data-geo-group="' + g + '"]');
    };
    return { country: q('country'), region: q('region'), city: q('city'),
             list: document.getElementById('geo-city-' + g) };
  }

  function option(sel, value, label) {
    var o = document.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  }

  function fillCountries(f, g) {
    if (!f.country || !countries) return;
    var want = state(g).country;
    f.country.innerHTML = '';
    option(f.country, '', f.country.getAttribute('data-geo-placeholder') || 'Country');
    countries.forEach(function (c) { option(f.country, c.c, c.n); });
    f.country.value = want || '';
  }

  function fillRegions(f, g, doc) {
    if (!f.region) return;
    var want = state(g).region;
    f.region.innerHTML = '';
    if (!doc) {
      option(f.region, '', 'Choose a country first');
      f.region.value = ''; f.region.disabled = true;
      return;
    }
    f.region.disabled = false;
    option(f.region, '', f.region.getAttribute('data-geo-placeholder') || 'State, province or region');
    doc.r.forEach(function (r) { option(f.region, r.n, r.n); });
    f.region.value = want && doc.r.some(function (r) { return r.n === want; }) ? want : '';
    state(g).region = f.region.value;
  }

  function fillCities(f, g, doc) {
    if (!f.city) return;
    var reg = state(g).region;
    var list = f.list;
    if (list) list.innerHTML = '';
    var found = doc && reg && doc.r.filter(function (r) { return r.n === reg; })[0];
    f.city.disabled = !found;
    f.city.placeholder = found ? 'Start typing your city' : 'Choose a region first';
    if (found && list) {
      var frag = document.createDocumentFragment();
      found.t.forEach(function (name) {
        var o = document.createElement('option'); o.value = name; frag.appendChild(o);
      });
      list.appendChild(frag);
    }
    var want = state(g).city;
    f.city.value = found && want && found.t.indexOf(want) > -1 ? want : '';
    state(g).city = f.city.value;
  }

  function loadCountry(cc) {
    if (!cc) return Promise.resolve(null);
    if (cache[cc]) return Promise.resolve(cache[cc]);
    if (loading[cc]) return loading[cc];
    loading[cc] = get(BASE + cc + '.json').then(function (d) {
      cache[cc] = d; delete loading[cc]; return d;
    }, function () { delete loading[cc]; return null; });
    return loading[cc];
  }

  function refresh(g) {
    var f = fields(g), cc = state(g).country;
    return loadCountry(cc).then(function (doc) {
      fillRegions(f, g, doc);
      fillCities(f, g, doc);
      return doc;
    });
  }

  function wire(g) {
    var f = fields(g);
    if (!f.country || f.country.getAttribute('data-geo-wired')) return;
    f.country.setAttribute('data-geo-wired', '1');
    fillCountries(f, g);
    f.country.addEventListener('change', function () {
      var s = state(g);
      s.country = f.country.value; s.region = ''; s.city = '';
      refresh(g);
    });
    if (f.region) f.region.addEventListener('change', function () {
      var s = state(g); s.region = f.region.value; s.city = '';
      refresh(g);
    });
    if (f.city) f.city.addEventListener('input', function () {
      state(g).city = f.city.value;
    });
    refresh(g);
  }

  function hydrate() {
    if (!countries) return;
    var seen = {};
    document.querySelectorAll('[data-geo-group]').forEach(function (el) {
      var g = el.getAttribute('data-geo-group');
      if (seen[g]) return; seen[g] = 1;
      wire(g);
    });
  }

  // What the form actually holds, and whether every part of it is real.
  function value(g) {
    var s = state(g), doc = cache[s.country];
    var name = '';
    if (countries && s.country) {
      countries.some(function (c) { if (c.c === s.country) { name = c.n; return true; } });
    }
    var regionOk = !!(doc && s.region && doc.r.some(function (r) { return r.n === s.region; }));
    var reg = doc && doc.r.filter(function (r) { return r.n === s.region; })[0];
    // Typed freely, so the city has to be one the list actually holds.
    var cityOk = !!(reg && s.city && reg.t.some(function (t) {
      return t.toLowerCase() === String(s.city).trim().toLowerCase();
    }));
    return { country: name, countryCode: s.country, region: s.region, city: s.city,
             countryOk: !!s.country, regionOk: regionOk, cityOk: cityOk };
  }

  get(BASE + 'countries.json').then(function (list) {
    countries = list;
    hydrate();
    new MutationObserver(function () { hydrate(); })
      .observe(document.body, { childList: true, subtree: true });
  }, function () { /* the fields stay disabled rather than accepting anything */ });

  root.FRGeo = { value: value, hydrate: hydrate };
})(window);
