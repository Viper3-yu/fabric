// Base-map tile sources in failover order. tile.openstreetmap.org is
// unreachable from many mainland-China networks without a proxy, so the
// primary source is AMap's raster service (direct, Chinese labels) and CARTO
// (OSM data via CDN) acts as the fallback. AMap paints in GCJ-02 while our
// coordinates are WGS-84; the ~500 m offset is invisible at city zoom.
const TILE_SOURCES = [
  {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  },
  {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
];

// Consecutive failed tiles before a source is written off; a few stray 404s
// at high zooms must not flip the basemap.
const ERROR_BUDGET = 4;

type TileLayerLike = {
  addTo(map: unknown): unknown;
  on(event: string, handler: () => void): unknown;
  off(event: string, handler: () => void): unknown;
};

type LeafletLike = {
  tileLayer(
    url: string,
    options: { attribution: string; subdomains: string[]; maxZoom: number },
  ): TileLayerLike;
};

type MapLike = {
  removeLayer(layer: unknown): unknown;
};

// Adds a base layer to `map`, switching to the next source once the current
// one keeps erroring. Calls `onAllFailed` when no source works; the route
// overlay itself stays usable on the empty background.
export function addBaseMapLayer(
  L: LeafletLike,
  map: MapLike,
  onAllFailed?: () => void,
): () => void {
  let index = 0;
  let errors = 0;
  let exhausted = false;
  let layer: TileLayerLike | null = null;

  const handleTileError = () => {
    if (exhausted || !layer) return;
    errors += 1;
    if (errors < ERROR_BUDGET) return;
    layer.off('tileerror', handleTileError);
    map.removeLayer(layer);
    layer = null;
    index += 1;
    if (index >= TILE_SOURCES.length) {
      exhausted = true;
      onAllFailed?.();
      return;
    }
    attach();
  };

  const attach = () => {
    const source = TILE_SOURCES[index];
    if (!source) return;
    errors = 0;
    layer = L.tileLayer(source.url, {
      attribution: source.attribution,
      subdomains: [...source.subdomains],
      maxZoom: 18,
    });
    layer.on('tileerror', handleTileError);
    layer.addTo(map);
  };

  attach();
  return () => {
    if (layer) layer.off('tileerror', handleTileError);
  };
}
