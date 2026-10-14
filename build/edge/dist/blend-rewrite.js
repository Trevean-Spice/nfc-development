// GENERATED from redirect-table.json by scripts/build-blend-rewrite.mjs
// Do not edit. Run: npm run build:blend-rewrite
//
// Rewrites /blend.html?blend={slug} onto the pre-rendered document for that
// blend. An unknown or absent slug is left alone and falls through to the
// "jar not recognised" page, which is the correct branded outcome.
var PAGES = {
  "caribbean-sunset": "/blends/caribbean-sunset.html",
  "north-african-night-market": "/blends/north-african-night-market.html",
  "persian-sunrise": "/blends/persian-sunrise.html",
  "silk-road": "/blends/silk-road.html"
};

function handler(event) {
  var request = event.request;
  var qs = request.querystring;
  var blend = qs && qs.blend && qs.blend.value;
  if (blend && Object.prototype.hasOwnProperty.call(PAGES, blend)) {
    request.uri = PAGES[blend];
  }
  return request;
}
