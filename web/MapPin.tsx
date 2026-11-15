import type { MarsSite } from './marsSites.ts'

type PinKind = 'rover' | 'lander' | 'event' | 'cluster' | 'region' | 'local' | 'panorama' | 'panorama-cluster'

export function MapPin({ kind, count }: { kind: PinKind; count?: number }) {
  return <span className="map-pin-art" aria-hidden="true">
    <img src={`./assets/map-pins/${kind}.png`} width={32} height={38} alt="" draggable={false}/>
    {count !== undefined && <b className="map-pin-count">{count}</b>}
  </span>
}

export function SiteMarkerIcon({ sites }: { sites: MarsSite[] }) {
  if (sites.length > 1) return <MapPin kind="cluster" count={sites.length}/>
  const site = sites[0]
  if (site.category === 'science_event') return <MapPin kind="event"/>
  const rover = site.type === 'rover' || site.type === 'lander_and_rover'
  return <MapPin kind={rover ? 'rover' : 'lander'}/>
}
